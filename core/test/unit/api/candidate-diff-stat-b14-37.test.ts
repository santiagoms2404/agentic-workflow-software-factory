import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiRouter } from "../../../src/api/routes.ts";
import type { SessionDetailResponse } from "../../../../dashboard/shared/types.ts";
import { validReviewContext } from "../contracts/fixtures.ts";
import { apiFixture } from "./_fixture.ts";

const headers = { host: "127.0.0.1:4600" };
const candidateSha = "a".repeat(40);
const baseSha = "b".repeat(40);

function insertReviewContext(
  fixture: ReturnType<typeof apiFixture>,
  candidate: string,
  payloadPatch: Record<string, unknown> = {},
): void {
  const payload = { ...validReviewContext(), candidateSha: candidate, ...payloadPatch };
  fixture.writer.prepare("UPDATE sessions SET base_sha = ?, candidate_sha = ? WHERE session_id = 'session-1'").run(baseSha, candidateSha);
  fixture.writer.prepare(`INSERT INTO envelopes
    (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
     producer_status, payload_json, violations_json, file_path, created_at)
    VALUES (?, 'session-1', 'phase-1', 'host', 'awsf.review-context/v1', 2, 1,
      'success', ?, '[]', 'private/review-context.json', '2026-08-08T12:11:00.000Z')`).run(
    `review-context-${candidate}`,
    JSON.stringify({
      envelopeId: `review-context-${candidate}`,
      sessionId: "session-1",
      phaseId: "phase-1",
      correctionRound: 2,
      agent: "host",
      schemaId: "awsf.review-context/v1",
      valid: true,
      createdAt: "2026-08-08T12:11:00.000Z",
      payload,
      violations: [],
      rawOutputPath: "private/review-context.json",
    }),
  );
}

function request() {
  return { method: "GET", url: "/api/v1/sessions/session-1", headers };
}

test("B14-37: session detail returns structured counts bound to its exact candidate", async () => {
  const fixture = apiFixture();
  insertReviewContext(fixture, candidateSha, {
    changedFiles: ["one.ts", "two.ts", "three.ts"],
    insertions: 17,
    deletions: 4,
  });
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const response = await router.dispatch(request());
    assert.equal(response.status, 200);
    assert.deepEqual((response.body as SessionDetailResponse).candidateDiffStat, {
      baseSha,
      candidateSha,
      files: 3,
      insertions: 17,
      deletions: 4,
    });
  } finally {
    router.close();
    fixture.close();
  }
});

test("B14-37: mismatched or malformed candidate evidence stays unavailable", async () => {
  const fixture = apiFixture();
  insertReviewContext(fixture, "b".repeat(40));
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const response = await router.dispatch(request());
    assert.equal(response.status, 200);
    assert.equal((response.body as SessionDetailResponse).candidateDiffStat, null);
  } finally {
    router.close();
    fixture.close();
  }

  const wrongBase = apiFixture();
  insertReviewContext(wrongBase, candidateSha, { baseSha: "c".repeat(40) });
  const wrongBaseRouter = createApiRouter({ dbPath: wrongBase.path, config: wrongBase.config });
  try {
    const response = await wrongBaseRouter.dispatch(request());
    assert.equal((response.body as SessionDetailResponse).candidateDiffStat, null);
  } finally {
    wrongBaseRouter.close();
    wrongBase.close();
  }

  const malformed = apiFixture();
  insertReviewContext(malformed, candidateSha, { insertions: -1 });
  const malformedRouter = createApiRouter({ dbPath: malformed.path, config: malformed.config });
  try {
    const response = await malformedRouter.dispatch(request());
    assert.equal((response.body as SessionDetailResponse).candidateDiffStat, null);
  } finally {
    malformedRouter.close();
    malformed.close();
  }
});

test("B14-37: legacy session detail without structured diff evidence remains unavailable", async () => {
  const fixture = apiFixture();
  fixture.writer.prepare("UPDATE sessions SET base_sha = ?, candidate_sha = ? WHERE session_id = 'session-1'").run(baseSha, candidateSha);
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const response = await router.dispatch(request());
    assert.equal(response.status, 200);
    assert.equal((response.body as SessionDetailResponse).candidateDiffStat, null);
  } finally {
    router.close();
    fixture.close();
  }
});
