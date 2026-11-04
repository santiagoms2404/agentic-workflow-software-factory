import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiRouter } from "../../../src/api/routes.ts";
import type { PhaseDetailResponse, SessionDetailResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

const headers = { host: "127.0.0.1:4600" };
function request(url: string, method = "GET") {
  return { method, url, headers };
}

test("B13-01: Phase detail returns phase-specific usage rather than whole-session totals", async () => {
  const fixture = apiFixture();
  // Insert a second phase 'phase-2' into session-1
  fixture.writer.prepare(`INSERT INTO phases
    (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status, correction_count, max_corrections, created_at)
    VALUES ('phase-2', 'session-1', 2, 'tester', 'test phase', 'agent', 'host', 'Runs tests', 'SUCCEEDED', 0, 1, '2026-10-15T10:00:00.000Z')
  `).run();

  // Set session total tokens
  fixture.writer.prepare(`UPDATE sessions SET
    input_tokens = 5000,
    output_tokens = 2000,
    total_tokens = 7000,
    usage_authority = 'provider',
    estimated_cost_usd = 0.05,
    cost_authority = 'provider'
    WHERE session_id = 'session-1'
  `).run();

  // Insert usage event ONLY for phase-1
  fixture.writer.prepare(`INSERT INTO events
    (event_id, session_id, phase_id, first_source_seq, last_source_seq, type, name, payload_json, started_at)
    VALUES ('ev-phase1-usage', 'session-1', 'phase-1', 10, 10, 'usage', 'turn usage', json(?), '2026-10-15T12:00:00.000Z')
  `).run(JSON.stringify({
    kind: "usage",
    usage: {
      inputTokens: 1200,
      outputTokens: 400,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      reasoningTokens: 0,
      reasoningRelation: "included-in-output",
    },
    costUsd: 0.015,
  }));

  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    // 1. Session detail shows session-wide totals
    const sessionRes = await router.dispatch(request("/api/v1/sessions/session-1"));
    assert.equal(sessionRes.status, 200);
    const sessionDetail = sessionRes.body as SessionDetailResponse;
    assert.equal(sessionDetail.usage.totalTokens, 7000);
    assert.equal(sessionDetail.usage.inputTokens, 5000);

    // 2. Phase 1 detail shows ONLY Phase 1 usage
    const p1Res = await router.dispatch(request("/api/v1/sessions/session-1/phases/phase-1"));
    assert.equal(p1Res.status, 200);
    const p1Detail = p1Res.body as PhaseDetailResponse;
    assert.equal(p1Detail.usage.inputTokens, 1200);
    assert.equal(p1Detail.usage.outputTokens, 400);
    assert.equal(p1Detail.usage.cacheReadTokens, 100);
    assert.equal(p1Detail.usage.cacheWriteTokens, 50);
    assert.equal(p1Detail.usage.totalTokens, 1600);
    assert.equal(p1Detail.usage.usageAuthority, "provider");
    assert.equal(p1Detail.usage.estimatedCostUsd, 0.015);

    // 3. Phase 2 detail (no usage events) does NOT get session-wide totals
    const p2Res = await router.dispatch(request("/api/v1/sessions/session-1/phases/phase-2"));
    assert.equal(p2Res.status, 200);
    const p2Detail = p2Res.body as PhaseDetailResponse;
    assert.equal(p2Detail.usage.totalTokens, null);
    assert.equal(p2Detail.usage.inputTokens, null);
    assert.equal(p2Detail.usage.outputTokens, null);
    assert.equal(p2Detail.usage.usageAuthority, "none");
    assert.equal(p2Detail.usage.estimatedCostUsd, null);
    assert.equal(p2Detail.usage.costAuthority, "unavailable");
  } finally {
    router.close();
    fixture.close();
  }
});
