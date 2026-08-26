// Pure readout of a project's position on the five-stage ladder.
//
// Every value here was already resolved by the registry or read from the
// journal by the caller. This module holds no database handle, performs no
// transition, and never goes and looks.

import type { ResolvedProject } from "../registry/resolve.ts";
import type {
  EnvelopeRow,
  PhaseRow,
  SessionRow,
  TransitionRow,
} from "../observability/queries.ts";
import { STAGES, type StageId, type StageRecord } from "./contract.ts";

export interface StageEnvelopeRow extends EnvelopeRow {
  readonly session_id: string;
  readonly phase_id: string;
}

export interface StageTransitionRow extends TransitionRow {
  readonly session_id: string;
}

export interface StageJournalRows {
  readonly sessions: readonly SessionRow[];
  readonly phases: readonly PhaseRow[];
  /** Rows from envelopesForPhase, annotated by the caller with that query's keys. */
  readonly envelopes: readonly StageEnvelopeRow[];
  /** Rows from transitionsForSession, annotated by the caller with that query's session key. */
  readonly transitions: readonly StageTransitionRow[];
}

export type StagePosition = StageId | "before S1" | "past S5";

export interface StageEvidence {
  readonly schemaId: string;
  readonly phaseId: string;
}

export interface StageResolution {
  readonly current: StagePosition;
  readonly next: StageId | null;
  readonly ownerAct: string | null;
  readonly evidence: StageEvidence | null;
}

function stageCommand(stage: StageRecord): string {
  return stage.granularity === "task"
    ? `awsf new --workflow ${stage.producer}`
    : stage.producer;
}

function stageIndexForWorkflow(workflowId: string): number {
  return STAGES.findIndex((stage) =>
    workflowId === stage.id || workflowId === stage.producer,
  );
}

function compareEvidence(left: StageEnvelopeRow, right: StageEnvelopeRow, phases: ReadonlyMap<string, PhaseRow>): number {
  const leftOrdinal = phases.get(left.phase_id)?.ordinal ?? -1;
  const rightOrdinal = phases.get(right.phase_id)?.ordinal ?? -1;
  return leftOrdinal - rightOrdinal
    || left.correction_round - right.correction_round
    || left.created_at.localeCompare(right.created_at)
    || left.envelope_id.localeCompare(right.envelope_id);
}

/** Answers where the project is and what the owner types next. It never acts. */
export function resolveStage(project: ResolvedProject, rows: StageJournalRows): StageResolution {
  const sessions = rows.sessions.filter((session) => session.project_slug === project.slug);
  if (sessions.length === 0) {
    const first = STAGES[0];
    return {
      current: "before S1",
      next: first.id,
      ownerAct: stageCommand(first),
      evidence: null,
    };
  }

  const sessionIds = new Set(sessions.map((session) => session.session_id));
  const sessionById = new Map(sessions.map((session) => [session.session_id, session] as const));
  const published = rows.transitions.some((transition) =>
    sessionIds.has(transition.session_id) && transition.to_state === "PUBLISHED",
  ) || sessions.some((session) => session.lifecycle_state === "PUBLISHED");

  const projectPhases = rows.phases.filter((phase) => sessionIds.has(phase.session_id));
  const phaseById = new Map(projectPhases.map((phase) => [phase.phase_id, phase] as const));
  const envelopes = rows.envelopes.filter((envelope) =>
    sessionIds.has(envelope.session_id)
    && phaseById.get(envelope.phase_id)?.session_id === envelope.session_id
    && envelope.valid === 1,
  );

  let currentIndex = -1;
  for (const session of sessions) {
    currentIndex = Math.max(currentIndex, stageIndexForWorkflow(session.workflow_id));
  }
  for (const envelope of envelopes) {
    const session = sessionById.get(envelope.session_id);
    const envelopeIndex = session === undefined ? -1 : stageIndexForWorkflow(session.workflow_id);
    const envelopeStage = STAGES[envelopeIndex];
    if (envelopeStage !== undefined && !envelopeStage.blocked && envelopeStage.schemaId === envelope.schema_id) {
      currentIndex = Math.max(currentIndex, envelopeIndex);
    }
  }

  if (published) {
    const evidenceEnvelope = envelopes
      .filter((envelope) =>
        envelope.schema_id === STAGES[3].schemaId
        && stageIndexForWorkflow(sessionById.get(envelope.session_id)?.workflow_id ?? "") === 3,
      )
      .sort((left, right) => compareEvidence(left, right, phaseById))
      .at(-1);
    return {
      current: "past S5",
      next: null,
      ownerAct: null,
      evidence: evidenceEnvelope === undefined
        ? null
        : { schemaId: evidenceEnvelope.schema_id, phaseId: evidenceEnvelope.phase_id },
    };
  }

  if (currentIndex < 0) {
    const first = STAGES[0];
    return {
      current: "before S1",
      next: first.id,
      ownerAct: stageCommand(first),
      evidence: null,
    };
  }

  const current = STAGES[currentIndex]!;
  const next = STAGES[currentIndex + 1] ?? null;
  const evidenceEnvelope = current.blocked
    ? envelopes
      .filter((envelope) => {
        const evidenceIndex = stageIndexForWorkflow(sessionById.get(envelope.session_id)?.workflow_id ?? "");
        const evidenceStage = STAGES[evidenceIndex];
        return evidenceIndex < currentIndex
          && evidenceStage !== undefined
          && !evidenceStage.blocked
          && evidenceStage.schemaId === envelope.schema_id;
      })
      .sort((left, right) => compareEvidence(left, right, phaseById))
      .at(-1)
    : envelopes
      .filter((envelope) =>
        envelope.schema_id === current.schemaId
        && stageIndexForWorkflow(sessionById.get(envelope.session_id)?.workflow_id ?? "") === currentIndex,
      )
      .sort((left, right) => compareEvidence(left, right, phaseById))
      .at(-1);

  return {
    current: current.id,
    next: next?.id ?? null,
    ownerAct: next === null ? null : stageCommand(next),
    evidence: evidenceEnvelope === undefined
      ? null
      : { schemaId: evidenceEnvelope.schema_id, phaseId: evidenceEnvelope.phase_id },
  };
}
