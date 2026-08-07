// THE ONLY MODULE IN THIS REPOSITORY THAT IMPORTS `node:child_process`.
//
// Everything else — every adapter, every workflow, every gate — asks this file
// to start a process and cannot start one itself. That is not a style rule: an
// adapter that could spawn could bypass PID registration, and a provider the
// host has no durable record of is a provider the host cannot find, bill, or
// kill. The child-process fence meta-test guards the boundary, and from T10 on
// it guards something real.
//
// The broker's job is narrow and entirely pre-flight:
//
//   1. refuse a launch that is not at one of the five spawn sites,
//   2. refuse a spec that could execute something other than what it names,
//   3. create the gated child, and hand the sequencing to the barrier.
//
// Steps 1 and 2 happen BEFORE any child exists. That ordering is the whole
// point — a rejection that arrives after `spawn()` has already returned has
// already failed.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { IllegalSpawnSite } from "../state/errors.ts";
import { LEGAL_EDGES, edgeFor, type LegalEdge } from "../state/task-machine.ts";
import {
  BARRIER_STEPS,
  IDENTITY_FD,
  RELEASE_FD,
  RELEASE_TOKEN,
  HandshakeFailed,
  encodeLaunchPayload,
  parseIdentityLine,
  runLauncherBarrier,
  type BarrierRecord,
  type BarrierStep,
  type GatedLaunch,
  type ProcessIdentity,
  type ReservationLedger,
} from "./launcher-barrier.ts";
import {
  ProcessController,
  createHostPort,
  type CommandResult,
  type TerminateOptions,
} from "./process-controller.ts";
import type {
  ProcessExit,
  ProcessRegistration,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../adapters/interface.ts";

// ---------------------------------------------------------------------------
// The five spawn sites.
// ---------------------------------------------------------------------------

/**
 * L4, L10, L11, L16, L19 — DERIVED from the L-table's ✦ column rather than
 * restated here. A second list would be a second truth, and the one that
 * drifted would be this one. A unit test pins the derivation to the five the
 * plan names, so a change to the table is caught here rather than discovered
 * by a provider that launched somewhere it should not have.
 */
export const SPAWN_SITE_EDGES: readonly LegalEdge[] = LEGAL_EDGES.filter((edge) => edge.spawnSite);

/** Everything the broker refuses about the SHAPE of a request, once the site is legal. */
export class SpawnRegistrationInvalid extends Error {
  readonly detail: string;

  constructor(runId: string, detail: string) {
    super(`refusing to launch ${runId || "(unnamed run)"}: ${detail}`);
    this.name = "SpawnRegistrationInvalid";
    this.detail = detail;
  }
}

/** The executable a spec names could not be resolved to something runnable. */
export class ExecutableNotFound extends Error {
  readonly executable: string;

  constructor(executable: string, searched: readonly string[]) {
    super(
      `executable ${JSON.stringify(executable)} is not runnable` +
        (searched.length === 0 ? "" : ` (searched ${searched.join(delimiter)})`),
    );
    this.name = "ExecutableNotFound";
    this.executable = executable;
  }
}

/**
 * Spawn-site enforcement, before a child exists.
 *
 * The pair decides, not the caller's label: `edgeFor` is the same function the
 * task machine uses, so "which edges may spawn" has exactly one definition. A
 * caller that names an edge the pair does not produce is told so separately —
 * a misdeclared edge and an illegal spawn site are different defects and must
 * not share a message.
 */
function assertSpawnSite(registration: ProcessRegistration): LegalEdge {
  const { from, to } = registration;
  const edge = edgeFor(from, to);
  if (edge === undefined || !edge.spawnSite) {
    throw new IllegalSpawnSite(from, to, edge?.id ?? "(no legal edge)", true, false);
  }
  if (edge.id !== registration.edge) {
    throw new SpawnRegistrationInvalid(
      registration.runId,
      `${from} -> ${to} is ${edge.id}, but the registration declares ${registration.edge}`,
    );
  }
  return edge;
}

/**
 * Everything that must be true of a spec before a child is allowed to exist.
 *
 * `shell` is re-checked at runtime even though the type forbids anything but
 * `false`: the type is erased at run time, and this is the last gate a
 * JavaScript caller passes through.
 */
function assertSpecSafe(registration: ProcessRegistration, spec: ProcessSpec): void {
  const refuse = (detail: string): never => {
    throw new SpawnRegistrationInvalid(registration.runId, detail);
  };
  if (registration.runId.length === 0) refuse("a launch needs a run id");
  if (registration.reservationId.length === 0) {
    refuse("no reservation id — a call is reserved before launch, never after");
  }
  if ((spec as { shell: unknown }).shell !== false) refuse("shell execution is not available on any path");
  if (!Array.isArray(spec.argv)) refuse("argv must be an array, never a command line");
  if (spec.argv.some((arg) => typeof arg !== "string")) refuse("argv must contain only strings");
  if (typeof spec.executable !== "string" || spec.executable.length === 0) refuse("no executable named");
  // The prompt rides stdin. Exact match always; containment once the prompt is
  // long enough that a coincidence is not credible. T13's descriptor tests are
  // the primary proof of this — the broker is the last gate before a child.
  const prompt = spec.stdin;
  if (
    prompt.length > 0 &&
    spec.argv.some((arg) => arg === prompt || (prompt.length >= 32 && arg.includes(prompt)))
  ) {
    refuse("the prompt is in argv, where every process table on the machine can read it");
  }
}

/**
 * Resolves an executable NAME to an absolute path the kernel will accept.
 *
 * `execve` does no PATH search of its own, so this is where the search happens
 * — against the spec's OWN env, not the host's, so the process that runs is the
 * one the descriptor described. A bare relative path is refused rather than
 * resolved: it would mean "relative to whatever cwd this child happens to hold".
 */
export function resolveExecutable(executable: string, env: Readonly<Record<string, string>>): string {
  const runnable = (candidate: string): boolean => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(executable)) {
    if (!runnable(executable)) throw new ExecutableNotFound(executable, []);
    return executable;
  }
  if (executable.includes("/")) throw new ExecutableNotFound(executable, []);
  const searched = (env["PATH"] ?? "").split(delimiter).filter((entry) => entry.length > 0);
  for (const dir of searched) {
    const candidate = join(dir, executable);
    if (runnable(candidate)) return candidate;
  }
  throw new ExecutableNotFound(executable, searched);
}

/**
 * The census capability the darwin and win32 ports need — and the second and
 * last thing in this repository that creates a process.
 *
 * It is HERE for the same reason the launcher is: `node:child_process` is
 * importable in exactly one module, and a platform port asking `ps` or CIM for
 * the process table would need an exemption from the fence that makes the
 * registration guarantee mean anything. So the ports take this as an injected
 * capability instead, and a port handed nothing cannot enumerate and says so.
 *
 * Synchronous because the callers are: the ladder polls a census inside a grace
 * period, and an enumeration that could interleave with its own next poll is a
 * survivor list assembled from two different moments.
 */
export function runSystemCommand(
  executable: string,
  argv: readonly string[],
  timeoutMs: number,
): CommandResult {
  const result = spawnSync(executable, [...argv], {
    encoding: "utf8",
    timeout: timeoutMs,
    shell: false,
    windowsHide: true,
    // A process table on a busy machine is large, and a census truncated by the
    // default 1 MB buffer would be a survivor list with the end cut off.
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error === undefined || result.error === null ? null : result.error.message,
  };
}

// ---------------------------------------------------------------------------
// The broker.
// ---------------------------------------------------------------------------

export interface BrokerOptions {
  /**
   * Makes the registration durable — journal append + fsync, atomic status
   * replace, projector apply. Wired once, at host startup: `startProcess` takes
   * only what varies per launch.
   */
  register: (record: BarrierRecord) => Promise<void>;
  ledger: ReservationLedger;
  /** Absolute path to the gated child. Defaults to the sibling `launcher.ts`. */
  launcherPath?: string;
  /** How long the child has to report its identity before the launch is abandoned. */
  handshakeMs?: number;
  terminate?: TerminateOptions;
  /** The supervisor. Defaults to this machine's port, wired to `runSystemCommand`. */
  controller?: ProcessController;
}

export interface StartHooks {
  /** Called after each barrier step. The kill-host simulation kills from here. */
  onStep?: (step: BarrierStep) => Promise<void> | void;
}

/** What a launch that never got past the handshake failed at. */
export class LauncherExited extends Error {
  readonly code: number | null;
  readonly signal: string | null;

  constructor(code: number | null, signal: string | null, stderr: string) {
    super(
      `the gated child exited (code ${String(code)}, signal ${String(signal)}) before reporting its identity` +
        (stderr.length === 0 ? "" : `: ${stderr.trim()}`),
    );
    this.name = "LauncherExited";
    this.code = code;
    this.signal = signal;
  }
}

export class ProcessTransportBroker implements TransportBroker {
  readonly #options: BrokerOptions;
  readonly #launcherPath: string;
  readonly #controller: ProcessController;

  constructor(options: BrokerOptions) {
    this.#options = options;
    this.#launcherPath = options.launcherPath ?? join(import.meta.dirname, "launcher.ts");
    this.#controller =
      options.controller ??
      new ProcessController({
        port: createHostPort({ command: runSystemCommand }),
        ...(options.terminate === undefined ? {} : { terminate: options.terminate }),
      });
  }

  /** The supervisor this broker cancels through. Exposed so a caller can read the tree it owns. */
  get controller(): ProcessController {
    return this.#controller;
  }

  /**
   * The sole provider-process entry point.
   *
   * Everything before `runLauncherBarrier` is a refusal that costs nothing;
   * everything inside it either produces a registered, released provider or
   * destroys the tree and returns the reservation.
   */
  async startProcess(
    registration: ProcessRegistration,
    spec: ProcessSpec,
    signal: AbortSignal,
    hooks: StartHooks = {},
  ): Promise<ProcessTransport> {
    const edge = assertSpawnSite(registration);
    assertSpecSafe(registration, spec);
    const executable = resolveExecutable(spec.executable, spec.env);

    const held: { child: ChildProcess | null } = { child: null };
    const outcome = await runLauncherBarrier({
      start: async () => {
        const started = this.#spawnGated(executable, spec, registration.runId);
        held.child = started.child;
        return started.launch;
      },
      record: {
        runId: registration.runId,
        edge: edge.id,
        reservationId: registration.reservationId,
        command: [executable, ...spec.argv],
        cwd: spec.cwd,
      },
      register: this.#options.register,
      ledger: this.#options.ledger,
      signal,
      ...(hooks.onStep === undefined ? {} : { onStep: hooks.onStep }),
    });

    // Non-null by construction: the barrier only returns after `start` resolved.
    if (held.child === null) throw new SpawnRegistrationInvalid(registration.runId, "the barrier released a launch that never started");
    return this.#transportFor(held.child, registration.runId, outcome.identity, spec);
  }

  /**
   * Creates the child in its own process group with the fd3/fd4 control pair.
   *
   * `detached` is what makes the group exist, and the group is what makes
   * cancellation whole: a provider that spawns its own children puts them in
   * this group, so `kill(-pgid)` reaches all of them rather than orphaning the
   * ones the host never saw.
   */
  #spawnGated(
    executable: string,
    spec: ProcessSpec,
    runId: string,
  ): { child: ChildProcess; launch: GatedLaunch } {
    const payload = encodeLaunchPayload({ executable, argv: spec.argv });
    const child = spawn(
      process.execPath,
      // The run id is the last argument and the launcher never reads it. It is
      // there so a human looking at `ps` can tell which run a child blocked at
      // the barrier belongs to — an opaque gated process is exactly the kind of
      // thing nobody can act on at 2 a.m.
      ["--no-warnings", "--experimental-strip-types", this.#launcherPath, payload, runId],
      {
        cwd: spec.cwd,
        env: { ...spec.env },
        detached: true,
        // 0-2 are the provider's after the exec; 3 and 4 are the barrier's and
        // are closed before it.
        stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      },
    );

    let recorded: ProcessIdentity | null = null;
    const identify = this.#handshake(child);
    const launch: GatedLaunch = {
      identify: async () => {
        recorded = this.#withObservedIdentity(await identify);
        return recorded;
      },
      release: async () => {
        await new Promise<void>((resolve, reject) => {
          const channel = child.stdio[RELEASE_FD] as unknown as {
            end: (chunk: string, cb: () => void) => void;
            once: (event: string, cb: (error: Error) => void) => void;
          };
          channel.once("error", reject);
          channel.end(`${RELEASE_TOKEN}\n`, resolve);
        });
      },
      abandon: async (reason) => {
        // Without an identity there is no PID we are entitled to signal, and
        // the child is still the one we hold a handle to — so end the control
        // channel and let the barrier's own contract kill it: no GO, no exec.
        if (recorded === null) {
          child.kill("SIGKILL");
          return { termSent: false, killSent: true, survivors: [], terminated: true, skipped: null };
        }
        void reason;
        return this.#controller.terminateTree(recorded);
      },
    };
    return { child, launch };
  }

  /**
   * Fills in a start identity the gated child could not read for itself.
   *
   * The launcher reads `/proc` and has nothing to read anywhere else, so off
   * Linux it honestly reports `startIdentity: null` — and a null is exactly what
   * `sameProcess` refuses to match, which would turn every later cancellation on
   * that platform into a no-op that reported success. The host can ask the same
   * question through its platform port.
   *
   * It is safe to ask HERE and nowhere later: the child is still blocked on the
   * control channel whose write end this process holds, so it cannot have exited
   * and its PID cannot have been recycled between its report and this
   * observation. A port that cannot enumerate leaves the honest null in place,
   * and the ladder refuses to signal on it rather than guessing.
   */
  #withObservedIdentity(identity: ProcessIdentity): ProcessIdentity {
    if (identity.startIdentity !== null) return identity;
    try {
      const observed = this.#controller.observeIdentity(identity.pid);
      if (observed === null || observed.startIdentity === null) return identity;
      return {
        pid: identity.pid,
        pgid: observed.pgid,
        startIdentity: observed.startIdentity,
        startIdentitySource: observed.startIdentitySource,
      };
    } catch {
      return identity;
    }
  }

  /**
   * Waits for the one identity line, or for the child to die trying.
   *
   * A timeout is not optional here: a child that never reports is a child the
   * host cannot name, and a host that waits forever for it is a host that never
   * gets to the part where it kills it.
   *
   * Every listener this attaches is removed on settlement, `stderr`'s above all.
   * A lingering `data` handler leaves the stream in flowing mode, and the
   * transport handed to the stream layer would then be an iterable whose first
   * bytes had already been consumed by a handshake that ended long ago.
   */
  #handshake(child: ChildProcess): Promise<ProcessIdentity> {
    const timeoutMs = this.#options.handshakeMs ?? 5_000;
    return new Promise<ProcessIdentity>((resolve, reject) => {
      const channel = child.stdio[IDENTITY_FD] as unknown as {
        on: (event: string, cb: (chunk: Buffer) => void) => void;
        removeAllListeners: () => void;
      };
      let text = "";
      // Captured only so a child that dies before reporting can say why; the
      // provider's own stderr belongs to the transport, not to this handshake.
      let stderr = "";
      const onStderr = (chunk: Buffer): void => {
        stderr += chunk.toString("utf8");
      };
      const onExit = (code: number | null, exitSignal: string | null): void => {
        settle(() => reject(new LauncherExited(code, exitSignal, stderr)));
      };
      const timer = setTimeout(() => {
        settle(() => reject(new HandshakeFailed(`no identity within ${timeoutMs} ms`)));
      }, timeoutMs);
      const settle = (finish: () => void): void => {
        clearTimeout(timer);
        channel.removeAllListeners();
        child.stderr?.removeListener("data", onStderr);
        child.removeListener("exit", onExit);
        finish();
      };
      child.stderr?.on("data", onStderr);
      channel.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (!text.includes("\n")) return;
        try {
          const identity = parseIdentityLine(text.slice(0, text.indexOf("\n")));
          settle(() => resolve(identity));
        } catch (error) {
          settle(() => reject(error));
        }
      });
      channel.on("error", (error) => {
        settle(() => reject(new HandshakeFailed("the control channel errored", { cause: error })));
      });
      child.once("exit", onExit);
    });
  }

  /**
   * The released process, as the stream layer will consume it.
   *
   * The prompt is written HERE, after release — never before. A prompt written
   * into a blocked launcher's stdin would sit in a pipe nobody is draining, and
   * one larger than the buffer would deadlock the host against its own barrier.
   */
  #transportFor(
    child: ChildProcess,
    runId: string,
    identity: ProcessIdentity,
    spec: ProcessSpec,
  ): ProcessTransport {
    const exit = new Promise<ProcessExit>((resolve) => {
      child.once("exit", (code: number | null, signal: string | null) => resolve({ code, signal }));
    });
    child.stdin?.end(spec.stdin);
    return {
      runId,
      identity,
      stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
      stderr: child.stderr as unknown as AsyncIterable<Uint8Array>,
      exit,
      cancel: async (reason: string) => {
        void reason;
        return this.#controller.terminateTree(identity);
      },
    };
  }
}

/** Re-exported so a caller sweeping the barrier's boundaries needs one import. */
export { BARRIER_STEPS };
export type { BarrierStep };
