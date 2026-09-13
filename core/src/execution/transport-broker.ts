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
//   1. validate either one of the six task-edge sites or a separately proven
//      agent phase inside the durable RUNNING sojourn,
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
  AgentPhaseLaunchEvidence,
  AgentPhaseLaunchVerifier,
  AgentPhaseProcessRegistration,
  BrokerProcessRegistration,
  PhaseCorrectionLaunchEvidence,
  PhaseCorrectionLaunchVerifier,
  PhaseCorrectionProcessRegistration,
  ProcessExit,
  ProcessRegistration,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../adapters/interface.ts";
import type { Reservation } from "./call-budget.ts";
import { isVerifiedReconnectAuthorization, type TurnReconnectLaunchVerifier, type VerifiedReconnectAuthorization } from "../workflow/turn-reconnect-authorization.ts";
import { continuityDigest } from "../contracts/interrupted-turn.ts";

function reservationIdOf(registration: BrokerProcessRegistration): string {
  return registration.kind === "phase-correction" || registration.kind === "turn-reconnect"
    ? registration.originReservationId
    : registration.reservationId;
}

// ---------------------------------------------------------------------------
// The six task-edge spawn sites.
// ---------------------------------------------------------------------------

/**
 * L4, L10, L11, L16, L19, L25 — DERIVED from the L-table's ✦ column rather
 * than restated here. A second list would be a second truth, and the one that
 * drifted would be this one. A unit test pins the derivation to the six the
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
  /** Errors that were not "absent here", kept so a machine fault is not read as a missing file. */
  readonly obstructions: readonly string[];

  constructor(executable: string, searched: readonly string[], obstructions: readonly string[] = []) {
    super(
      `executable ${JSON.stringify(executable)} is not runnable` +
        (searched.length === 0 ? "" : ` (searched ${searched.join(delimiter)})`) +
        (obstructions.length === 0
          ? ""
          : `; the search was obstructed rather than empty-handed: ${obstructions.join("; ")}`),
    );
    this.name = "ExecutableNotFound";
    this.executable = executable;
    this.obstructions = Object.freeze([...obstructions]);
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
function assertSpecSafe(
  registration: BrokerProcessRegistration,
  spec: ProcessSpec,
  reservationId: string,
): void {
  const refuse = (detail: string): never => {
    throw new SpawnRegistrationInvalid(registration.runId, detail);
  };
  if (registration.runId.length === 0) refuse("a launch needs a run id");
  if (reservationId.length === 0) {
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
  // `ENOENT` is the ordinary answer — the file is simply not in this directory —
  // and saying so for every entry on a long PATH would bury the interesting
  // case. Anything else is a machine condition rather than an absence: EACCES,
  // EMFILE, ENOMEM, EIO. Those are kept.
  //
  // A blocked run made the distinction worth having. Every entry on a PATH that
  // demonstrably contained the executable returned false at one instant and
  // true immediately afterwards, and the phase reported `is not runnable` — so
  // two sessions went looking for a missing or misconfigured binary that was
  // neither. Whatever the syscall actually said was discarded by a bare
  // `catch`, which is the same defect the envelope parser carried.
  const obstructions: string[] = [];
  const runnable = (candidate: string): boolean => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      if (code !== "ENOENT") obstructions.push(`${candidate}: ${code}`);
      return false;
    }
  };
  if (isAbsolute(executable)) {
    if (!runnable(executable)) throw new ExecutableNotFound(executable, [], obstructions);
    return executable;
  }
  if (executable.includes("/")) throw new ExecutableNotFound(executable, []);
  const searched = (env["PATH"] ?? "").split(delimiter).filter((entry) => entry.length > 0);
  for (const dir of searched) {
    const candidate = join(dir, executable);
    if (runnable(candidate)) return candidate;
  }
  throw new ExecutableNotFound(executable, searched, obstructions);
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
export interface SystemCommandOptions {
  readonly timeoutMs: number;
  readonly cwd?: string;
  readonly maxBuffer?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export function runSystemCommand(
  executable: string,
  argv: readonly string[],
  timeoutOrOptions: number | SystemCommandOptions,
): CommandResult {
  const options = typeof timeoutOrOptions === "number"
    ? { timeoutMs: timeoutOrOptions }
    : timeoutOrOptions;
  const result = spawnSync(executable, [...argv], {
    encoding: "utf8",
    timeout: options.timeoutMs,
    shell: false,
    windowsHide: true,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: { ...options.env } }),
    // A process table on a busy machine is large, and configured gate output is
    // bounded at this sole command boundary rather than after unbounded capture.
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
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

export interface BrokerReservationLedger extends ReservationLedger {
  /** Required by agent-phase preflight: the reservation must still be held before a child exists. */
  reservation(id: string): Reservation | undefined;
  assertReconnectEligible?(proof: VerifiedReconnectAuthorization): Reservation;
  claimReconnectLaunch?(proof: VerifiedReconnectAuthorization): void;
  authorizeReconnect?(proof: VerifiedReconnectAuthorization): Reservation;
}

export interface BrokerOptions {
  /**
   * Makes the registration durable — journal append + fsync, atomic status
   * replace, projector apply. Wired once, at host startup: `startProcess` takes
   * only what varies per launch.
   */
  register: (record: BarrierRecord) => Promise<void>;
  /** Persists reservation spend after the ledger charges it and before GO. */
  onSpent?: (record: BarrierRecord, reservation: Reservation) => Promise<void>;
  ledger: BrokerReservationLedger;
  /** Trusted host proof for intra-workflow phases. Absent means phase launches are disabled. */
  phaseLaunchVerifier?: AgentPhaseLaunchVerifier;
  /**
   * Trusted host proof for allowance-bounded correction turns. Absent means
   * corrections are disabled — a capability nobody installed is a capability
   * nobody has, and a free provider launch is the last one that should be
   * available by default.
   */
  correctionLaunchVerifier?: PhaseCorrectionLaunchVerifier;
  /** Missing verifier/accounting callback disables the reconnect class. */
  reconnectLaunchVerifier?: TurnReconnectLaunchVerifier;
  onReattached?: (record: BarrierRecord, reservation: Reservation, proof: VerifiedReconnectAuthorization) => Promise<void>;
  /**
   * Durable evidence for a launch that charged nothing. Distinct from `onSpent`
   * because the two say opposite things about the money, and one hook doing
   * both would make a correction indistinguishable from a spent call in the
   * journal.
   */
  onCorrection?: (record: BarrierRecord, evidence: PhaseCorrectionLaunchEvidence) => Promise<void>;
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
   * Task-edge and agent-phase registrations take distinct validators; neither
   * path can fall through to the other. Everything before
   * `runLauncherBarrier` is a refusal that costs nothing; everything inside it
   * either produces a registered, released provider or destroys the tree and
   * returns the reservation.
   */
  async startProcess(
    registration: BrokerProcessRegistration,
    spec: ProcessSpec,
    signal: AbortSignal,
    hooks: StartHooks = {},
  ): Promise<ProcessTransport> {
    if (registration.kind === "turn-reconnect") {
      // Preserve the exact verified descriptor through asynchronous registration.
      registration = Object.freeze({ ...registration });
      spec = Object.freeze({ ...spec, argv: Object.freeze([...spec.argv]), env: Object.freeze({ ...spec.env }) });
    }
    const phaseEvidence = registration.kind === "agent-phase"
      ? this.#assertAgentPhaseLaunch(registration)
      : null;
    const correctionEvidence = registration.kind === "phase-correction"
      ? this.#assertPhaseCorrectionLaunch(registration)
      : null;
    const reconnectEvidence = registration.kind === "turn-reconnect"
      ? this.#assertReconnectLaunch(registration, spec, "before-spawn") : null;
    const edge = phaseEvidence === null && correctionEvidence === null && reconnectEvidence === null
      ? assertSpawnSite(registration as ProcessRegistration)
      : null;
    // A correction carries the ALREADY-SPENT reservation its phase's first turn
    // converted, so the durable process row still names the call this turn hangs
    // off. Normalizing it here keeps `assertSpecSafe`'s "a call is reserved
    // before launch, never after" check meaningful on all three classes.
    const reservationId = reservationIdOf(registration);
    assertSpecSafe(registration, spec, reservationId);
    const executable = resolveExecutable(spec.executable, spec.env);
    const evidence = phaseEvidence ?? correctionEvidence ?? (reconnectEvidence === null ? null : {
      taskSessionId: reconnectEvidence.registration.taskSessionId, workflowId: reconnectEvidence.registration.workflowId,
      phaseId: reconnectEvidence.registration.phaseId, phaseOrdinal: reconnectEvidence.registration.phaseOrdinal,
      adapterId: reconnectEvidence.registration.adapterId, role: reconnectEvidence.registration.role,
    });

    const record: Omit<BarrierRecord, "identity"> = {
      runId: registration.runId,
      edge: edge?.id ?? null,
      ...(evidence === null ? {} : {
        phase: {
          taskSessionId: evidence.taskSessionId,
          workflowId: evidence.workflowId,
          phaseId: evidence.phaseId,
          phaseOrdinal: evidence.phaseOrdinal,
          adapterId: evidence.adapterId,
          role: evidence.role,
        },
      }),
      reservationId,
      command: [executable, ...spec.argv],
      cwd: spec.cwd,
      ...(reconnectEvidence === null ? {} : { reconnect: reconnectEvidence.registration }),
    };

    if (reconnectEvidence !== null) this.#options.ledger.claimReconnectLaunch!(reconnectEvidence);
    const held: { child: ChildProcess | null } = { child: null };
    let reattachedProof: VerifiedReconnectAuthorization | null = null;
    const outcome = await runLauncherBarrier({
      start: async () => {
        const started = this.#spawnGated(executable, spec, registration.runId);
        held.child = started.child;
        return started.launch;
      },
      record,
      ...(correctionEvidence === null ? {} : { settlement: "correction" as const }),
      ...(reconnectEvidence === null ? {} : {
        settlement: "reconnect" as const,
        reattach: (_record: BarrierRecord): Reservation => {
          if (registration.kind !== "turn-reconnect") throw new SpawnRegistrationInvalid(registration.runId, "reconnect registration changed");
          reattachedProof = this.#assertReconnectLaunch(registration, spec, "before-go");
          const debit = this.#options.ledger.authorizeReconnect!(reattachedProof);
          if (debit.id !== registration.originReservationId || debit.state !== "spent" || debit.cost !== 1 || debit.spent !== 1) {
            throw new SpawnRegistrationInvalid(registration.runId, "reconnect accounting did not return the original debit");
          }
          return debit;
        },
        onReattached: async (durableRecord: BarrierRecord, debit: Reservation): Promise<void> => {
          await this.#options.onReattached!(durableRecord, debit, reattachedProof!);
        },
        beforeReconnectGo: (): void => {
          if (registration.kind !== "turn-reconnect") throw new SpawnRegistrationInvalid(registration.runId, "reconnect registration changed");
          this.#assertReconnectLaunch(registration, spec, "before-release");
        },
      }),
      register: this.#options.register,
      ...(this.#options.onSpent === undefined ? {} : { onSpent: this.#options.onSpent }),
      ...(correctionEvidence === null || this.#options.onCorrection === undefined ? {} : {
        onCorrection: (durableRecord: BarrierRecord) => this.#options.onCorrection!(durableRecord, correctionEvidence),
      }),
      ledger: this.#options.ledger,
      signal,
      ...(hooks.onStep === undefined ? {} : { onStep: hooks.onStep }),
    });
    // Non-null by construction: the barrier only returns after `start` resolved.
    if (held.child === null) throw new SpawnRegistrationInvalid(registration.runId, "the barrier released a launch that never started");
    return this.#transportFor(held.child, registration.runId, outcome.identity, spec);
  }

  #assertReconnectLaunch(
    registration: Extract<BrokerProcessRegistration, { kind: "turn-reconnect" }>, spec: ProcessSpec,
    stage: "before-spawn" | "before-go" | "before-release",
  ): VerifiedReconnectAuthorization {
    const verifier = this.#options.reconnectLaunchVerifier;
    const ledger = this.#options.ledger;
    if (verifier === undefined || this.#options.onReattached === undefined ||
        typeof ledger.assertReconnectEligible !== "function" || typeof ledger.claimReconnectLaunch !== "function" || typeof ledger.authorizeReconnect !== "function") {
      throw new SpawnRegistrationInvalid(registration.runId, "reconnect verifier, ledger, or durable evidence callback is unavailable");
    }
    const proof = verifier.verify(registration, spec, stage);
    if (!isVerifiedReconnectAuthorization(proof, ledger) || proof.stage !== stage ||
        continuityDigest(proof.registration) !== continuityDigest(registration) || proof.descriptorDigest !== continuityDigest(spec)) {
      throw new SpawnRegistrationInvalid(registration.runId, "reconnect verifier returned evidence for another launch or descriptor");
    }
    const original = ledger.assertReconnectEligible(proof);
    if (original.id !== registration.originReservationId || original.cost !== 1 || (original.state !== "held" && original.state !== "spent")) {
      throw new SpawnRegistrationInvalid(registration.runId, "reconnect does not name this ledger's original liability");
    }
    return proof;
  }

  /** Distinct validator for launches that are not task transitions. Runs before spawn(). */
  #assertAgentPhaseLaunch(registration: AgentPhaseProcessRegistration): AgentPhaseLaunchEvidence {
    const refuse = (detail: string): never => {
      throw new SpawnRegistrationInvalid(registration.runId, `invalid agent-phase authorization: ${detail}`);
    };
    if (typeof registration.runId !== "string" || registration.runId.length === 0) refuse("runId is missing");
    if (typeof registration.taskSessionId !== "string" || registration.taskSessionId.length === 0) refuse("taskSessionId is missing");
    if (typeof registration.workflowId !== "string" || registration.workflowId.length === 0) refuse("workflowId is missing");
    if (typeof registration.phaseId !== "string" || registration.phaseId.length === 0) refuse("phaseId is missing");
    if (!Number.isInteger(registration.phaseOrdinal) || registration.phaseOrdinal < 1) refuse("phaseOrdinal must be a positive integer");
    if (typeof registration.adapterId !== "string" || registration.adapterId.length === 0) refuse("adapterId is missing");
    if (typeof registration.role !== "string" || registration.role.length === 0) refuse("role is missing");
    if (typeof registration.reservationId !== "string" || registration.reservationId.length === 0) refuse("one held reservation is required");

    const verifier = this.#options.phaseLaunchVerifier;
    if (verifier === undefined) return refuse("the trusted host verifier is not installed");
    const evidence = verifier.verify(registration);
    const exact =
      evidence.taskSessionId === registration.taskSessionId &&
      evidence.taskState === "RUNNING" &&
      evidence.workflowId === registration.workflowId &&
      evidence.phaseId === registration.phaseId &&
      evidence.phaseOrdinal === registration.phaseOrdinal &&
      evidence.phaseKind === "agent" &&
      evidence.adapterId === registration.adapterId &&
      evidence.role === registration.role &&
      evidence.launchAuthorization === "agent-phase";
    if (!exact) refuse("the trusted verifier returned evidence for a different launch");

    const reservation = this.#options.ledger.reservation(registration.reservationId);
    if (reservation === undefined || reservation.state !== "held" || reservation.cost !== 1) {
      refuse("reservation is unknown, settled, or not exactly one held call");
    }
    return evidence;
  }

  /**
   * The third validator: an allowance-bounded correction turn, which reserves
   * nothing and therefore has to be bounded by something else.
   *
   * Everything the agent-phase validator checks is checked here too, through the
   * same trusted-verifier port, because a correction is still a provider launch
   * inside a durable `RUNNING` sojourn and none of those guarantees weaken. What
   * is added is the part that replaces the reservation as the ceiling:
   *
   *   · the origin reservation exists AND is already spent — a correction hangs
   *     off a paid call and can never be the thing that starts a phase, which is
   *     what stops this class being a free first turn;
   *   · the round is a positive integer, so round 0 (the first turn) can never
   *     arrive here wearing the cheap class;
   *   · the verifier's own answer about the round, the tranche, the continuity
   *     handle and the adapter's VERIFIED continuity must match the registration
   *     exactly — the caller declares, the host proves, and a mismatch is a
   *     refusal rather than a preference.
   */
  #assertPhaseCorrectionLaunch(
    registration: PhaseCorrectionProcessRegistration,
  ): PhaseCorrectionLaunchEvidence {
    const refuse = (detail: string): never => {
      throw new SpawnRegistrationInvalid(registration.runId, `invalid correction authorization: ${detail}`);
    };
    if (typeof registration.runId !== "string" || registration.runId.length === 0) refuse("runId is missing");
    if (typeof registration.taskSessionId !== "string" || registration.taskSessionId.length === 0) refuse("taskSessionId is missing");
    if (typeof registration.workflowId !== "string" || registration.workflowId.length === 0) refuse("workflowId is missing");
    if (typeof registration.phaseId !== "string" || registration.phaseId.length === 0) refuse("phaseId is missing");
    if (!Number.isInteger(registration.phaseOrdinal) || registration.phaseOrdinal < 1) refuse("phaseOrdinal must be a positive integer");
    if (!Number.isInteger(registration.correctionRound) || registration.correctionRound < 1) {
      refuse("correctionRound must be a positive integer; round 0 is the phase's first turn and reserves a call");
    }
    if (registration.tranche !== "auto" && registration.tranche !== "owner") refuse("tranche must be auto or owner");
    if (typeof registration.adapterId !== "string" || registration.adapterId.length === 0) refuse("adapterId is missing");
    if (typeof registration.role !== "string" || registration.role.length === 0) refuse("role is missing");
    if (typeof registration.continuityHandle !== "string" || registration.continuityHandle.length === 0) {
      refuse("continuityHandle is missing");
    }
    if (typeof registration.originReservationId !== "string" || registration.originReservationId.length === 0) {
      refuse("originReservationId is missing; a correction hangs off the call its phase already spent");
    }

    const verifier = this.#options.correctionLaunchVerifier;
    if (verifier === undefined) return refuse("the trusted correction verifier is not installed");
    const evidence = verifier.verify(registration);
    const exact =
      evidence.taskSessionId === registration.taskSessionId &&
      evidence.taskState === "RUNNING" &&
      evidence.workflowId === registration.workflowId &&
      evidence.phaseId === registration.phaseId &&
      evidence.phaseOrdinal === registration.phaseOrdinal &&
      evidence.phaseKind === "agent" &&
      evidence.adapterId === registration.adapterId &&
      evidence.role === registration.role &&
      evidence.correctionRound === registration.correctionRound &&
      evidence.tranche === registration.tranche &&
      evidence.continuityHandle === registration.continuityHandle &&
      evidence.verifiedContinuity === "same-session-correction" &&
      evidence.launchAuthorization === "phase-correction";
    if (!exact) refuse("the trusted verifier returned evidence for a different launch");

    const origin = this.#options.ledger.reservation(registration.originReservationId);
    if (origin === undefined || origin.state !== "spent") {
      refuse("the origin reservation is unknown or was never spent; a correction follows a paid call");
    }
    return evidence;
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
