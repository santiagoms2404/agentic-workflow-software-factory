import assert from "node:assert/strict";
import { test } from "node:test";
import { planBanner, planRefusal, sessionsPlanBanner } from "../../../dashboard/src/plan-banner.ts";
import { loadAllSessions } from "../../../dashboard/src/session-pages.ts";

// B2-02, B2-03, B2-04, B2-17 (owner decision O4), degraded layer: no Vue runner
// exists, so the banner's text and visibility are this pure helper, and
// `npm run dash:build` checks App.vue's binding. The two plan-route answers
// that used to look like an ordinary board each show a banner with the
// server's message; a fresh board and an unrelated failure show none.

const RESOLVER_MESSAGE = "ENOENT: no such file or directory, scandir './specs'";

test("a PlanUnresolved refusal shows a refused banner carrying the resolver's message", () => {
  assert.deepEqual(planBanner({ ok: false, body: { error: RESOLVER_MESSAGE, code: "PlanUnresolved" } }), {
    kind: "refused",
    heading: "The plan catalog does not resolve, so there is no board to show.",
    detail: RESOLVER_MESSAGE,
  });
});

test("a stale board shows a stale banner with the parse or resolution error", () => {
  const banner = planBanner({ ok: true, body: { stale: true, planError: { code: "PlanUnresolved", message: "bad yaml at line 2" } } });
  assert.deepEqual(banner, {
    kind: "stale",
    heading: "The plan catalog no longer resolves. This is the last board that did.",
    detail: "bad yaml at line 2",
  });
});

test("a fresh board, and a failure that is not a plan refusal, show no banner", () => {
  assert.equal(planBanner({ ok: true, body: {} }), null);
  assert.equal(planBanner({ ok: false, body: { error: "request failed", code: "internal-error" } }), null);
  assert.equal(planBanner({ ok: false, body: null }), null);
});

// The sessions board, the groups view and the canvas draw runs against the
// sessions route's plan list, which carries the same flags. Before this, the
// paged loader kept only `plans`, so a stale or unresolved plan list reached
// those views looking current.
const SESSIONS_ERROR = { code: "PlanUnresolved", message: "bad yaml at line 2" } as const;

function sessionsPage(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("the paged sessions read keeps the plan list's stale flag and error for the views", async () => {
  const loaded = await loadAllSessions(async () => sessionsPage({ sessions: [], plans: [{ id: "fixture" }], stale: true, planError: SESSIONS_ERROR }));
  assert.deepEqual(
    { plans: loaded.plans.map((plan) => plan.id), stale: loaded.stale, planError: loaded.planError },
    { plans: ["fixture"], stale: true, planError: SESSIONS_ERROR },
  );
  const fresh = await loadAllSessions(async () => sessionsPage({ sessions: [], plans: [] }));
  assert.deepEqual(Object.keys(fresh).sort(), ["plans", "sessions"], "a fresh plan list carries no flags");
});

test("a stale sessions plan list, and one that never resolved, each show a banner; a fresh one shows none", () => {
  assert.deepEqual(sessionsPlanBanner({ stale: true, planError: SESSIONS_ERROR }), {
    kind: "stale",
    heading: "The plan catalog no longer resolves. Runs are shown against the last plan list that did.",
    detail: SESSIONS_ERROR.message,
  });
  assert.deepEqual(sessionsPlanBanner({ planError: SESSIONS_ERROR }), {
    kind: "refused",
    heading: "The plan catalog does not resolve, so runs are shown without their plans.",
    detail: SESSIONS_ERROR.message,
  });
  assert.equal(sessionsPlanBanner({}), null);
});

test("planRefusal reads only a well-formed PlanUnresolved body", () => {
  assert.deepEqual(planRefusal({ error: RESOLVER_MESSAGE, code: "PlanUnresolved" }), { code: "PlanUnresolved", message: RESOLVER_MESSAGE });
  assert.equal(planRefusal({ code: "PlanUnresolved" }), null);
  assert.equal(planRefusal("PlanUnresolved"), null);
});
