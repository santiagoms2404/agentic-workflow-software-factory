import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("B14-18, B14-19, B14-27: continuation reason watch keys by identifiers and uses sequence counter", () => {
  const canvasVue = source("dashboard/src/routes/canvas.vue");

  // Must not watch object references [middle, relation] directly
  assert.doesNotMatch(
    canvasVue,
    /watch\(\s*\[\s*middle\s*,\s*relation\s*\]/u,
    "should not watch middle and relation object references directly",
  );

  // Must watch by identifiers such as run/middle sessionId and relation id/key
  assert.match(
    canvasVue,
    /sessionId/u,
    "must track session id identifier",
  );

  // Must have a sequence counter for continuation reason
  assert.match(
    canvasVue,
    /reasonSeq/u,
    "must use request sequence counter for continuation reason fetching",
  );

  // Must not unconditionally clear reason to null if sessionId has not changed
  assert.match(
    canvasVue,
    /if\s*\(\s*sessionId\s*!==\s*oldSessionId\s*\)\s*reason\.value\s*=\s*null/u,
    "should not clear reason to null when session id has not changed",
  );
});

test("B14-20: continuation reason fetches events with limit up to 500 and follows pages if hasMore", () => {
  const canvasVue = source("dashboard/src/routes/canvas.vue");

  // Must use limit=500
  assert.match(canvasVue, /limit=500/u, "should request events with limit=500");

  // Must check hasMore and page to find task_relation
  assert.match(canvasVue, /hasMore/u, "must check hasMore to follow event pages");
});

test("B14-21: driving session tree watch uses request sequence counter", () => {
  const canvasVue = source("dashboard/src/routes/canvas.vue");

  // Must have a sequence counter for tree watch
  assert.match(
    canvasVue,
    /treeSeq/u,
    "must use request sequence counter for driving session tree fetching",
  );
});

test("B14-22: watch openedPlan by plan ID string rather than plan object reference", () => {
  const canvasVue = source("dashboard/src/routes/canvas.vue");

  // Must not watch openedPlan directly
  assert.doesNotMatch(
    canvasVue,
    /watch\(\s*openedPlan\s*,/u,
    "should not watch openedPlan object reference directly",
  );

  // Must watch plan ID string
  assert.match(
    canvasVue,
    /watch\(\s*\(\)\s*=>\s*openedPlan\.value\?\.id/u,
    "should watch openedPlan.value?.id",
  );
});

test("B14-23: reset handler clears pinned state when canvasMap is not mounted", () => {
  const canvasVue = source("dashboard/src/routes/canvas.vue");

  // Must define a reset() function that checks map.value and directly clears pinned state
  assert.match(canvasVue, /function reset\(\): void/u, "must define reset handler function");
  assert.match(canvasVue, /pinned\.value\s*=/u, "must update pinned.value directly when unmounted");
  assert.doesNotMatch(canvasVue, /@click="map\?\.reset\(\)"/u, "reset button should call reset() handler");
  assert.match(canvasVue, /@click="reset\(\)"/u, "reset button must call reset() handler");
});
