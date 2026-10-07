// Task 12 (specs/awsf-v3-w01-driver-checks.html): which protected grant a
// writing phase owes, from the preflight plan and the recorded grants, and the
// record the runner journals when it refuses one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../../src/config/load.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertGrantRefusedRecord,
  GRANT_REFUSED_SCHEMA_ID,
  type GrantRefusedRecord,
} from "../../../src/contracts/driver-preflight.ts";
import { isEnvelopeSchemaId, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import { grantFileCovers, grantOwedAt, grantOwedFor, writingPhases, type RecordedGrant } from "../../../src/preflight/grant-plan.ts";
import { workflowRecipe } from "../../../src/workflow/catalog.ts";

const agents = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8")).agents;
const grant = (phase: string, ...files: string[]): RecordedGrant => ({ id: `grant-${phase}`, phase, files });

test("a planned path is covered by a granted file equal to it, under its glob, or under its directory spelling", () => {
  assert.equal(grantFileCovers("core/src/generated.ts", "core/src/generated.ts"), true);
  assert.equal(grantFileCovers("core/src/state/**", "core/src/state/task-machine.ts"), true);
  assert.equal(grantFileCovers("core/src/state", "core/src/state/task-machine.ts"), true);
  assert.equal(grantFileCovers("core/src/state/", "core/src/state/guards/a.ts"), true);
  assert.equal(grantFileCovers("docs/driving/**", "docs/driving/marimba/delegation-guard.sh"), true);
  // The preflight scan matches protected spellings without case, so the check does too.
  assert.equal(grantFileCovers("Core/Src/State/**", "core/src/state/task-machine.ts"), true);
  assert.equal(grantFileCovers("core/src/state/**", "core/src/stateful.ts"), false);
  assert.equal(grantFileCovers("core/src/state", "core/src/state-machine.ts"), false);
  assert.equal(grantFileCovers("AGENTS.md", "README.md"), false);
});

test("a phase owes nothing the plan does not name for it, and nothing once its grant covers every planned path", () => {
  const plan = [{ path: "core/src/state/**", phase: "builder" }, { path: "docs/driving/**", phase: "documenter" }];
  assert.equal(grantOwedFor([], [], "builder"), null);
  assert.equal(grantOwedFor(plan, [], "planner"), null);
  assert.equal(grantOwedFor(plan, [grant("builder", "core/src/state/task-machine.ts")], "builder"), null);
  assert.deepEqual(grantOwedFor(plan, [], "builder"), { phase: "builder", paths: ["core/src/state/**"], grantId: null });
  // Another phase's grant never covers this one's plan.
  assert.deepEqual(grantOwedFor(plan, [grant("documenter", "core/src/state/task-machine.ts")], "builder"),
    { phase: "builder", paths: ["core/src/state/**"], grantId: null });
});

test("a recorded grant that misses a planned path is named, because a phase takes only one grant", () => {
  const plan = [{ path: "core/src/state/**", phase: "builder" }, { path: "core/src/policy/**", phase: "builder" }];
  assert.deepEqual(grantOwedFor(plan, [grant("builder", "core/src/state/guards.ts")], "builder"),
    { phase: "builder", paths: ["core/src/policy/**"], grantId: "grant-builder" });
  assert.deepEqual(grantOwedFor([...plan, ...plan], [], "builder"),
    { phase: "builder", paths: ["core/src/state/**", "core/src/policy/**"], grantId: null }, "a repeated plan path is owed once");
});

test("only the next unsettled writing phase owes its grant at a boundary", () => {
  const plan = [{ path: "docs/driving/**", phase: "documenter" }];
  assert.equal(grantOwedAt(plan, [], ["builder", "documenter"]), null, "the builder moves HEAD before the documenter's grant can bind");
  assert.deepEqual(grantOwedAt(plan, [], ["documenter"]), { phase: "documenter", paths: ["docs/driving/**"], grantId: null });
  assert.equal(grantOwedAt(plan, [], []), null);
});

test("the writing phases are the agent phases whose role writes, in recipe order", () => {
  assert.deepEqual(writingPhases(workflowRecipe("simple-sdlc")!, agents).map((writer) => writer.phase), ["builder", "documenter"]);
  assert.deepEqual(writingPhases(workflowRecipe("build-review")!, agents).map((writer) => writer.phase), ["builder"]);
  assert.deepEqual(writingPhases(workflowRecipe("plan")!, agents), []);
});

const refused: GrantRefusedRecord = {
  schema: GRANT_REFUSED_SCHEMA_ID, project: "awsf", taskId: "t", attempt: 1, sessionId: "s", phase: "builder",
  paths: ["core/src/state/**"], grantId: null, boundary: "before-l4", callsSpent: 0, preflightAt: "then",
  reason: "phase builder writes planned protected path(s) core/src/state/** and no grant for it is recorded", at: "now",
};

test("the grant-refused record is a registered host record naming the phase, the paths and the boundary", () => {
  assert.equal(isEnvelopeSchemaId(GRANT_REFUSED_SCHEMA_ID), false);
  assert.ok(Object.hasOwn(RECORD_SCHEMAS, GRANT_REFUSED_SCHEMA_ID));
  assertGrantRefusedRecord(refused);
  assertGrantRefusedRecord({ ...refused, boundary: "phase-boundary", callsSpent: 2, grantId: "g" });
  assert.throws(() => assertGrantRefusedRecord({ ...refused, paths: [] }), /invalid awsf.grant-refused\/v1 record at \/paths/u);
  assert.throws(() => assertGrantRefusedRecord({ ...refused, boundary: "at-l1" }), /invalid awsf.grant-refused\/v1/u);
  assert.throws(() => assertGrantRefusedRecord({ ...refused, callsSpent: -1 }), /invalid awsf.grant-refused\/v1/u);
  assert.throws(() => assertGrantRefusedRecord({ ...refused, granted: true }), /invalid awsf.grant-refused\/v1/u);
});
