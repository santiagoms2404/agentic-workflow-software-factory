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
 * Trusted host port. Its implementation checks durable task status, compiled
 * workflow identity, and explicit route config. The broker owns no state I/O;
 * without this injected verifier an agent-phase registration is unusable.
 */
export interface AgentPhaseLaunchVerifier {
  verify(registration: AgentPhaseProcessRegistration): AgentPhaseLaunchEvidence;
}

export type BrokerProcessRegistration = ProcessRegistration | AgentPhaseProcessRegistration;

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
    registration: ProcessRegistration,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent>;
}
