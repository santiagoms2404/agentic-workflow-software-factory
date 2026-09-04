import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EnvelopeRow,
  PhaseRow,
  SessionRow,
  TransitionRow,
} from "../../../src/observability/queries.ts";
import type { ResolvedProject } from "../../../src/registry/resolve.ts";
import {
  resolveStage,
  type StageJournalRows,
  type StageResolution,
} from "../../../src/stages/resolve.ts";

const AT = "2026-01-01T00:00:00.000Z";
const PROJECT = { slug: "stage-test" } as ResolvedProject;

function session(workflowId: string, lifecycleState = "AWAITING_OWNER"): SessionRow {
  return {
    session_id: `session-${workflowId}`,
    project_slug: PROJECT.slug,
    task_id: `task-${workflowId}`,
    continues_task: null,
    attempt: 1,
    workflow_id: workflowId,
    risk_tier: 1,
    is_protected: 0,
    lifecycle_state: lifecycleState,
    request_text: "canned journal row",
    base_sha: null,
    head_sha: null,
    candidate_sha: null,
    worker_provider: null,
    worker_model_requested: null,
    worker_model_resolved: null,
    review_provider: null,
    review_verdict: null,
    call_ceiling: 0,
    calls_reserved: 0,
    calls_spent: 0,
    corrections_auto: 0,
    corrections_owner: 0,
    owner_reentries: 0,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    reasoning_relation: "unknown",
    usage_authority: "none",
    estimated_cost_usd: null,
    cost_authority: "unavailable",
    cost_partial: 0,
    observability_degraded: 0,
    archived: 0,
    started_at: AT,
    updated_at: AT,
    ended_at: null,
    state_revision: 1,
    last_projected_seq: 1,
  };
}

function phase(sessionId: string, phaseId: string, ordinal: number): PhaseRow {
  return {
    phase_id: phaseId,
    session_id: sessionId,
    ordinal,
    phase_key: "terminal",
    name: "terminal",
    kind: "code",
    owner: "host",
    description: "canned phase row",
    status: "SUCCEEDED",
    correction_count: 0,
    max_corrections: 0,
    error_code: null,
    error_message: null,
    started_at: AT,
    ended_at: AT,
    created_at: AT,
  };
}

function envelope(sessionId: string, phaseId: string, schemaId: string): EnvelopeRow & { session_id: string; phase_id: string } {
  return {
    session_id: sessionId,
    phase_id: phaseId,
    envelope_id: `envelope-${phaseId}`,
    agent: "host",
    schema_id: schemaId,
    correction_round: 0,
    valid: 1,
    producer_status: "success",
    payload_json: "{}",
    violations_json: "[]",
    created_at: AT,
  };
}

function published(sessionId: string): TransitionRow & { session_id: string } {
  return {
    session_id: sessionId,
    transition_id: `transition-${sessionId}`,
    seq: 1,
    from_state: "LANDED",
    to_state: "PUBLISHED",
    actor: "owner",
    edge_id: "L-publish",
    reason_source: "canned",
    reason_code: null,
    reason_detail: null,
    spawn_site: 0,
    at: AT,
  };
}

function rowsFor(workflowId?: string, isPublished = false): StageJournalRows {
  if (workflowId === undefined) return { sessions: [], phases: [], envelopes: [], transitions: [] };

  const current = session(workflowId, isPublished ? "PUBLISHED" : undefined);
  const terminalPhase = phase(current.session_id, `phase-${workflowId}`, 1);
  const schemaId = workflowId === "design-to-plan"
    ? "awsf.document-output/v1"
    : workflowId === "plan-build-test"
      ? "awsf.test-output/v1"
      : undefined;
  return {
    sessions: [current],
    phases: schemaId === undefined ? [] : [terminalPhase],
    envelopes: schemaId === undefined ? [] : [envelope(current.session_id, terminalPhase.phase_id, schemaId)],
    transitions: isPublished ? [published(current.session_id)] : [],
  };
}

function expected(current: StageResolution["current"], next: StageResolution["next"], ownerAct: string | null): StageResolution {
  return { current, next, ownerAct, evidence: null };
}

test("the resolver answers at every stage and both ladder edges from canned journal rows", () => {
  const positions: readonly [string | undefined, StageResolution][] = [
    [undefined, expected("before S1", "init", "awsf init")],
    ["init", expected("init", "project-register", "awsf project register")],
    ["project-register", expected("project-register", "design-to-plan", "awsf new --workflow design-to-plan")],
    ["design-to-plan", {
      current: "design-to-plan",
      next: "build",
      ownerAct: "awsf new --workflow plan-build-test",
      evidence: { schemaId: "awsf.document-output/v1", phaseId: "phase-design-to-plan" },
    }],
    ["plan-build-test", {
      current: "build",
      next: "publish",
      ownerAct: "awsf publish",
      evidence: { schemaId: "awsf.test-output/v1", phaseId: "phase-plan-build-test" },
    }],
    ["publish", expected("publish", null, null)],
  ];

  for (const [workflowId, resolution] of positions) {
    assert.deepEqual(resolveStage(PROJECT, rowsFor(workflowId)), resolution, workflowId ?? "before S1");
  }

  assert.deepEqual(resolveStage(PROJECT, rowsFor("publish", true)), expected("past S5", null, null));
});

test("the resolver is pure for repeated canned inputs", () => {
  const rows = rowsFor("design-to-plan");
  const projectBefore = structuredClone(PROJECT);
  const rowsBefore = structuredClone(rows);

  const first = resolveStage(PROJECT, rows);
  const second = resolveStage(PROJECT, rows);

  assert.deepEqual(first, second);
  assert.deepEqual(PROJECT, projectBefore);
  assert.deepEqual(rows, rowsBefore);
});
