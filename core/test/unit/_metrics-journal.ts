// Synthetic attempt journals for the metrics tests. Every record goes through
// the projector's own `projectAttemptStatus`, live or through `awsf db
// rebuild`; nothing here reads or copies the owner's database.

import type { ProducerStatus } from "../../src/contracts/envelope-base.ts";
import type { NormalizedEvent, TokenUsage } from "../../src/contracts/normalized-events.ts";
import type { ReviewVerdict } from "../../src/contracts/review-output.ts";
import type { GateId } from "../../src/gates/interface.ts";
import type { RouteSelectionProvenance } from "../../src/contracts/route-selection.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../src/observability/attempt-evidence.ts";
import {
  createSession,
  projectAttemptStatus,
  type AttemptStatusProjection,
  type SessionInit,
} from "../../src/observability/projector.ts";
import type { DatabaseSync } from "../../src/observability/sqlite.ts";
import type { TaskState } from "../../src/state/task-machine.ts";

export const AT = "2026-09-26T10:00:00.000Z";

/** The committed config's shape, cut to what a route resolves from. */
export const SNAPSHOT = {
  adapters: {
    claude: { kind: "claude-code", executable: "claude" },
    codex: { kind: "pi-codex", executable: "pi", provider: "openai-codex" },
  },
  routing: { default_worker: "claude", review: "invert-provider", no_fallback: true },
  agents: [
    { name: "builder", model: "codex:gpt-6-sol", thinking: "xhigh", harness: { adapter: "codex" } },
    { name: "reviewer", model: "claude:opus", thinking: "high", harness: { adapter: "claude" } },
  ],
};

export function session(sessionId: string, snapshot: unknown = SNAPSHOT): SessionInit {
  return {
    sessionId,
    projectSlug: "awsf",
    taskId: `task-${sessionId}`,
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    workflowId: "shift",
    riskTier: 2,
    isProtected: false,
    requestText: "synthetic metrics fixture",
    callCeiling: 5,
    configSnapshotJson: JSON.stringify(snapshot),
    journalPath: `/synthetic/${sessionId}/journal.jsonl`,
    startedAt: AT,
  };
}

export function phase(key: string, owner: string, overrides: Partial<PhaseEvidenceRecord> = {}): PhaseEvidenceRecord {
  return {
    phaseId: `phase-${key}`,
    ordinal: 1,
    key,
    name: key,
    kind: "agent",
    owner,
    description: "synthetic phase",
    status: "RUNNING",
    correctionCount: 0,
    maxCorrections: 1,
    errorCode: null,
    errorMessage: null,
    startedAt: AT,
    endedAt: null,
    createdAt: AT,
    ...overrides,
  };
}

export function route(
  phaseKey: string,
  effective: { adapterId: string; adapterKind: string; provider: string; model: string; effort: RouteSelectionProvenance["effective"]["effort"] },
  effortSource: RouteSelectionProvenance["requested"]["sources"]["effort"],
  requestedModel: string,
): RouteSelectionProvenance {
  return {
    phaseId: phaseKey,
    requested: {
      phaseId: phaseKey,
      adapterId: effective.adapterId,
      provider: null,
      model: requestedModel,
      effort: effective.effort,
      sources: { adapter: "agent-default", provider: "unspecified", model: "agent-default", effort: effortSource },
      evaluation: null,
    },
    effective,
    observed: null,
    review: { mode: "not-review", degraded: false, detail: null },
  };
}

export const OPUS_HIGH = route(
  "shift-review",
  { adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus", effort: "high" },
  "attempt-override",
  "claude:opus",
);

export function usage(input: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number | null,
  relation: TokenUsage["reasoningRelation"] = "included-in-output"): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
    reasoningRelation: relation,
  };
}

/** Builds one attempt's evidence in journal order, each record one revision past the last. */
export class SyntheticAttempt {
  readonly init: SessionInit;
  readonly records: AttemptStatusProjection[] = [];
  /** The lifecycle state every later record carries; `transition` moves it. */
  lifecycleState: TaskState = "RUNNING";
  ownerReentries = 0;
  #eventSeq = 0;
  #transitionSeq = 0;

  constructor(init: SessionInit) {
    this.init = init;
  }

  push(evidence: AttemptEvidence): this {
    const revision = this.records.length + 1;
    this.records.push({
      ...this.init,
      lifecycleState: this.lifecycleState,
      baseSha: null,
      candidateSha: null,
      callsSpent: 0,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: this.ownerReentries,
      workerModelResolved: null,
      updatedAt: AT,
      endedAt: null,
      stateRevision: revision,
      evidence,
    });
    return this;
  }

  phase(record: PhaseEvidenceRecord): this {
    return this.push({ type: "phase", phase: record });
  }

  event(phaseId: string, runId: string, body: DistributiveOmit<NormalizedEvent, "seq" | "runId" | "hostAt" | "providerAt">): this {
    this.#eventSeq += 1;
    return this.push({
      type: "normalized-event",
      phaseId,
      event: { seq: this.#eventSeq, runId, hostAt: AT, providerAt: null, ...body } as NormalizedEvent,
    });
  }

  start(phaseId: string, agent: string, adapterId: string, provider: string, requestedModel: string,
    routeRecord?: RouteSelectionProvenance): this {
    return this.push({
      type: "agent-start",
      phaseId,
      agent,
      adapterId,
      provider,
      color: null,
      requestedModel,
      sandboxBadge: "tool-policy",
      sandboxMechanism: "adapter-tool-policy",
      purpose: agent === "reviewer" ? "review" : "build",
      ...(routeRecord === undefined ? {} : { route: routeRecord }),
      at: AT,
    });
  }

  call(phaseId: string, agent: string, adapterId: string, provider: string, requestedModel: string,
    resolvedModel: string, tokens: TokenUsage): this {
    return this.push({
      type: "agent",
      phaseId,
      agent,
      adapterId,
      provider,
      color: null,
      requestedModel,
      resolvedModel,
      modelProvenance: "stream-authoritative",
      contextWindow: 400_000,
      usageAuthority: "provider",
      usage: tokens,
      contextTokens: tokens.inputTokens,
      costUsd: null,
      costAuthority: "unavailable",
      purpose: agent === "reviewer" ? "review" : "build",
      at: AT,
    });
  }

  /** A host transition; the record that carries it already holds the new lifecycle state. */
  transition(to: TaskState, reasonCode: string | null = null): this {
    const from = this.lifecycleState;
    this.lifecycleState = to;
    this.#transitionSeq += 1;
    return this.push({
      type: "transition", id: `${this.init.sessionId}:transition:${this.#transitionSeq}`, seq: this.#transitionSeq,
      from, to, actor: "host", edgeId: to === "BLOCKED" ? "L5" : "L4", reasonSource: "process",
      reasonCode, reasonDetail: null, spawnSite: false, at: AT,
    });
  }

  gate(phaseId: string, round: number, gateId: GateId, passed: boolean): this {
    return this.push({
      type: "gate", id: `${phaseId}:${round}:${gateId}`, phaseId, round, gateId, kind: "pure", candidateSha: null,
      passed, exitCode: null, checks: [], violations: passed ? [] : [`${gateId} failed`], outputPath: null,
      startedAt: AT, endedAt: AT,
    });
  }

  envelope(phaseId: string, agent: string, round: number, producerStatus: ProducerStatus | null): this {
    return this.push({
      type: "envelope",
      phaseId,
      envelope: {
        envelopeId: `${phaseId}:${round}`, sessionId: this.init.sessionId, phaseId, correctionRound: round, agent,
        schemaId: "awsf.build-output/v1", valid: producerStatus !== null, createdAt: AT,
        payload: producerStatus === null
          ? null
          : { schema: "awsf.build-output/v1", producerStatus, summary: "synthetic", artifacts: [], notesForNextPhase: "" },
        violations: [], rawOutputPath: `raw/${phaseId}-${round}.txt`,
      },
    });
  }

  review(phaseId: string, verdict: ReviewVerdict): this {
    return this.push({
      type: "review", phaseId, adapterId: "claude", provider: "anthropic", verdict, reviewedSha: "0".repeat(40),
      findingCount: 0, at: AT,
    });
  }

  /** Projects every record live, as the running CLI does, and fails loudly on a degraded outcome. */
  project(db: DatabaseSync): void {
    createSession(db, this.init);
    this.records.forEach((status, index) => {
      const outcome = projectAttemptStatus(db, status, index + 1);
      if (!outcome.ok) throw new Error(`record ${index + 1} did not project: ${JSON.stringify(outcome.notice)}`);
    });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
