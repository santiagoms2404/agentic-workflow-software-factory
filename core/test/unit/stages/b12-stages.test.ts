import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PhaseRow,
  SessionRow,
} from "../../../src/observability/queries.ts";
import {
  resolveStage,
  type ResolvedProjectValue,
  type StageEnvelopeRow,
  type StageJournalRows,
} from "../../../src/stages/resolve.ts";
import {
  planAdmissionDocuments,
  type PlanAdmissionInput,
} from "../../../src/registry/plan-admission.ts";

const AT = "2026-03-01T00:00:00.000Z";

function makeSession(
  slug: string,
  workflowId: string,
  lifecycleState = "AWAITING_OWNER",
  sessionId = `session-${workflowId}`,
): SessionRow {
  return {
    session_id: sessionId,
    project_slug: slug,
    task_id: `task-${workflowId}`,
    continues_task: null,
    group_id: null,
    plan_ref: null,
    attempt: 1,
    workflow_id: workflowId,
    risk_tier: 1,
    is_protected: 0,
    lifecycle_state: lifecycleState,
    request_text: "test journal session",
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

function makePhase(sessionId: string, phaseId: string, ordinal = 1): PhaseRow {
  return {
    phase_id: phaseId,
    session_id: sessionId,
    ordinal,
    phase_key: "terminal",
    name: "terminal",
    kind: "code",
    owner: "host",
    description: "test phase row",
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

function makeEnvelope(
  sessionId: string,
  phaseId: string,
  schemaId: string,
  valid = 1,
): StageEnvelopeRow {
  return {
    session_id: sessionId,
    phase_id: phaseId,
    envelope_id: `envelope-${phaseId}`,
    agent: "host",
    schema_id: schemaId,
    correction_round: 0,
    valid,
    producer_status: "success",
    payload_json: "{}",
    violations_json: "[]",
    created_at: AT,
  };
}

function emptyRows(): StageJournalRows {
  return { sessions: [], phases: [], envelopes: [], transitions: [] };
}

// =============================================================================
// B12-13: Stage resolution for registered projects with no workflow sessions
// =============================================================================

test("B12-13: a registered project with no sessions resolves to S2 completed / next S3", () => {
  const projectExplicit: ResolvedProjectValue = { slug: "my-proj", isRegistered: true };
  const resExplicit = resolveStage(projectExplicit, emptyRows());
  assert.deepEqual(resExplicit, {
    current: "project-register",
    next: "design-to-plan",
    ownerAct: "awsf new --workflow design-to-plan",
    evidence: null,
  });

  const projectWithRepos: ResolvedProjectValue = {
    slug: "my-proj",
    repositories: { core: {} },
  };
  const resRepos = resolveStage(projectWithRepos, emptyRows());
  assert.deepEqual(resRepos, {
    current: "project-register",
    next: "design-to-plan",
    ownerAct: "awsf new --workflow design-to-plan",
    evidence: null,
  });
});

test("B12-13: an unregistered project with no sessions resolves to before S1 with awsf init", () => {
  const projectUnregistered: ResolvedProjectValue = { slug: "unreg-proj" };
  const res = resolveStage(projectUnregistered, emptyRows());
  assert.deepEqual(res, {
    current: "before S1",
    next: "init",
    ownerAct: "awsf init",
    evidence: null,
  });

  const projectExplicitFalse: ResolvedProjectValue = { slug: "unreg-proj", isRegistered: false };
  const resFalse = resolveStage(projectExplicitFalse, emptyRows());
  assert.deepEqual(resFalse, {
    current: "before S1",
    next: "init",
    ownerAct: "awsf init",
    evidence: null,
  });
});

// =============================================================================
// B12-14: BLOCKED or running sessions without valid evidence do not advance ladder
// =============================================================================

test("B12-14: BLOCKED design-to-plan session does not advance stage index", () => {
  const slug = "test-proj";
  const registeredProject: ResolvedProjectValue = { slug, isRegistered: true };
  const blockedSession = makeSession(slug, "design-to-plan", "BLOCKED");

  const rows: StageJournalRows = {
    sessions: [blockedSession],
    phases: [],
    envelopes: [],
    transitions: [],
  };

  const res = resolveStage(registeredProject, rows);
  // Should remain at S2 (project-register), advising S3 (design-to-plan), not advancing to S3 -> S4
  assert.deepEqual(res, {
    current: "project-register",
    next: "design-to-plan",
    ownerAct: "awsf new --workflow design-to-plan",
    evidence: null,
  });

  // If unregistered, remains at before S1
  const unregisteredProject: ResolvedProjectValue = { slug, isRegistered: false };
  const unregRes = resolveStage(unregisteredProject, rows);
  assert.deepEqual(unregRes, {
    current: "before S1",
    next: "init",
    ownerAct: "awsf init",
    evidence: null,
  });
});

test("B12-14: still-running design-to-plan session does not advance stage index", () => {
  const slug = "test-proj";
  const registeredProject: ResolvedProjectValue = { slug, isRegistered: true };

  for (const liveState of ["RUNNING", "PREPARED", "DRAFT", "GATING", "REVIEWING", "LANDING"]) {
    const runningSession = makeSession(slug, "design-to-plan", liveState);
    const rows: StageJournalRows = {
      sessions: [runningSession],
      phases: [],
      envelopes: [],
      transitions: [],
    };

    const res = resolveStage(registeredProject, rows);
    assert.deepEqual(
      res,
      {
        current: "project-register",
        next: "design-to-plan",
        ownerAct: "awsf new --workflow design-to-plan",
        evidence: null,
      },
      `state ${liveState} must not advance stage`,
    );
  }
});

test("B12-14: envelope from a BLOCKED session is not accepted as stage evidence", () => {
  const slug = "test-proj";
  const registeredProject: ResolvedProjectValue = { slug, isRegistered: true };
  const blockedSession = makeSession(slug, "design-to-plan", "BLOCKED", "sess-blocked");
  const phase = makePhase(blockedSession.session_id, "ph-1");
  const env = makeEnvelope(blockedSession.session_id, phase.phase_id, "awsf.document-output/v1", 1);

  const rows: StageJournalRows = {
    sessions: [blockedSession],
    phases: [phase],
    envelopes: [env],
    transitions: [],
  };

  const res = resolveStage(registeredProject, rows);
  // Envelope from blocked session must be rejected
  assert.deepEqual(res, {
    current: "project-register",
    next: "design-to-plan",
    ownerAct: "awsf new --workflow design-to-plan",
    evidence: null,
  });
});

test("B12-14: successful S3 followed by BLOCKED S4 stays at S3 with next S4", () => {
  const slug = "test-proj";
  const registeredProject: ResolvedProjectValue = { slug, isRegistered: true };

  const s3Session = makeSession(slug, "design-to-plan", "AWAITING_OWNER", "sess-s3");
  const s3Phase = makePhase(s3Session.session_id, "ph-s3");
  const s3Env = makeEnvelope(s3Session.session_id, s3Phase.phase_id, "awsf.document-output/v1", 1);

  const s4BlockedSession = makeSession(slug, "plan-build-test", "BLOCKED", "sess-s4");

  const rows: StageJournalRows = {
    sessions: [s3Session, s4BlockedSession],
    phases: [s3Phase],
    envelopes: [s3Env],
    transitions: [],
  };

  const res = resolveStage(registeredProject, rows);
  // Must be at design-to-plan (S3), next build (S4), ownerAct awsf new --workflow plan-build-test
  assert.deepEqual(res, {
    current: "design-to-plan",
    next: "build",
    ownerAct: "awsf new --workflow plan-build-test",
    evidence: {
      schemaId: "awsf.document-output/v1",
      phaseId: "ph-s3",
    },
  });
});

test("B12-23: stage evidence comes from the newer session even when its phase ordinal is lower", () => {
  const slug = "test-proj";
  const older = makeSession(slug, "design-to-plan", "LANDED", "sess-older");
  const newer = makeSession(slug, "design-to-plan", "LANDED", "sess-newer");
  // Ordinals are unique only within a session, so the older session's phase can carry the higher ordinal.
  const olderPhase = makePhase(older.session_id, "ph-older", 6);
  const newerPhase = makePhase(newer.session_id, "ph-newer", 2);
  const olderEnvelope = { ...makeEnvelope(older.session_id, olderPhase.phase_id, "awsf.document-output/v1", 1), created_at: "2026-01-01T00:00:00.000Z" };
  const newerEnvelope = { ...makeEnvelope(newer.session_id, newerPhase.phase_id, "awsf.document-output/v1", 1), created_at: "2026-02-01T00:00:00.000Z" };
  const rows: StageJournalRows = {
    sessions: [older, newer],
    phases: [olderPhase, newerPhase],
    envelopes: [olderEnvelope, newerEnvelope],
    transitions: [],
  };
  const res = resolveStage({ slug, isRegistered: true }, rows);
  assert.equal(res.current, "design-to-plan");
  assert.deepEqual(res.evidence, { schemaId: "awsf.document-output/v1", phaseId: "ph-newer" });
});

test("B12-14: successful S3 and S4 advance to build completed / next publish", () => {
  const slug = "test-proj";
  const registeredProject: ResolvedProjectValue = { slug, isRegistered: true };

  const s3Session = makeSession(slug, "design-to-plan", "LANDED", "sess-s3");
  const s3Phase = makePhase(s3Session.session_id, "ph-s3");
  const s3Env = makeEnvelope(s3Session.session_id, s3Phase.phase_id, "awsf.document-output/v1", 1);

  const s4Session = makeSession(slug, "plan-build-test", "AWAITING_OWNER", "sess-s4");
  const s4Phase = makePhase(s4Session.session_id, "ph-s4");
  const s4Env = makeEnvelope(s4Session.session_id, s4Phase.phase_id, "awsf.test-output/v1", 1);

  const rows: StageJournalRows = {
    sessions: [s3Session, s4Session],
    phases: [s3Phase, s4Phase],
    envelopes: [s3Env, s4Env],
    transitions: [],
  };

  const res = resolveStage(registeredProject, rows);
  assert.deepEqual(res, {
    current: "build",
    next: "publish",
    ownerAct: "awsf publish",
    evidence: {
      schemaId: "awsf.test-output/v1",
      phaseId: "ph-s4",
    },
  });
});

// =============================================================================
// B12-15: Plan admission uses configured plansRoot parameter
// =============================================================================

function samplePlanAdmissionInput(plansRoot?: string): PlanAdmissionInput {
  const planHtml = `<h3><code class="status">[]</code> Milestone M1: Setup</h3>
<h4>1. Setup environment</h4>
<p><code class="status">[]</code> Step 1</p>`;

  const buildPrompts = `# Section B — Task prompts (recommended)

### T01 — Setup environment
\`\`\`
Prompt content for T01
\`\`\`
`;

  return {
    stem: "my-feature",
    planHtml,
    buildPrompts,
    tickets: [{ id: "T01", title: "Setup environment", milestone: "M1", depends_on: [], serves: [] }],
    knownStems: ["existing-stem"],
    ...(plansRoot !== undefined ? { plansRoot } : {}),
  };
}

test("B12-15: planAdmissionDocuments defaults to specs/ when plansRoot is unspecified", () => {
  const input = samplePlanAdmissionInput();
  const docs = planAdmissionDocuments(input);

  assert.ok(docs.has("specs/my-feature.html"));
  assert.ok(docs.has("specs/my-feature-build-prompts.md"));
  assert.ok(docs.has("specs/tickets/my-feature/README.md"));
  assert.ok(docs.has("specs/tickets/my-feature/T01.md"));
});

test("B12-15: planAdmissionDocuments uses input.plansRoot", () => {
  const input = samplePlanAdmissionInput("docs/plans");
  const docs = planAdmissionDocuments(input);

  assert.ok(docs.has("docs/plans/my-feature.html"));
  assert.ok(docs.has("docs/plans/my-feature-build-prompts.md"));
  assert.ok(docs.has("docs/plans/tickets/my-feature/README.md"));
  assert.ok(docs.has("docs/plans/tickets/my-feature/T01.md"));
  assert.equal(docs.has("specs/my-feature.html"), false);
});

test("B12-15: planAdmissionDocuments normalizes trailing slashes on plansRoot", () => {
  const input = samplePlanAdmissionInput("custom/plans///");
  const docs = planAdmissionDocuments(input);

  assert.ok(docs.has("custom/plans/my-feature.html"));
  assert.ok(docs.has("custom/plans/my-feature-build-prompts.md"));
  assert.ok(docs.has("custom/plans/tickets/my-feature/README.md"));
  assert.ok(docs.has("custom/plans/tickets/my-feature/T01.md"));
});

test("B12-15: planAdmissionDocuments accepts plansRoot as third positional parameter", () => {
  const input = samplePlanAdmissionInput(); // no plansRoot on input
  const docs = planAdmissionDocuments(input, ["existing-stem"], "alt/plans");

  assert.ok(docs.has("alt/plans/my-feature.html"));
  assert.ok(docs.has("alt/plans/my-feature-build-prompts.md"));
  assert.ok(docs.has("alt/plans/tickets/my-feature/README.md"));
  assert.ok(docs.has("alt/plans/tickets/my-feature/T01.md"));
});
