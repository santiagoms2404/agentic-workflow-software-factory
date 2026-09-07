import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { ModelResolutionProvenance, NormalizedEvent, TokenUsage } from "../contracts/normalized-events.ts";
import type { ReviewVerdict } from "../contracts/review-output.ts";
import type { RouteSelectionProvenance } from "../contracts/route-selection.ts";
import type { StoredEnvelope } from "../contracts/stored-envelope.ts";
import type { BarrierRecord } from "../execution/launcher-barrier.ts";
import type { GateCheck, GateId } from "../gates/interface.ts";
import type { SandboxBadge, SandboxGrant } from "../policy/sandbox-broker.ts";
import type { TaskState } from "../state/task-machine.ts";

export type SandboxMechanism = SandboxGrant["mechanism"];

/**
 * Which side of the inversion an agent call sat on.
 *
 * `build` is the candidate-producing phase — structurally, the agent phase
 * whose schema is `BUILD_OUTPUT_SCHEMA_ID`, which is the one the review provider
 * is computed against. It is the only call whose provider proves the inversion.
 *
 * `support` is any other non-review agent: a planner, a documenter, a scout. It
 * is a worker in every ordinary sense, and it is deliberately NOT the fact the
 * worker columns record. `simple-sdlc` runs three of them, and while they all
 * claimed one purpose the projector's last write won — a run whose builder was
 * on one provider and reviewer on the other projected both columns as the
 * documenter's, so a correctly inverted run read as uninverted on the dashboard.
 *
 * `worker` is the pre-distinction spelling and is READ, never written. Journals
 * recorded before this split carry it, or carry nothing at all, and a rebuild of
 * one must not invent a purpose it never recorded: both are projected exactly
 * the way they always were.
 */
export type AgentPurpose = "build" | "support" | "review";
export type RecordedAgentPurpose = AgentPurpose | "worker";

export interface PhaseEvidenceRecord {
  readonly phaseId: string;
  readonly ordinal: number;
  readonly key: string;
  readonly name: string;
  readonly kind: "agent" | "code" | "engineer";
  readonly owner: string;
  readonly description: string;
  readonly status: string;
  readonly correctionCount: number;
  readonly maxCorrections: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

/** Canonical production evidence carried by one attempt-journal record. */
export type AttemptEvidence =
  | { readonly type: "transition"; readonly id: string; readonly seq: number; readonly from: TaskState; readonly to: TaskState; readonly actor: "host" | "owner" | "human"; readonly edgeId: string; readonly reasonSource: string; readonly reasonCode: string | null; readonly reasonDetail: string | null; readonly spawnSite: boolean; readonly at: string }
  | { readonly type: "phase"; readonly phase: PhaseEvidenceRecord }
  | { readonly type: "normalized-event"; readonly phaseId: string; readonly event: NormalizedEvent }
  | {
      readonly type: "compiled-prompt";
      readonly phaseId: string;
      readonly name: string;
      /** Full compiled bytes remain canonical for display and legacy digest derivation. */
      readonly text: string;
      readonly lineCount: number;
      /** Present on composed system prompts; optional for legacy journals and user prompts. */
      readonly roleSystemDigest?: string;
      readonly sharedBlockDigest?: string;
      readonly composedSystemDigest?: string;
      readonly compositionVersion?: string;
      readonly at: string;
    }
  | { readonly type: "process"; readonly phaseId: string; readonly adapterId: string; readonly role: string; readonly record: BarrierRecord; readonly status: "REGISTERED" | "RUNNING" | "EXITED" | "FAILED" | "CANCELLED"; readonly registeredAt: string; readonly releasedAt: string | null; readonly endedAt: string | null; readonly exitCode: number | null; readonly exitSignal: string | null }
  | { readonly type: "envelope"; readonly phaseId: string; readonly envelope: StoredEnvelope<EnvelopeBase> }
  | { readonly type: "gate"; readonly id: string; readonly phaseId: string; readonly round: number; readonly gateId: GateId; readonly kind: "pure" | "filesystem" | "git" | "subprocess" | "journey"; readonly candidateSha: string | null; readonly passed: boolean; readonly exitCode: number | null; readonly checks: readonly GateCheck[]; readonly violations: readonly string[]; readonly outputPath: string | null; readonly startedAt: string; readonly endedAt: string }
  | { readonly type: "agent-start"; readonly phaseId: string; readonly agent: string; readonly adapterId: string; readonly provider: string; readonly color: string | null; readonly requestedModel: string; readonly sandboxBadge: SandboxBadge; readonly sandboxMechanism: SandboxMechanism; readonly purpose?: RecordedAgentPurpose; /** Optional only for journals written before route provenance existed. */ readonly route?: RouteSelectionProvenance; readonly at: string }
  | { readonly type: "agent"; readonly phaseId: string; readonly agent: string; readonly adapterId: string; readonly provider: string; readonly color: string | null; readonly requestedModel: string; readonly resolvedModel: string | null; readonly modelProvenance: ModelResolutionProvenance | null; readonly contextWindow: number | null; readonly usageAuthority: "provider" | "partial" | "none"; readonly usage: TokenUsage; readonly contextTokens: number | null; readonly costUsd: number | null; readonly costAuthority: "provider" | "catalog-estimate" | "unavailable"; readonly purpose?: RecordedAgentPurpose; readonly at: string }
  /**
   * An owner raise of one task's call ceiling. Session-level: it belongs to no
   * phase, moves no lifecycle edge, and carries the owner's written reason —
   * which is why it is evidence in its own right rather than a status field
   * that quietly changed.
   */
  | { readonly type: "ceiling-grant"; readonly calls: number; readonly from: number; readonly to: number; readonly reason: string; readonly attempt: number; readonly at: string }
  | { readonly type: "quota-snapshot"; readonly attribution: "none"; readonly scope: "account-window"; readonly completedPhaseKey: string; readonly nextPhaseKey: string; readonly effectivePercentRemaining: number | null; readonly minutesToReset: number | null; readonly reasonCode: string | null; readonly resolvedVersion: string | null }
  | {
      readonly type: "publish";
      readonly remote: string;
      readonly branch: string;
      readonly publishedSha: string;
      readonly outcome: "created" | "already-current" | "fast-forwarded" | "rejected" | "fault";
      readonly remotePriorSha: string | null;
      readonly at: string;
      /** Added with awsf.publish-output/v1; absent on historical publication records. */
      readonly phaseId?: string;
      readonly envelope?: StoredEnvelope<EnvelopeBase>;
    }
  | { readonly type: "review"; readonly phaseId: string; readonly adapterId: string; readonly provider: string; readonly verdict: ReviewVerdict; readonly reviewedSha: string; readonly findingCount: number; readonly at: string };
