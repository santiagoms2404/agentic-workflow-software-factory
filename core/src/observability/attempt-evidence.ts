import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { ModelResolutionProvenance, NormalizedEvent, TokenUsage } from "../contracts/normalized-events.ts";
import type { StoredEnvelope } from "../contracts/stored-envelope.ts";
import type { BarrierRecord } from "../execution/launcher-barrier.ts";
import type { GateCheck, GateId } from "../gates/interface.ts";
import type { TaskState } from "../state/task-machine.ts";

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
  | { readonly type: "compiled-prompt"; readonly phaseId: string; readonly name: string; readonly text: string; readonly lineCount: number; readonly at: string }
  | { readonly type: "process"; readonly phaseId: string; readonly adapterId: string; readonly role: string; readonly record: BarrierRecord; readonly status: "REGISTERED" | "RUNNING" | "EXITED" | "FAILED" | "CANCELLED"; readonly registeredAt: string; readonly releasedAt: string | null; readonly endedAt: string | null; readonly exitCode: number | null; readonly exitSignal: string | null }
  | { readonly type: "envelope"; readonly phaseId: string; readonly envelope: StoredEnvelope<EnvelopeBase> }
  | { readonly type: "gate"; readonly id: string; readonly phaseId: string; readonly round: number; readonly gateId: GateId; readonly kind: "pure" | "filesystem" | "git" | "subprocess" | "journey"; readonly candidateSha: string | null; readonly passed: boolean; readonly exitCode: number | null; readonly checks: readonly GateCheck[]; readonly violations: readonly string[]; readonly outputPath: string | null; readonly startedAt: string; readonly endedAt: string }
  | { readonly type: "agent"; readonly phaseId: string; readonly agent: string; readonly adapterId: string; readonly provider: string; readonly color: string | null; readonly requestedModel: string; readonly resolvedModel: string | null; readonly modelProvenance: ModelResolutionProvenance | null; readonly contextWindow: number | null; readonly usageAuthority: "provider" | "partial" | "none"; readonly usage: TokenUsage; readonly contextTokens: number | null; readonly costUsd: number | null; readonly costAuthority: "provider" | "catalog-estimate" | "unavailable"; readonly at: string };
