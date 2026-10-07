import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isPopulationStop, selectPopulation, SEED_CUT, type PopulationAttempt } from "../../src/traps/population.ts";
import { SEEDS } from "../../src/traps/seeds.ts";

test("the seed ledger contains the plan's 47 stops, 11 live gotchas and four distinct C5/C8 candidates", () => {
  assert.equal(SEEDS.length, 62);
  assert.equal(new Set(SEEDS.map(seed => seed.id)).size, 62);
  assert.deepEqual(SEEDS.filter(seed => "project" in seed.source).map(seed => seed.id),
    Array.from({ length: 47 }, (_, n) => `S${String(n + 1).padStart(2, "0")}`));
  assert.deepEqual(SEEDS.filter(seed => seed.id.startsWith("G")).map(seed => seed.id),
    Array.from({ length: 11 }, (_, n) => `G${String(n + 1).padStart(2, "0")}`));
  for (const seed of SEEDS) {
    assert.ok(Number.isFinite(Date.parse(seed.date)), seed.id);
    assert.ok(seed.evidence.trim().length > 0, seed.id);
    if (seed.outcome === "gap") {
      assert.ok(seed.replay, seed.id);
      assert.ok(seed.pendingTask, seed.id);
    }
    if (seed.outcome === "refused") assert.ok(seed.replay, seed.id);
    if (seed.outcome === "fixed") {
      assert.match(seed.evidence, /\b[0-9a-f]{7}\b/u, seed.id);
      assert.match(seed.evidence, /core\/test\/.+\.test\.ts/u, seed.id);
    }
  }
});

test("population reads synthetic projected facts: registered, terminal by cut, non-prove; selects exact attempts", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-trap-population-"));
  const registered = new Set(["awsf-synthetic", "fusion-synthetic", "empty-synthetic"]);
  const facts: PopulationAttempt[] = [
    { project: "awsf-synthetic", taskId: "same-task", attempt: 1, lifecycleState: "BLOCKED", workflow: "build-review", terminalAt: "2026-10-07T23:59:58Z" },
    { project: "awsf-synthetic", taskId: "same-task", attempt: 2, lifecycleState: "CANCELLED", workflow: "shift", terminalAt: SEED_CUT },
    { project: "fusion-synthetic", taskId: "fusion", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", terminalAt: "2026-10-08T00:59:59+01:00" },
    { project: "awsf-synthetic", taskId: "prove-cancel", attempt: 1, lifecycleState: "CANCELLED", workflow: "prove", terminalAt: SEED_CUT },
    { project: "awsf-synthetic", taskId: "prove-block", attempt: 1, lifecycleState: "BLOCKED", workflow: "prove", terminalAt: SEED_CUT },
    { project: "unregistered", taskId: "outsider", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", terminalAt: SEED_CUT },
    { project: "awsf-synthetic", taskId: "late", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", terminalAt: "2026-10-07T23:59:59.001Z" },
    { project: "awsf-synthetic", taskId: "landed", attempt: 1, lifecycleState: "LANDED", workflow: "build", terminalAt: SEED_CUT },
    { project: "awsf-synthetic", taskId: "draft", attempt: 1, lifecycleState: "DRAFT", workflow: "build", terminalAt: null },
    { project: "awsf-synthetic", taskId: "undated", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", terminalAt: null },
    { project: "awsf-synthetic", taskId: "bad-date", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", terminalAt: "not an instant" },
  ];
  try {
    const paths = facts.map(fact => {
      const dir = join(root, "projects", fact.project, "tasks", fact.taskId, String(fact.attempt));
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "projection.json");
      writeFileSync(path, JSON.stringify(fact));
      return path;
    });
    const read = paths.map(path => JSON.parse(readFileSync(path, "utf8")) as PopulationAttempt);
    const original = JSON.stringify(read);
    const selected = selectPopulation(read, registered);
    assert.deepEqual(selected.map(fact => `${fact.project}/${fact.taskId}#${fact.attempt}`),
      ["awsf-synthetic/same-task#1", "awsf-synthetic/same-task#2", "fusion-synthetic/fusion#1"]);
    assert.deepEqual(selectPopulation(read, registered), selected);
    assert.equal(JSON.stringify(read), original, "pure selection mutates no projected fact");
    assert.equal(isPopulationStop(read[0]!, registered, "invalid cut"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
