// The liveness monitor: four ways a run stops being a run.
//
//   record-update-failed · hard timeout · silence window · (and the caller
//   stopping it because the process exited on its own)
//
// Any trip starts tree termination and then REPORTS what termination achieved,
// because a monitor that fires and assumes is the same defect as a port that
// returns `[]`.
//
// The one design decision worth reading twice is the shape of `noteOutput`. It
// takes a BYTE COUNT, not a string and not an event. The silence window is
// specified to trip on "process/output activity only — never conversational
// markers", and the cheapest way to keep that true forever is to make the
// content unavailable to this class: there is no parameter through which a
// milestone line, a thinking token or a heartbeat message could arrive and be
// mistaken for progress. A provider that talks without working is silent as far
// as this file is concerned — bytes are bytes — and a provider that works
// without talking stays alive because the CPU counter moves.

import type { ProcessIdentity, TerminationReport } from "./launcher-barrier.ts";
import type { TerminateOptions } from "./process-controller.ts";

/** `runtime.silence_timeout_seconds` in `awsf.config.yaml`, in milliseconds. */
export const SILENCE_WINDOW_MS = 2_700 * 1_000;

/** How often liveness is sampled. Well below any window it is checking. */
export const MONITOR_POLL_MS = 1_000;

export type TripReason = "record-update-failed" | "timeout" | "silence";

export interface LivenessOutcome {
  /** `null` when the run ended on its own and the monitor was simply stopped. */
  reason: TripReason | null;
  cancellation: TerminationReport | null;
  /** Set when termination itself failed — never allowed to look like a clean stop. */
  error: unknown;
  /**
   * Polls at which the supervisor could not see the process group.
   *
   * Recorded rather than swallowed: a blind poll is NOT activity, so a monitor
   * that goes blind still trips its silence window on schedule. Fail-closed is
   * the right direction here — the alternative is a wedged provider kept alive
   * by a broken census.
   */
  blindPolls: number;
}

/**
 * The slice of the controller this needs. Narrow on purpose: the monitor can
 * read the group and end it, and has no way to reach anything else.
 */
export interface LivenessSupervisor {
  groupCpu: (recorded: ProcessIdentity) => number;
  terminateTree: (recorded: ProcessIdentity, options?: TerminateOptions) => Promise<TerminationReport>;
}

export interface LivenessMonitorOptions {
  supervisor: LivenessSupervisor;
  identity: ProcessIdentity;
  /** Default 2700 s. */
  silenceMs?: number;
  /** A hard ceiling on the whole run. `0` (the default) means there is none. */
  timeoutMs?: number;
  pollMs?: number;
  /** Injected so the tests drive elapsed time instead of waiting for it. */
  now?: () => number;
  terminate?: TerminateOptions;
}

export class LivenessMonitor {
  readonly #supervisor: LivenessSupervisor;
  readonly #identity: ProcessIdentity;
  readonly #silenceMs: number;
  readonly #timeoutMs: number;
  readonly #pollMs: number;
  readonly #now: () => number;
  readonly #terminate: TerminateOptions | undefined;
  readonly #finished: Promise<LivenessOutcome>;
  #settle: (outcome: LivenessOutcome) => void = () => {};

  readonly #startedAt: number;
  #lastActivityAt: number;
  #lastCpu: number | null = null;
  #blindPolls = 0;
  #recordUpdateFailed = false;
  #reason: TripReason | null = null;
  #settled = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LivenessMonitorOptions) {
    this.#supervisor = options.supervisor;
    this.#identity = options.identity;
    this.#silenceMs = options.silenceMs ?? SILENCE_WINDOW_MS;
    this.#timeoutMs = options.timeoutMs ?? 0;
    this.#pollMs = options.pollMs ?? MONITOR_POLL_MS;
    this.#now = options.now ?? ((): number => Date.now());
    this.#terminate = options.terminate;
    this.#startedAt = this.#now();
    this.#lastActivityAt = this.#startedAt;
    this.#finished = new Promise<LivenessOutcome>((resolve) => {
      this.#settle = resolve;
    });
  }

  /** The trip, or `null` while the run is still considered alive. */
  get reason(): TripReason | null {
    return this.#reason;
  }

  get blindPolls(): number {
    return this.#blindPolls;
  }

  /** Resolves once the monitor has stopped — after termination, if it tripped. */
  get finished(): Promise<LivenessOutcome> {
    return this.#finished;
  }

  /**
   * Output arrived. A COUNT, never the bytes themselves — see the header.
   *
   * Zero is not activity: an empty chunk is an artefact of stream plumbing, not
   * a provider doing something.
   */
  noteOutput(byteCount: number): void {
    if (byteCount > 0) this.#lastActivityAt = this.#now();
  }

  /**
   * The durable record could not be updated.
   *
   * A run whose record cannot be written is a run nobody can find, bill or kill
   * later, so it is terminated now rather than allowed to continue invisibly.
   * The flag latches: a single failure is enough.
   */
  noteRecordUpdateFailed(): void {
    this.#recordUpdateFailed = true;
  }

  /** Samples once. Everything the interval does, exposed so tests need no clock. */
  async tick(): Promise<void> {
    if (this.#settled) return;

    let cpu: number | null = null;
    try {
      cpu = this.#supervisor.groupCpu(this.#identity);
    } catch {
      // A census that failed is not a heartbeat. Counted, and otherwise ignored.
      this.#blindPolls += 1;
    }
    if (cpu !== null) {
      if (this.#lastCpu !== null && cpu !== this.#lastCpu) this.#lastActivityAt = this.#now();
      this.#lastCpu = cpu;
    }

    const at = this.#now();
    // Ordered as the plan's monitor orders them: a record that cannot be written
    // outranks a clock, and a hard ceiling outranks a quiet one.
    if (this.#recordUpdateFailed) return this.#trip("record-update-failed");
    if (this.#timeoutMs > 0 && at - this.#startedAt >= this.#timeoutMs) return this.#trip("timeout");
    if (at - this.#lastActivityAt >= this.#silenceMs) return this.#trip("silence");
  }

  /** Starts sampling. Idempotent. */
  start(): void {
    if (this.#timer !== null || this.#settled) return;
    const timer = setInterval(() => {
      void this.tick();
    }, this.#pollMs);
    // The monitor must not be the reason the host stays alive: a run that ended
    // should let the process exit even if nobody remembered to stop the timer.
    (timer as { unref?: () => void }).unref?.();
    this.#timer = timer;
  }

  /**
   * The run ended on its own. Nothing is signalled and nothing is claimed about
   * the tree — the caller that saw the exit is the one that knows.
   */
  async stop(): Promise<LivenessOutcome> {
    if (!this.#settled) {
      this.#close();
      this.#settle({ reason: null, cancellation: null, error: null, blindPolls: this.#blindPolls });
    }
    return this.#finished;
  }

  async #trip(reason: TripReason): Promise<void> {
    if (this.#settled) return;
    this.#reason = reason;
    this.#close();
    let cancellation: TerminationReport | null = null;
    let error: unknown = null;
    try {
      cancellation = await this.#supervisor.terminateTree(
        this.#identity,
        this.#terminate ?? {},
      );
    } catch (caught) {
      // A termination that could not enumerate throws rather than reporting, and
      // that failure travels with the outcome instead of being flattened into a
      // report that would claim the tree is gone.
      error = caught;
    }
    this.#settle({ reason, cancellation, error, blindPolls: this.#blindPolls });
  }

  #close(): void {
    this.#settled = true;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
