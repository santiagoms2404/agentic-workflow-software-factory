import assert from "node:assert/strict";
import { test } from "node:test";
import { planBanner, planRefusal } from "../../../dashboard/src/plan-banner.ts";

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

test("planRefusal reads only a well-formed PlanUnresolved body", () => {
  assert.deepEqual(planRefusal({ error: RESOLVER_MESSAGE, code: "PlanUnresolved" }), { code: "PlanUnresolved", message: RESOLVER_MESSAGE });
  assert.equal(planRefusal({ code: "PlanUnresolved" }), null);
  assert.equal(planRefusal("PlanUnresolved"), null);
});
