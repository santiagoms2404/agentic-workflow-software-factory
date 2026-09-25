import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { ModelResolutionProvenance, NormalizedEvent, TokenUsage } from "../contracts/normalized-events.ts";
import type { CandidateAdoptionEvidence } from "../contracts/candidate-adoption.ts";
import type { CandidateSeed } from "../contracts/candidate-seed.ts";
import type { ReviewVerdict } from "../contracts/review-output.ts";
import type { RouteSelectionProvenance } from "../contracts/route-selection.ts";
import type { StoredEnvelope } from "../contracts/stored-envelope.ts";
import type { BarrierRecord } from "../execution/launcher-barrier.ts";
import type { PhasePersistenceEvidence } from "../execution/phase-request.ts";
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
  | { readonly type: "protected-commit-intent"; readonly intent: import("../git/protected-commit.ts").ProtectedCommitIntent }
  /**
   * The identity of one `index.lock` at the moment its creator finished writing
   * it, before anything was published. It is the only thing that distinguishes
   * the interrupted writer's own lock from a replacement an ordinary same-user
   * Git could have taken in the meantime, so recovery refuses to adopt a lock
   * without one. A projector no-op, like `phase-validation-started`: it is
   * evidence a later reconciliation reads, not a fact the dashboard projects.
   */
  | { readonly type: "protected-lock-witness"; readonly witness: import("../git/protected-lock.ts").ProtectedLockWitness }
  /**
   * A ledger-aware dispatcher reached this occurrence's dispatch point. Absence
   * of an intent means "never ran" only under one of these: a passing hygiene
   * record alone cannot separate a governed run that died before its first
   * intent from a pre-ledger binary that dispatched silently.
   */
  | { readonly type: "command-occurrence-opened"; readonly opening: import("../contracts/command-ledger.ts").CommandOccurrenceOpened }
  /** One owner-configured command, recorded durably BEFORE it is spawned. */
  | { readonly type: "command-dispatch-intent"; readonly intent: import("../contracts/command-ledger.ts").CommandDispatchIntent }
  /** How it settled, recorded durably before any gate, envelope or phase reads the measurement. */
  | { readonly type: "command-dispatch-result"; readonly result: import("../contracts/command-ledger.ts").CommandDispatchResult }
  /**
   * This occurrence will dispatch nothing further, deliberately — either a gate
   * loop stopped early, or an abort between the hygiene record and the first
   * spawn meant it reached the dispatch point and dispatched nothing. Without
   * it the completeness predicate would read that silence as an ungoverned
   * dispatch and refuse every later decision in the attempt.
   */
  | { readonly type: "command-occurrence-closed"; readonly closure: import("../contracts/command-ledger.ts").CommandOccurrenceClosed }
  | { readonly type: "protected-grant"; readonly grant: import("../contracts/protected-grant.ts").ProtectedGrant }
  | { readonly type: "protected-activation"; readonly consumption: import("../contracts/protected-grant.ts").ProtectedGrantConsumption; readonly phase: PhaseEvidenceRecord }
  | { readonly type: "protected-candidate"; readonly binding: import("../contracts/protected-grant.ts").ProtectedCandidateBinding }
  | { readonly type: "protected-landing"; readonly authorization: import("../contracts/protected-grant.ts").ProtectedCandidateAuthorization }
  | { readonly type: "phase-result-ready"; readonly phase: PhaseEvidenceRecord; readonly checkpoint: import("../contracts/phase-recovery.ts").PhaseRecovery }
  | { readonly type: "phase-validation-started"; readonly phaseId: string; readonly checkpointId: string }
  | { readonly type: "phase-accepted"; readonly phase: PhaseEvidenceRecord; readonly accepted: import("../contracts/phase-recovery.ts").AcceptedPhase }
  | { readonly type: "quota-pause"; readonly checkpoint: import("../contracts/phase-recovery.ts").PhaseRecovery }
  | { readonly type: "ceiling-pause"; readonly checkpoint: import("../contracts/phase-recovery.ts").PhaseRecovery }
  | { readonly type: "resume-instruction-delivery"; readonly phaseId: string; readonly delivery: import("../contracts/owner-amendment.ts").OwnerAmendmentDelivery; readonly at: string }
  | { readonly type: "resume-activation"; readonly protectedConsumption?: import("../contracts/protected-grant.ts").ProtectedGrantConsumption; readonly ownerInstruction?: import("../contracts/resume-instruction.ts").ResumeInstruction | null; readonly quotaReadings?: readonly import("../contracts/phase-recovery.ts").BoundaryQuota[]; readonly operationId: string; readonly checkpointId: string; readonly reason: string; readonly reservationId: string | null; readonly phase: PhaseEvidenceRecord | null }
  | { readonly type: "candidate-seed"; readonly seed: CandidateSeed }
  /**
   * The owner's visual binding as the host verified it at start: digests, frame
   * ids and bound phases, never the root path or the pixels. Its private twin
   * holds the path; the two must agree for any later phase to launch.
   */
  | { readonly type: "visual-references-bound"; readonly bound: import("../contracts/visual-references.ts").VisualReferencesBound; readonly at: string }
  /** One bound phase launch received a fresh, re-verified copy of every bound frame. */
  | { readonly type: "visual-references-delivered"; readonly phaseId: string; readonly runId: string; readonly bindingDigest: string; readonly frames: readonly { readonly id: string; readonly sha256: string }[]; readonly readOnly: "os-enforced" | "digest-checked"; readonly at: string }
  /** What one turn's image tool actually returned into the model's context, by digest. */
  | { readonly type: "visual-reference-inspection"; readonly phaseId: string; readonly runId: string; readonly observations: readonly import("../contracts/visual-references.ts").VisualObservation[]; readonly at: string }
  | { readonly type: "owner-amendment-delivery"; readonly amendmentId: string; readonly amendmentDigest: string; readonly phaseId: string; readonly logicalTurnId: string; readonly originalInputDigest: string; readonly composedDigest: string; readonly at: string }
  | { readonly type: "candidate-adoption"; readonly adoption: CandidateAdoptionEvidence }
  | { readonly type: "rework-instruction-delivery"; readonly phaseId: string; readonly delivery: import("../contracts/owner-amendment.ts").OwnerAmendmentDelivery; readonly at: string }
  | { readonly type: "transition"; readonly protectedConsumption?: import("../contracts/protected-grant.ts").ProtectedGrantConsumption; readonly ownerAmendment?: import("../contracts/owner-amendment.ts").ReworkOwnerAmendment; readonly id: string; readonly seq: number; readonly from: TaskState; readonly to: TaskState; readonly actor: "host" | "owner" | "human"; readonly edgeId: string; readonly reasonSource: string; readonly reasonCode: string | null; readonly reasonDetail: string | null; readonly spawnSite: boolean; readonly at: string }
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
  | { readonly type: "agent-start"; readonly phaseId: string; readonly agent: string; readonly adapterId: string; readonly provider: string; readonly color: string | null; readonly requestedModel: string; readonly sandboxBadge: SandboxBadge; readonly sandboxMechanism: SandboxMechanism; readonly purpose?: RecordedAgentPurpose; readonly persistence?: PhasePersistenceEvidence; /** Optional only for journals written before route provenance existed. */ readonly route?: RouteSelectionProvenance; readonly at: string }
  | { readonly type: "agent"; readonly phaseId: string; readonly agent: string; readonly adapterId: string; readonly provider: string; readonly color: string | null; readonly requestedModel: string; readonly resolvedModel: string | null; readonly modelProvenance: ModelResolutionProvenance | null; readonly contextWindow: number | null; readonly usageAuthority: "provider" | "partial" | "none"; readonly usage: TokenUsage; readonly contextTokens: number | null; readonly costUsd: number | null; readonly costAuthority: "provider" | "catalog-estimate" | "unavailable"; readonly purpose?: RecordedAgentPurpose; readonly at: string }
  /**
   * An owner raise of one task's call ceiling. Session-level: it belongs to no
   * phase, moves no lifecycle edge, and carries the owner's written reason —
   * which is why it is evidence in its own right rather than a status field
   * that quietly changed.
   */
  | { readonly type: "ceiling-grant"; readonly calls: number; readonly from: number; readonly to: number; readonly reason: string; readonly attempt: number; readonly at: string }
  /**
   * An owner grant permitting this attempt's review to run on the builder's
   * provider. Session-level like a ceiling grant, and evidence for the same
   * reason: it carries the owner's written justification for a review with
   * less independence than the default, and nothing else can produce it.
   */
  | { readonly type: "review-degradation"; readonly reason: string; readonly attempt: number; readonly at: string }
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
