import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SessionCard, SessionsResponse } from "../../../dashboard/shared/types.ts";
import { loadAllSessions } from "../../../dashboard/src/session-pages.ts";
import { buildCanvasGraph } from "../../../dashboard/src/canvas-graph.ts";
import { createApiRouter } from "../../src/api/routes.ts";
import { createSession } from "../../src/observability/projector.ts";
import { canvasReplays } from "../fixtures/canvas-replays.ts";
import { apiFixture } from "./api/_fixture.ts";

const at = "2026-01-01T00:00:00.000Z";
const card = (index: number): SessionCard => ({ sessionId: `s-${String(index).padStart(3, "0")}`, startedAt: at, replay: null }) as SessionCard;
const response = (sessions: SessionCard[]): Response => new Response(JSON.stringify({ sessions, plans: [] }));

test("every session is read, eighty replays plus ordinary runs, across a shared-timestamp page boundary", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  try {
    const replays = canvasReplays("canvas-fixture", 5, 2, 8);
    const ordinary = Array.from({ length: 125 }, (_, index) => ({
      ...replays[0]!, sessionId: `ordinary-${index}`, taskId: `ordinary-task-${index}`, replay: null,
    }));
    for (const session of [...replays, ...ordinary]) {
      createSession(fixture.writer, {
        sessionId: session.sessionId, projectSlug: session.project, taskId: session.taskId, attempt: 1,
        continuesTask: null, groupId: null, planRef: null, workflowId: session.replay === null ? "build" : "prove",
        riskTier: 2, isProtected: false, requestText: "Synthetic paged canvas run", callCeiling: 3,
        configSnapshotJson: "{}", journalPath: "state://synthetic.jsonl", startedAt: at,
      });
      if (session.replay !== null) {
        fixture.writer.prepare(`INSERT INTO events
          (event_id, session_id, first_source_seq, last_source_seq, type, payload_json, started_at)
          VALUES (?, ?, 1, 1, 'replay', ?, ?)`).run(`${session.sessionId}:replay`, session.sessionId,
            JSON.stringify({ ...session.replay, itemDigest: "a".repeat(64), baseSha: "b".repeat(40) }), at);
      }
    }
    const urls: string[] = [];
    const request = async (url: string): Promise<Response> => {
      urls.push(url);
      const result = await router.dispatch({ method: "GET", url, headers: { host: "127.0.0.1:4600" } });
      return new Response(JSON.stringify(result.body), { status: result.status });
    };
    const all = await loadAllSessions(request);
    assert.equal(all.sessions.length, 206);
    assert.equal(new Set(all.sessions.map((session) => session.sessionId)).size, 206);
    assert.equal(all.sessions.filter((session) => session.replay !== null).length, 80);
    assert.equal(urls.length, 3);
    assert.equal(urls[0], "/api/v1/sessions?limit=100");
    assert.equal(new URL(urls[1]!, "http://localhost").searchParams.get("before"), at);
    assert.ok(new URL(urls[1]!, "http://localhost").searchParams.get("beforeId"));
    const graph = buildCanvasGraph(all.sessions, [], []);
    assert.match(graph.nodes.find((node) => node.kind === "proving-ground")!.label, /80 replays · 10 pairs/);
    assert.equal(graph.nodes.filter((node) => node.kind === "run").length, 206);
    assert.equal(all.plans.length, 2);

    const board = await request("/api/v1/sessions");
    assert.equal(((await board.json()) as SessionsResponse).sessions.length, 50, "the board's default is unchanged");
    assert.equal((await request("/api/v1/sessions?limit=101")).status, 400);
    const timestampOnly = await request(`/api/v1/sessions?before=${at}`);
    assert.deepEqual(((await timestampOnly.json()) as SessionsResponse).sessions, [], "legacy timestamp-only cursors remain exclusive");
    for (const query of ["beforeId=x", `before=${at}&beforeId=`, `before=${at}&beforeId=${"x".repeat(257)}`]) {
      assert.equal((await request(`/api/v1/sessions?${query}`)).status, 400);
    }
  } finally { router.close(); fixture.close(); }
});

test("an exact full page reads through the terminal empty page", async () => {
  const urls: string[] = [];
  const result = await loadAllSessions(async (url) => {
    urls.push(url);
    return response(urls.length === 1 ? Array.from({ length: 100 }, (_, index) => card(index)) : []);
  });
  assert.equal(result.sessions.length, 100);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!, "http://localhost").searchParams.get("beforeId"), "s-099");
  assert.deepEqual(await loadAllSessions(async () => response([])), { sessions: [], plans: [] });
});

test("a failed later page rejects the whole read rather than publishing a partial projection", async () => {
  let calls = 0;
  await assert.rejects(loadAllSessions(async () => {
    calls += 1;
    return calls === 1 ? response(Array.from({ length: 100 }, (_, index) => card(index))) : new Response("unavailable", { status: 503 });
  }), /Sessions unavailable/);
  assert.equal(calls, 2);
});

test("a non-advancing cursor fails instead of requesting the same page forever", async () => {
  let calls = 0;
  await assert.rejects(loadAllSessions(async () => {
    calls += 1;
    return response(Array.from({ length: 100 }, (_, index) => card(index)));
  }), /pagination did not advance/);
  assert.equal(calls, 2);
});

test("every list view reads all sessions, and a poll whose view changed publishes nothing", () => {
  // The sessions board once read the API's first page alone and showed "50 of
  // 50 runs" with more recorded. The board, the groups view and the canvas all
  // count the whole projection, so all three take the all-pages reader.
  const app = readFileSync(new URL("../../../dashboard/src/App.vue", import.meta.url), "utf8");
  assert.match(app, /if \(canvasRoute\.value \|\| groupsRoute\.value\) return "sessions";/);
  assert.match(app, /return selectedId\.value \? `session:\$\{selectedId\.value\}` : "sessions";/);
  assert.match(app, /: kind === "sessions" \? loadAllSessions\(\)/);
  assert.doesNotMatch(app, /fetch\("\/api\/v1\/sessions"\)/, "no view reads one page of sessions");
  assert.match(app, /if \(kind !== readKind\(\)\) return;/);
  assert.match(app, /else if \(kind === "sessions"\) \{\s*sessions\.value = nextData as SessionsResponse;/);
});
