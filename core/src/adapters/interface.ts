// The adapter contract: describe and parse. Never spawn.
//
// An adapter that can spawn can bypass PID registration, so no adapter can
// spawn — `execution/transport-broker.ts` is the only module in the repository
// that imports `node:child_process`, and the fence meta-test protects that
// boundary rather than a convention.
//
// `ProcessSpec` is PURE DATA. It is built and unit-tested down to exact argv
// without any child ever starting, which is what makes "the prompt never rides
// argv" a descriptor test instead of a code review.

import type { EdgeId, TaskState } from "../state/task-machine.ts";
import type { NormalizedEvent, RunErrorCode } from "../contracts/normalized-events.ts";
import type { ProcessIdentity, TerminationReport } from "../execution/launcher-barrier.ts";

/**
 * An adapter refusal, carrying one of the eleven error codes the contract
 * names. The code is the vocabulary the UI and the journal share, so an adapter
 * that fails for a reason outside it has to widen the list rather than invent a
 * private one.
 */
export class AdapterError extends Error {
  readonly code: RunErrorCode;
  readonly adapter: string;

  constructor(adapter: string, code: RunErrorCode, message: string) {
    super(`${adapter}: ${message} (${code})`);
    this.name = "AdapterError";
    this.code = code;
    this.adapter = adapter;
  }
}

// ---------------------------------------------------------------------------
// What an adapter knows about a model.
// ---------------------------------------------------------------------------

/**
 * `usageAuthority` and `costAuthority` are separate on purpose. Claude Pro
 * reports tokens authoritatively and cannot report a price at all, which
 * renders as `— subscription` and never as `$0.00`. Collapsing the two would
 * make a subscription route look free rather than unpriced.
 */
export interface ModelInfo {
  adapter: string;
  provider: string;
  requestedModel: string;
  /** `null` = the catalog declares no ceiling, which is not the same as zero. */
  contextWindow: number | null;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  continuity: "same-session-correction" | "none";
  usageAuthority: "provider" | "partial" | "none";
  costAuthority: "provider" | "catalog-estimate" | "unavailable";
}

export interface Availability {
  status: "available" | "blocked";
  /** `E_ADAPTER_UNVERIFIED` for an adapter that ships with an empty slot. */
  code?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Continuity: re-entering one provider conversation across turns.
// ---------------------------------------------------------------------------

/**
 * A provider conversation the host can re-enter, described in the only two
 * terms every CLI on this route actually has: an id it accepts on the command
 * line, and (where the CLI offers one) a directory it keeps that conversation's
 * state in.
 *
 * `providerSessionId` is a PROVIDER LOCATOR and therefore private. It lives at
 * `private/continuity.json`, mode 0600, and is absent from `status.json`, the
 * journal's public evidence, the SQLite public DTOs, the API, the dashboard,
 * error details, and commit messages. The public surface names a conversation
 * by the host's own handle (`PhaseSession.sessionId`) instead — see
 * `core/src/state/phase-machine.ts`.
 *
 * `storeDir` is `null` for a CLI with no equivalent of pi's `--session-dir`.
 * That is a real difference in how private the conversation transcript is, and
 * it is recorded rather than papered over: a `null` means the provider keeps
 * that transcript wherever it normally would.
 */
export interface ContinuityRef {
  readonly providerSessionId: string;
  readonly storeDir: string | null;
}

/**
 * `open` is a phase's first turn; `resume` is a correction turn that must
 * re-enter the same conversation. Whether the two produce different argv is the
 * adapter's business — pi's are byte-identical because `--session-id` both
 * creates and opens, while Claude Code swaps `--session-id` for `--resume`.
 */
export type ContinuityTurn = "open" | "resume";

export interface ContinuityRequest {
  readonly ref: ContinuityRef;
  readonly turn: ContinuityTurn;
}

/**
 * How the host proved, BEFORE launching, that a resume will re-enter the
 * conversation it names rather than quietly starting a fresh one.
 *
 * The two values are not interchangeable and the weaker one is named honestly:
 *
 *   · `host-visible-session-store` — the host handed the CLI its own session
 *     directory, read the conversation back out of it, and confirmed the exact
 *     id, the exact cwd, and at least one prior assistant turn. Nothing is
 *     taken on trust.
 *   · `provider-refuses-unknown-session` — the CLI keeps its sessions in its own
 *     store and refuses a resume of a session it does not have, so the refusal
 *     is the proof. This is weaker: it is established by the launch rather than
 *     before it, and it costs the correction's tokens to discover.
 */
export interface ContinuityEvidence {
  readonly proof: "host-visible-session-store" | "provider-refuses-unknown-session";
  readonly detail: string;
}

/**
 * What the STREAM said about the conversation that answered, filled in by the
 * adapter as it decodes.
 *
 * A mutable out-parameter rather than a return value because `execute` is an
 * async generator: the caller drains events and only afterwards asks who
 * answered. Both decoders already keep exactly this record internally; this is
 * the structural shape they have in common, so one caller can compare turns on
 * either route without knowing which route it is on.
 *
 * `null` on both fields is "the stream did not say", which is a different fact
 * from a value and is treated as terminal wherever identity is being proved.
 */
export interface ObservedProviderSession {
  sessionId: string | null;
  resolvedModel: string | null;
  costUsd?: number | null;
}

export interface ModelRequest {
  /** The model as the caller asked for it. An adapter that cannot represent it fails closed. */
  model: string;
  /** The prompt. It reaches the provider on stdin and nowhere else. */
  prompt: string;
  systemPromptPath?: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  effort?: string;
  tools?: readonly string[];
  /**
   * The tool profile the agent is configured with — `awsf.config.yaml`
   * § `agents[].tools.profile`.
   *
   * A profile NAME rather than the resolved flags, because what "read-only"
   * costs in argv is a fact about one provider's CLI and changes when that CLI
   * does. The adapter owns the translation; the config owns the intent.
   */
  profile?: string;
  /**
   * Present only when the host is opening or re-entering a conversation.
   *
   * ABSENT is the default and it means the ephemeral, non-persisting argv every
   * route used before continuity existed (`--no-session`,
   * `--no-session-persistence`). A request that carries no continuity gets the
   * byte-identical spec it always got, so a route configured `continuity: none`
   * cannot acquire a transcript on disk as a side effect of this capability
   * existing.
   */
  continuity?: ContinuityRequest;
}

/**
 * PURE DATA. Spawns nothing.
 *
 * `shell: false` is structural rather than a default: a spec that could carry
 * `true` would put the decision in the caller's hands, and there is no caller
 * that is allowed to make it.
 */
export interface ProcessSpec {
  /** A NAME; the broker resolves it against PATH and refuses what it cannot execute. */
  executable: string;
  /** An argv ARRAY, never a command line. */
  argv: readonly string[];
  cwd: string;
  /** Allowlist plus post-filter injection. The construction of it is the adapter's; transporting it is the broker's. */
  env: Readonly<Record<string, string>>;
  /** The prompt. NEVER argv. The broker writes it after release, so a blocked launcher never holds a full pipe. */
  stdin: string;
  shell: false;
}

// ---------------------------------------------------------------------------
// What the broker gives back.
// ---------------------------------------------------------------------------

export interface ProcessExit {
  code: number | null;
  signal: string | null;
}

/**
 * A started provider process, past the barrier.
 *
 * The streams are `AsyncIterable<Uint8Array>` rather than a Node `Readable` so
 * the contract stays platform-neutral: T12's LineFramer consumes bytes, and a
 * future HTTP transport can satisfy the same shape without pretending to be a
 * process.
 */
export interface ProcessTransport {
  /** The host-minted run id every event on this transport carries. */
  runId: string;
  identity: ProcessIdentity;
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  /** Resolves when the process-group leader exits. */
  exit: Promise<ProcessExit>;
  /** TERM → grace → KILL → enumerate → report reality. */
  cancel: (reason: string) => Promise<TerminationReport>;
}

/**
 * What the broker is told before it is allowed to create a child.
 *
 * Every field is something the caller must already have decided: which edge
 * authorized the launch, and which reservation is already holding the call.
 * The broker checks them BEFORE a child exists — a registration that arrives
 * without them is a provider launched off the books.
 */
export interface ProcessRegistration {
  /** Optional for source compatibility; an omitted kind is the original strict task-edge registration. */
  kind?: "task-edge";
  runId: string;
  sessionId: string;
  from: TaskState;
  to: TaskState;
  edge: EdgeId;
  /** Reserve-before-launch: the id `CallBudget.reserve` returned. */
  reservationId: string;
  adapterId: string;
  role: string;
}

/**
 * A provider launch inside an already-running compiled workflow. This is not a
 * task transition: it carries no from/to pair and can never manufacture the
 * forbidden RUNNING -> RUNNING self-transition.
 */
export interface AgentPhaseProcessRegistration {
  readonly kind: "agent-phase";
  readonly runId: string;
  readonly taskSessionId: string;
  readonly workflowId: string;
  readonly phaseId: string;
  /** One-based position in the compiled workflow, including local phases. */
  readonly phaseOrdinal: number;
  readonly reservationId: string;
  readonly adapterId: string;
  readonly role: string;
}

export interface AgentPhaseLaunchEvidence {
  readonly taskSessionId: string;
  readonly taskState: "RUNNING";
  readonly workflowId: string;
  readonly phaseId: string;
  readonly phaseOrdinal: number;
  readonly phaseKind: "agent";
  readonly adapterId: string;
  readonly role: string;
  /** Explicit config decides whether this phase uses this authorization class. */
  readonly launchAuthorization: "agent-phase";
}

/**
 * A correction turn inside an agent phase that has ALREADY spent its call.
 *
 * This is the third and last authorization class, and it exists because the
 * plan prices an intra-phase correction in tokens rather than calls
 * (§ "The escalation ladder", rungs 2 and 3) while every CLI on these routes
 * re-enters a conversation by starting a new process. Without it the two facts
 * could not both be true: either a correction bought a tier call it was never
 * supposed to cost, or a provider ran with no registration behind it.
 *
 * It reserves nothing, so what bounds it is not the ledger but the phase's own
 * correction allowance — `risk.correction_allowance`, per phase, charged by
 * `CallBudget.recordPhaseTransition` before the launch is even described. The
 * verifier re-checks that bound rather than trusting the caller, which is what
 * keeps "free" from meaning "unlimited".
 *
 * `originReservationId` names the reservation the phase's FIRST turn spent. It
 * is required to exist and to be already SPENT: a correction hangs off a paid
 * call and can never be the thing that starts a phase.
 */
export interface PhaseCorrectionProcessRegistration {
  readonly kind: "phase-correction";
  readonly runId: string;
  readonly taskSessionId: string;
  readonly workflowId: string;
  readonly phaseId: string;
  /** One-based position in the compiled workflow, including local phases. */
  readonly phaseOrdinal: number;
  /** One-based correction round. Round 0 is the first turn and is never this class. */
  readonly correctionRound: number;
  /** The tranche the phase machine charged for this round. */
  readonly tranche: "auto" | "owner";
  /** The already-spent reservation this phase's first turn converted on GO. */
  readonly originReservationId: string;
  readonly adapterId: string;
  readonly role: string;
  /**
   * The host handle for the conversation being re-entered — never the provider
   * locator. The provider locator reaches the child on argv and reaches nothing
   * else.
   */
  readonly continuityHandle: string;
}

export interface PhaseCorrectionLaunchEvidence {
  readonly taskSessionId: string;
  readonly taskState: "RUNNING";
  readonly workflowId: string;
  readonly phaseId: string;
  readonly phaseOrdinal: number;
  readonly phaseKind: "agent";
  readonly adapterId: string;
  readonly role: string;
  readonly correctionRound: number;
  readonly tranche: "auto" | "owner";
  readonly continuityHandle: string;
  /** The adapter's own verified answer, never the config's declaration alone. */
  readonly verifiedContinuity: "same-session-correction";
  readonly launchAuthorization: "phase-correction";
}

/**
 * Trusted host port for correction launches. Absent means corrections are
 * disabled, exactly as an absent `AgentPhaseLaunchVerifier` disables phase
 * launches — a capability nobody installed is a capability nobody has.
 */
export interface PhaseCorrectionLaunchVerifier {
  verify(registration: PhaseCorrectionProcessRegistration): PhaseCorrectionLaunchEvidence;
}

/**
 * Trusted host port. Its implementation checks durable task status, compiled
 * workflow identity, and explicit route config. The broker owns no state I/O;
 * without this injected verifier an agent-phase registration is unusable.
 */
export interface AgentPhaseLaunchVerifier {
  verify(registration: AgentPhaseProcessRegistration): AgentPhaseLaunchEvidence;
}

export interface TurnReconnectProcessRegistration {
  readonly kind: "turn-reconnect";
  readonly runId: string;
  readonly taskSessionId: string;
  readonly workflowId: string;
  readonly phaseId: string;
  readonly phaseOrdinal: number;
  readonly correctionRound: number;
  readonly adapterId: string;
  readonly role: string;
  readonly logicalTurnId: string;
  readonly continuityHandle: string;
  readonly originOperationId: string;
  readonly originAuthorizationId: string;
  readonly originReservationId: string;
  readonly interruptionAnchorId: string;
  readonly reconnectOperationId: string;
  readonly reconnectGeneration: number;
  readonly checkpointDigest: string;
  readonly admissionDigest: string;
  readonly ownerAmendmentDigest: string | null;
  readonly leaseId: string;
}

export type BrokerProcessRegistration =
  | ProcessRegistration
  | AgentPhaseProcessRegistration
  | PhaseCorrectionProcessRegistration
  | TurnReconnectProcessRegistration;

/**
 * The reservation a launch is accounted against, whichever class it is.
 *
 * A correction names it `originReservationId` rather than `reservationId`
 * because the two are in different STATES — a task-edge or agent-phase launch
 * holds its reservation and spends it on GO, while a correction's was spent by
 * the phase's first turn and is only being cited. One field name for both would
 * make "reserve before launch, never after" unreadable at the call site. This
 * function is for the callers that legitimately need either.
 */
export function reservationIdOf(registration: BrokerProcessRegistration): string {
  return registration.kind === "phase-correction" || registration.kind === "turn-reconnect"
    ? registration.originReservationId
    : registration.reservationId;
}

/** Whether a launch is a task transition, and therefore carries an edge. */
export function isTaskEdgeRegistration(
  registration: BrokerProcessRegistration,
): registration is ProcessRegistration {
  return registration.kind === undefined || registration.kind === "task-edge";
}

export interface TransportBroker {
  startProcess(
    registration: BrokerProcessRegistration,
    spec: ProcessSpec,
    signal: AbortSignal,
  ): Promise<ProcessTransport>;
}

// ---------------------------------------------------------------------------
// The adapter itself.
// ---------------------------------------------------------------------------

export interface HarnessAdapter {
  readonly id: string;
  isAvailable(signal?: AbortSignal): Promise<Availability>;
  getModelInfo(model: string): Promise<ModelInfo>;
  /** Pure — descriptor tests assert exact argv without starting anything. */
  buildSpec(request: ModelRequest): ProcessSpec;
  /**
   * Bytes to normalized events.
   *
   * `signal` is how the parser learns that a stream which ended was CANCELLED
   * rather than merely over. Killing a process group closes its pipes cleanly,
   * so EOF is all the stream itself can say; only the host that cancelled knows
   * why, and a run that reported `E_TERMINAL_MISSING` for its own deliberate
   * cancellation would be reporting a fault where there was a decision. Absent,
   * a stream that stops without a terminal is a failure — which is the right
   * default, because that is what it is.
   */
  parse(transport: ProcessTransport, signal?: AbortSignal): AsyncIterable<NormalizedEvent>;
  execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: AbortSignal,
    /** Filled in as the stream names the conversation and the model that answered. */
    observed?: ObservedProviderSession,
  ): AsyncIterable<NormalizedEvent>;
}

/**
 * The optional half of the contract an adapter implements when — and only when
 * — its production transport can genuinely re-enter a conversation.
 *
 * Deliberately a SEPARATE interface rather than more optional methods on
 * `HarnessAdapter`. `getModelInfo().continuity` is a claim the adapter makes
 * about itself, and the pilot that produced this file's continuity work failed
 * precisely because a claim and a transport had drifted apart. Requiring the
 * methods to exist makes the claim structural: a route the host is willing to
 * correct is one whose adapter can be asked, at compile time, where it keeps its
 * session state and how it proves a resume is a resume.
 */
export interface ContinuityCapableAdapter extends HarnessAdapter {
  readonly supportsSameSessionCorrection: true;
  /**
   * Where this adapter wants its private session state, given the phase's
   * private runtime directory, or `null` when the CLI has no flag for it. Pure:
   * it names a path and creates nothing.
   */
  continuityStoreDir(runtimeDir: string): string | null;
  /**
   * Pre-launch proof that `ref` names a conversation this phase can re-enter.
   * Throws `AdapterError` rather than returning false: a correction that cannot
   * establish continuity must not launch, and a boolean invites a caller to
   * carry on with the bad answer.
   */
  assertResumable(ref: ContinuityRef, context: { readonly cwd: string }): ContinuityEvidence;
  /**
   * The post-hoc half: did the turn that just answered answer as the same model
   * in the same conversation? Throws — a different model is `E_MODEL_MISMATCH`
   * and a different conversation is `E_BACKEND_FAILURE`, the two codes both
   * adapters already use for exactly these two facts.
   */
  assertSameSession(first: ObservedProviderSession, next: ObservedProviderSession): void;
}

/**
 * Whether the adapter in hand carries the continuity half of the contract.
 *
 * Checks the transport-side marker rather than `getModelInfo().continuity`,
 * because the whole point is that the two are separate assertions and both have
 * to hold. The runner asks this one AND the model info; a route that says
 * `same-session-correction` without the methods is a misconfiguration that
 * fails closed rather than a capability.
 */
export function isContinuityCapable(adapter: HarnessAdapter): adapter is ContinuityCapableAdapter {
  const candidate = adapter as Partial<ContinuityCapableAdapter>;
  return (
    candidate.supportsSameSessionCorrection === true &&
    typeof candidate.continuityStoreDir === "function" &&
    typeof candidate.assertResumable === "function" &&
    typeof candidate.assertSameSession === "function"
  );
}
