// The launcher barrier: PID before exec, registration before GO.
//
// The whole of M1 and M2 exists to make this file's guarantee affordable:
//
//     kill the host anywhere between registration and release
//     ⇒ no provider process exists.
//
// The mechanism is a child that reports its identity and then BLOCKS on a
// control channel it does not own. Until the host writes GO, the child has not
// executed the provider; if the host dies, the channel closes underneath the
// child and it exits without ever exec'ing. There is no window in which a
// provider is running and unregistered, because the provider does not start
// until the record that describes it is durable.
//
// This module is PLATFORM-NEUTRAL and PURE. It never spawns, never signals,
// never touches a file. On POSIX the control channel is the fd3/fd4 pair and
// release is followed by `execve` (PID preserved); on Windows it is a named
// pipe pair and "create suspended inside a Job Object, resume on release". The
// observable contract below is identical, and it is what the tests assert.
//
// It is also loaded by the gated child itself (`launcher.ts`), which is why it
// imports nothing at runtime: the fewer moving parts between spawn and block,
// the fewer ways the barrier can fail open.

import type { Reservation } from "./call-budget.ts";
import type { EdgeId } from "../state/task-machine.ts";

// ---------------------------------------------------------------------------
// The wire protocol.
// ---------------------------------------------------------------------------

/** The child reports `{pid, pgid, …}` here, once, as one JSON line. */
export const IDENTITY_FD = 3;

/** The child blocks here. EOF means the host died; the token means go. */
export const RELEASE_FD = 4;

export const RELEASE_TOKEN = "go";

/**
 * How the gated child dies when it dies before exec'ing.
 *
 * Distinct codes because they mean different things to the human reading the
 * journal: a closed channel is the barrier working as designed after a host
 * crash, and a refused token is a control channel carrying something nobody
 * should be able to put there.
 */
export const LAUNCHER_EXIT = {
  /** The payload was not a decodable launch descriptor. */
  badPayload: 64,
  /** The control channel closed before GO — the host died. THE provider never ran. */
  controlChannelClosed: 65,
  /** Something other than the release token arrived on the control channel. */
  refusedRelease: 66,
  /** This runtime cannot replace itself, so PID stability cannot be honored. */
  execUnavailable: 67,
} as const;

/**
 * What the gated child is told to become, once released.
 *
 * Deliberately only the command. `cwd` and `env` are applied by the broker when
 * it creates the child and are inherited across `execve`, and the PROMPT is not
 * here at all — it arrives on stdin after release. A payload that carried the
 * prompt would put it in the launcher's argv, where every `ps` on the machine
 * could read it.
 */
export interface LaunchPayload {
  /** Already resolved to an absolute path by the broker; the child re-checks. */
  executable: string;
  argv: readonly string[];
}

/** Thrown by the child when its payload is not a launch descriptor. Exit code `badPayload`. */
export class PayloadInvalid extends Error {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`the launch payload is unusable: ${detail}`, options);
    this.name = "PayloadInvalid";
  }
}

export function encodeLaunchPayload(payload: LaunchPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLaunchPayload(encoded: string): LaunchPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (cause) {
    throw new PayloadInvalid("not base64url-encoded JSON", { cause });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PayloadInvalid("not an object");
  }
  const value = parsed as Partial<LaunchPayload>;
  if (typeof value.executable !== "string" || value.executable.length === 0) {
    throw new PayloadInvalid("executable must be a non-empty string");
  }
  // Absolute only. `execve` does no PATH search, and a relative executable
  // would be resolved against whatever cwd the child happens to hold.
  if (!value.executable.startsWith("/")) {
    throw new PayloadInvalid(`executable ${JSON.stringify(value.executable)} is not an absolute path`);
  }
  if (!Array.isArray(value.argv) || value.argv.some((arg) => typeof arg !== "string")) {
    throw new PayloadInvalid("argv must be an array of strings");
  }
  return { executable: value.executable, argv: [...value.argv] };
}

/**
 * Who the process is, in a way that survives PID reuse.
 *
 * A PID alone is not an identity: the kernel reuses it, and a supervisor that
 * signals a recycled PID kills a stranger. `startIdentity` pins the process
 * instance — on Linux `<boot-id>:<pid>:<starttime-jiffies>`, which `execve`
 * does NOT change, so the identity the launcher reports before exec is still
 * the provider's identity after it.
 *
 * `startIdentity` is nullable and `startIdentitySource` explains a null, so a
 * platform that cannot report one says so instead of offering a PID dressed up
 * as an identity.
 */
export interface ProcessIdentity {
  pid: number;
  pgid: number;
  startIdentity: string | null;
  startIdentitySource: string;
}

export function formatIdentityLine(identity: ProcessIdentity): string {
  return `${JSON.stringify(identity)}\n`;
}

/** Thrown when the control channel produced something that is not an identity. */
export class HandshakeFailed extends Error {
  readonly detail: string;

  constructor(detail: string, options?: { cause?: unknown }) {
    super(`the gated child did not report a usable identity: ${detail}`, options);
    this.name = "HandshakeFailed";
    this.detail = detail;
  }
}

/**
 * Parses the identity line. Strict on purpose: this is the one message that
 * decides which PID the host will later signal, and a lenient parser here is a
 * lenient answer to "what am I about to kill?".
 */
export function parseIdentityLine(line: string): ProcessIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new HandshakeFailed(`${JSON.stringify(line.slice(0, 120))} is not JSON`, { cause });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new HandshakeFailed("the identity line is not an object");
  }
  const value = parsed as Partial<ProcessIdentity>;
  const positiveInt = (n: unknown): boolean => Number.isInteger(n) && (n as number) > 0;
  if (!positiveInt(value.pid) || !positiveInt(value.pgid)) {
    throw new HandshakeFailed(`pid/pgid must be positive integers, got ${JSON.stringify([value.pid, value.pgid])}`);
  }
  if (value.startIdentity !== null && typeof value.startIdentity !== "string") {
    throw new HandshakeFailed("startIdentity must be a string or null");
  }
  if (typeof value.startIdentitySource !== "string" || value.startIdentitySource.length === 0) {
    throw new HandshakeFailed("startIdentitySource must name how the identity was obtained");
  }
  return {
    pid: value.pid as number,
    pgid: value.pgid as number,
    startIdentity: value.startIdentity,
    startIdentitySource: value.startIdentitySource,
  };
}

// ---------------------------------------------------------------------------
// Recycled PIDs.
// ---------------------------------------------------------------------------

/**
 * Is the process observed at this PID still the one we recorded?
 *
 * Fails CLOSED in the direction that matters: an absent observation, a changed
 * start identity, or an identity nobody could establish all answer "no". The
 * caller of this predicate is about to send a signal, and "I am not sure"
 * must never be the same answer as "yes".
 */
export function sameProcess(recorded: ProcessIdentity, observed: ProcessIdentity | null): boolean {
  if (observed === null) return false;
  if (recorded.pid !== observed.pid) return false;
  if (recorded.startIdentity === null || observed.startIdentity === null) return false;
  return recorded.startIdentity === observed.startIdentity;
}

/** Thrown when a caller insists on acting against a PID whose identity no longer matches. */
export class RecycledPidRefused extends Error {
  readonly recorded: ProcessIdentity;
  readonly observed: ProcessIdentity | null;

  constructor(action: string, recorded: ProcessIdentity, observed: ProcessIdentity | null) {
    super(
      `refusing to ${action} pid ${recorded.pid}: it was ${recorded.startIdentity ?? "(no identity)"} ` +
        `and is now ${observed === null ? "not running" : (observed.startIdentity ?? "(no identity)")}`,
    );
    this.name = "RecycledPidRefused";
    this.recorded = recorded;
    this.observed = observed;
  }
}

// ---------------------------------------------------------------------------
// Termination.
// ---------------------------------------------------------------------------

/**
 * What a cancellation actually achieved — reported, never assumed.
 *
 * `survivors` is the enumerated truth after the ladder ran. A port that cannot
 * enumerate must throw rather than return `[]`: an empty list is a claim that
 * everything died, and a supervisor that cannot see is not entitled to make it.
 */
export interface TerminationReport {
  termSent: boolean;
  killSent: boolean;
  survivors: readonly number[];
  terminated: boolean;
  /**
   * Why no signal was sent, when none was. `identity-changed` means the PID was
   * recycled and the group was therefore already empty — see `terminateGroup`
   * in the broker for why that inference is sound.
   */
  skipped: "identity-changed" | null;
}

/** Thrown by a platform port that cannot enumerate a process group. Never `[]`. */
export class EnumerationUnavailable extends Error {
  readonly platform: string;

  constructor(platform: string, detail: string) {
    super(`cannot enumerate survivors on ${platform}: ${detail}; an empty list would be a lie`);
    this.name = "EnumerationUnavailable";
    this.platform = platform;
  }
}

// ---------------------------------------------------------------------------
// The barrier.
// ---------------------------------------------------------------------------

/**
 * A child that exists, holds a process group, and has NOT executed a provider.
 *
 * Everything a host can do to a launch before it becomes a run: learn what it
 * is, let it go, or destroy it.
 */
export interface GatedLaunch {
  /** Resolves once the child has reported its identity on the control channel. */
  identify: () => Promise<ProcessIdentity>;
  /** Writes the release token. After this the provider is exec'ing under the same PID. */
  release: () => Promise<void>;
  /** TERM → grace → KILL → enumerate → report reality. */
  abandon: (reason: string) => Promise<TerminationReport>;
}

/**
 * The barrier's steps, in order — the boundaries the kill-host simulation kills
 * between. Named here rather than in the test so the suite cannot drift into
 * killing a protocol the implementation no longer runs.
 *
 * A kill at ANY of `launched`, `identified`, `registered` or `spent` must leave
 * no provider process: the release token has not been written at any of them.
 * Only after `released` does a provider exist at all.
 */
export const BARRIER_STEPS = ["launched", "identified", "registered", "spent", "released"] as const;
export type BarrierStep = (typeof BARRIER_STEPS)[number];

/** What the durable record must contain about a process that has not run yet. */
export interface BarrierRecord {
  identity: ProcessIdentity;
  runId: string;
  edge: EdgeId;
  reservationId: string;
  /** The exact argv, for `processes.command_json`. */
  command: readonly string[];
  cwd: string;
}

/**
 * The two settlements the barrier is allowed to make. `CallBudget` satisfies
 * this structurally; the narrow port keeps the barrier testable without a
 * ledger and keeps it from reaching for any other ledger operation.
 */
export interface ReservationLedger {
  spendOnGo: (reservationId: string) => Reservation;
  releaseOnRegistrationFailure: (reservationId: string) => Reservation;
}

export interface LauncherBarrierOptions {
  /** Creates the gated child. The broker's job; the barrier only sequences it. */
  start: () => Promise<GatedLaunch>;
  record: Omit<BarrierRecord, "identity">;
  /**
   * journal append + fsync · atomic status replace · projector apply — all of
   * it, or it throws. The barrier does not know which of those steps exists
   * yet; it knows that when this resolves, a host that dies next leaves
   * evidence, and when it rejects, nothing may run.
   */
  register: (record: BarrierRecord) => Promise<void>;
  ledger: ReservationLedger;
  signal?: AbortSignal;
  onStep?: (step: BarrierStep) => Promise<void> | void;
}

export interface BarrierOutcome {
  launch: GatedLaunch;
  identity: ProcessIdentity;
  /** The reservation, now spent. */
  reservation: Reservation;
}

/**
 * A launch that was destroyed before it became a run.
 *
 * Carries the cancellation report and the refunded reservation because both are
 * the answer to the only question worth asking after a failed launch: is
 * anything still running, and did it cost a call?
 */
export class RegistrationFailed extends Error {
  readonly step: BarrierStep | "start";
  readonly cancellation: TerminationReport | null;
  readonly reservation: Reservation | null;
  /** Set when the refund itself failed — a second fault, never allowed to hide the first. */
  readonly refundError: unknown;

  constructor(options: {
    step: BarrierStep | "start";
    cause: unknown;
    cancellation: TerminationReport | null;
    reservation: Reservation | null;
    refundError?: unknown;
  }) {
    const detail = options.cause instanceof Error ? options.cause.message : String(options.cause);
    // What the message may claim depends entirely on where it failed. Only the
    // steps before the token can promise the provider never ran; saying it
    // everywhere would make the one case that matters the one case that lies.
    const outcome =
      options.step === "spent"
        ? "and whether the release token reached the child is not knowable, so the call is billed"
        : options.step === "released"
          ? "AFTER the release token — a provider may be running under the registered pid"
          : "and the provider never ran";
    super(`the launch failed at "${options.step}" ${outcome}: ${detail}`, {
      cause: options.cause,
    });
    this.name = "RegistrationFailed";
    this.step = options.step;
    this.cancellation = options.cancellation;
    this.reservation = options.reservation;
    this.refundError = options.refundError ?? null;
  }
}

/**
 * Start gated, register durably, then release — and on any fault, destroy the
 * tree and return the reservation.
 *
 * Two orderings in here are load-bearing and neither is arbitrary:
 *
 * 1. `register` happens BEFORE the release token. That is the whole barrier: a
 *    provider process can only exist downstream of a durable record of it.
 *
 * 2. `spendOnGo` happens BEFORE the release token, not after. The two failure
 *    modes are not symmetric — crashing between spend and GO over-counts by one
 *    call, which is conservative; crashing between GO and spend lets a provider
 *    run for free, which is a ceiling that does not hold. The plan draws both on
 *    the same arrow; the safe decomposition is this one.
 *
 * The refund rule is stated once and applied everywhere below: a call that
 * PROVABLY never ran is returned, and a call that may have run is billed.
 */
export async function runLauncherBarrier(options: LauncherBarrierOptions): Promise<BarrierOutcome> {
  const { start, record, register, ledger, signal, onStep } = options;
  const step = async (name: BarrierStep): Promise<void> => {
    await onStep?.(name);
  };
  const abortCheck = (): void => {
    if (signal?.aborted === true) {
      throw new Error(`the launch was cancelled before release: ${String(signal.reason ?? "aborted")}`);
    }
  };

  let launch: GatedLaunch;
  try {
    // Inside the refund path deliberately: a launch cancelled before it started
    // still holds a reservation, and an unreturned reservation on a child that
    // never existed is the cheapest possible way to lose a call.
    abortCheck();
    launch = await start();
  } catch (cause) {
    // Nothing exists to destroy, but the reservation is real and must go back.
    const refund = refundQuietly(ledger, record.reservationId);
    throw new RegistrationFailed({
      step: "start",
      cause,
      cancellation: null,
      reservation: refund.reservation,
      refundError: refund.error,
    });
  }

  // From here on, a fault means a live child holding a process group and no
  // provider inside it. Every exit from this block destroys the tree first and
  // settles the money second — in that order, because a returned reservation
  // next to a surviving process is a lie about what the system did.
  //
  // `step("launched")` is INSIDE the block, not before it. The hook is the
  // host's code — the kill simulation drives it, and a tracer will later — and
  // one that throws outside this guard would orphan a gated child holding a
  // reservation nobody returned.
  let at: BarrierStep = "launched";
  let spent = false;
  try {
    await step("launched");
    abortCheck();
    const identity = await launch.identify();
    at = "identified";
    await step("identified");

    abortCheck();
    await register({ ...record, identity });
    at = "registered";
    await step("registered");

    abortCheck();
    const reservation = ledger.spendOnGo(record.reservationId);
    spent = true;
    at = "spent";
    await step("spent");

    await launch.release();
    at = "released";
    await step("released");

    return { launch, identity, reservation };
  } catch (cause) {
    let cancellation: TerminationReport | null = null;
    let cancelError: unknown = null;
    try {
      cancellation = await launch.abandon(`launch failed at ${at}`);
    } catch (error) {
      cancelError = error;
    }
    // Only an unspent reservation is refundable. Once `spendOnGo` has run, the
    // release token may or may not have reached the child, and the ledger does
    // not guess: it bills the call and leaves the journal to reconcile.
    const refund = spent
      ? { reservation: null, error: null }
      : refundQuietly(ledger, record.reservationId);
    throw new RegistrationFailed({
      step: at,
      cause,
      cancellation,
      reservation: refund.reservation,
      refundError: refund.error ?? cancelError,
    });
  }
}

/**
 * Returns the reservation without letting a second fault bury the first.
 *
 * A refund that throws is itself a defect worth seeing (`ReservationNotHeld`
 * means somebody settled this launch already), but the caller's original error
 * is the one that explains what happened, so this reports rather than throws.
 */
function refundQuietly(
  ledger: ReservationLedger,
  reservationId: string,
): { reservation: Reservation | null; error: unknown } {
  try {
    return { reservation: ledger.releaseOnRegistrationFailure(reservationId), error: null };
  } catch (error) {
    return { reservation: null, error };
  }
}
