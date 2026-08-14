import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { TokenUsage } from "../contracts/normalized-events.ts";
import type { StoredEnvelope, ValidationViolation } from "../contracts/stored-envelope.ts";
import type { GateCheck, GateReport } from "../gates/interface.ts";
import type { AgentSessionIdentity } from "./phase.ts";

export const MAX_GATE_OUTPUT_TAIL_CHARS = 4_000;
export const MAX_PARSE_FIX_ATTEMPTS = 2;

export interface AgentTurn {
  readonly identity: AgentSessionIdentity;
  readonly rawOutput: string;
  readonly usage: TokenUsage;
  /** Provider price or catalog estimate when available; null is unknown, never zero. */
  readonly costUsd: number | null;
}

/** A live conversation. There is deliberately no reopen/fallback method on this interface. */
export interface CorrectionSession {
  readonly identity: AgentSessionIdentity;
  send(prompt: string): Promise<AgentTurn>;
}

export class CorrectionIdentityMismatch extends Error {
  readonly differences: readonly string[];

  constructor(differences: readonly string[]) {
    super(`correction did not resume the same adapter/provider/model/session: ${differences.join("; ")}`);
    this.name = "CorrectionIdentityMismatch";
    this.differences = Object.freeze([...differences]);
  }
}

export class CorrectionTransportFailure extends Error {
  readonly phaseId: string;
  readonly correctionRound: number;
  readonly coldRestartAttempted = false;
  readonly cause: unknown;

  constructor(phaseId: string, correctionRound: number, cause: unknown) {
    // The cause travels in the MESSAGE, not only in the `cause` field. This
    // error is what a blocked attempt writes into `status.json` as
    // `blocker.detail`, and the first version said only that the session was not
    // cold-restarted — true, and useless: an operator reading it could not tell
    // a provider that answered as somebody else from one that never answered at
    // all. Those are different faults with different next steps.
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    super(
      `phase ${phaseId} correction round ${correctionRound} transport failed; ` +
        `the session was not cold-restarted: ${detail}`,
    );
    this.name = "CorrectionTransportFailure";
    this.phaseId = phaseId;
    this.correctionRound = correctionRound;
    this.cause = cause;
  }
}

const IDENTITY_FIELDS = ["adapter", "provider", "model", "sessionId"] as const;

export function assertCorrectionIdentity(
  expected: AgentSessionIdentity,
  actual: AgentSessionIdentity,
): void {
  const differences = IDENTITY_FIELDS
    .filter((field) => expected[field] !== actual[field])
    .map((field) => `${field} ${JSON.stringify(expected[field])} became ${JSON.stringify(actual[field])}`);
  if (differences.length > 0) throw new CorrectionIdentityMismatch(differences);
}

function tail(value: string): string {
  return value.length <= MAX_GATE_OUTPUT_TAIL_CHARS
    ? value
    : value.slice(value.length - MAX_GATE_OUTPUT_TAIL_CHARS);
}

export interface CorrectionGateCheck extends GateCheck {
  readonly note: string;
}

export interface CorrectionGateReport {
  readonly gateId: string;
  readonly passed: boolean;
  readonly checks: readonly CorrectionGateCheck[];
}

/**
 * One configured host command that failed against the exact candidate.
 *
 * `evidence` is the bounded head/failure/tail rendering from
 * `gates/command-evidence.ts`, never the raw output and never only its tail —
 * see that file's header for the measured defect this shape exists to fix. The
 * complete output stays host-private and is referenced, not attached:
 * `outputRef` is an attempt-relative path the model is told exists and is never
 * told how to open, because it cannot and must not.
 */
export interface CorrectionCommandFailure {
  readonly gateId: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly evidence: string;
}

/**
 * What a candidate-level correction is answering for: an exact commit, and the
 * deterministic commands that failed against it.
 *
 * Separate from `gateReports` on purpose. A gate report says which check failed;
 * this says what the host ran, what it exited with, and what it printed. The
 * pilot had the first and not the second, which is exactly how a builder and a
 * host ended up disagreeing about whether the suite was green with no way to
 * settle it.
 */
export interface CorrectionCandidateEvidence {
  readonly candidateSha: string;
  readonly baseSha: string;
  readonly commands: readonly CorrectionCommandFailure[];
}

export interface CorrectionRequest {
  readonly kind: "awsf.correction-request/v1";
  readonly phase: string;
  readonly round: number;
  readonly previousEnvelopeRef: string;
  readonly schemaViolations: readonly ValidationViolation[];
  readonly gateReports: readonly CorrectionGateReport[];
  readonly remainingCallBudget: number;
  /** Present only when a deterministic command gate failed at an exact candidate. */
  readonly candidate?: CorrectionCandidateEvidence;
}

export function createCorrectionRequest(input: {
  phase: string;
  round: number;
  previousEnvelope: StoredEnvelope<EnvelopeBase>;
  gateReports: readonly GateReport[];
  remainingCallBudget: number;
  candidate?: CorrectionCandidateEvidence;
}): CorrectionRequest {
  return Object.freeze({
    kind: "awsf.correction-request/v1",
    phase: input.phase,
    round: input.round,
    previousEnvelopeRef: input.previousEnvelope.envelopeId,
    schemaViolations: Object.freeze([...input.previousEnvelope.violations]),
    gateReports: Object.freeze(input.gateReports.map((report) => Object.freeze({
      gateId: report.gateId,
      passed: report.passed,
      checks: Object.freeze(report.checks.map((check) => Object.freeze({ ...check, note: tail(check.note) }))),
    }))),
    remainingCallBudget: input.remainingCallBudget,
    ...(input.candidate === undefined ? {} : {
      candidate: Object.freeze({
        candidateSha: input.candidate.candidateSha,
        baseSha: input.candidate.baseSha,
        commands: Object.freeze(input.candidate.commands.map((command) => Object.freeze({
          gateId: command.gateId,
          argv: Object.freeze([...command.argv]),
          exitCode: command.exitCode,
          evidence: command.evidence,
        }))),
      }),
    }),
  });
}

/**
 * The prompt a resumed session receives.
 *
 * The candidate half is rendered as prose above the JSON rather than left
 * inside it, because the instruction that matters — the commit already exists,
 * fix the tree, do not re-do the work — is the one a model most needs to read
 * first. Everything in it is already bounded and scrubbed by the time it
 * arrives; nothing here widens what was passed in.
 */
export function renderCorrectionRequest(request: CorrectionRequest): string {
  const parts = [
    "Correct the previous phase output in this same session.",
    "Return only a replacement envelope matching the output schema already supplied.",
  ];
  if (request.candidate !== undefined) {
    const { candidateSha, baseSha, commands } = request.candidate;
    parts.push(
      [
        `The host committed your previous work as candidate ${candidateSha} (base ${baseSha}) and then ran the`,
        "configured quality commands against that exact commit. They did not pass.",
        "",
        "Fix the defect in the working tree. Do not revert the candidate, do not re-implement what already",
        "works, and do not create a commit — the host commits your corrected tree as the next candidate and",
        "re-runs every gate against it.",
        "",
        ...commands.map((command) => [
          `Command \`${command.gateId}\`: ${JSON.stringify(command.argv)} exited ${String(command.exitCode)}.`,
          command.evidence,
        ].join("\n")),
      ].join("\n"),
    );
  }
  parts.push(JSON.stringify(request, null, 2));
  return parts.join("\n\n");
}

export function renderParseFixRequest(input: {
  phase: string;
  round: number;
  previousEnvelope: StoredEnvelope<EnvelopeBase>;
  remainingCallBudget: number;
}): string {
  return renderCorrectionRequest(createCorrectionRequest({
    phase: input.phase,
    round: input.round,
    previousEnvelope: input.previousEnvelope,
    gateReports: [],
    remainingCallBudget: input.remainingCallBudget,
  }));
}

export interface PhaseUsage {
  /** Sum over every send. Null means no send reported that metric. */
  readonly spend: TokenUsage;
  readonly costUsd: number | null;
  /** The last send only: retries re-enter one context window. */
  readonly contextOccupancy: TokenUsage;
  readonly sends: number;
}

const COUNT_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;

export class UsageAccumulator {
  readonly #totals: Record<(typeof COUNT_FIELDS)[number], number | null> = {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };
  #last: TokenUsage | null = null;
  #costUsd: number | null = null;
  #sends = 0;

  add(turn: Pick<AgentTurn, "usage" | "costUsd">): void {
    this.#sends += 1;
    this.#last = { ...turn.usage };
    for (const field of COUNT_FIELDS) {
      const value = turn.usage[field];
      if (value !== null) this.#totals[field] = (this.#totals[field] ?? 0) + value;
    }
    if (turn.costUsd !== null) this.#costUsd = (this.#costUsd ?? 0) + turn.costUsd;
  }

  snapshot(): PhaseUsage {
    if (this.#last === null) throw new Error("phase usage is unavailable before the first send");
    return Object.freeze({
      spend: Object.freeze({ ...this.#totals, reasoningRelation: "unknown" as const }),
      costUsd: this.#costUsd,
      contextOccupancy: Object.freeze({ ...this.#last }),
      sends: this.#sends,
    });
  }
}
