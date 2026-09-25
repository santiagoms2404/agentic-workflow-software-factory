import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as toYaml } from "yaml";
import { WORKFLOW_IDS } from "../../src/config/workflow-ids.ts";
import {
  ConfigCompiledDefaultWorkflowError,
  ConfigUnknownWorkflowError,
  loadConfig,
} from "../../src/config/load.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../../src/contracts/review-output.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { selectWorkflow, workflowsCommand } from "../../src/cli/commands/workflows.ts";
import { workflowBuysReview } from "../../src/cli/commands/degrade-review.ts";
import { builderSeedBinding, CandidateSeedRejected, validateInheritedSeed } from "../../src/workflow/candidate-seed.ts";
import {
  assertCompiledVocabulary,
  COMPILED_WORKFLOWS,
  compiledWorkflow,
  CompiledWorkflowUnbound,
  WORKFLOW_RECIPES,
  workflowRecipe,
} from "../../src/workflow/catalog.ts";
import { COMPILED_WORKFLOW_IDS, isCompiledWorkflowId } from "../../src/workflow/compiled-ids.ts";
import { buildWorkflow } from "../../src/workflow/recipes/build.ts";
import { buildReviewWorkflow } from "../../src/workflow/recipes/build-review.ts";
import { designToPlanWorkflow } from "../../src/workflow/recipes/design-to-plan.ts";
import { intakeWorkflow } from "../../src/workflow/recipes/intake.ts";
import { planWorkflow } from "../../src/workflow/recipes/plan.ts";
import { planBuildTestWorkflow } from "../../src/workflow/recipes/plan-build-test.ts";
import { scoutWorkflow } from "../../src/workflow/recipes/scout.ts";
import { simpleSdlcWorkflow } from "../../src/workflow/recipes/simple-sdlc.ts";
import { loadUserPrompt } from "../../src/workflow/recipe-support.ts";
import { compileShift, SHIFT_TIER_FLOOR } from "../../src/workflow/shift/compile.ts";
import { deepClone, validConfig } from "./config/fixture.ts";

const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
// Both states are built here, so these tests hold before and after the owner's G17 commit.
const withoutShift = { ...config, workflows: { enabled: config.workflows.enabled.filter((id) => id !== "shift") } };
const withShift = { ...config, workflows: { enabled: [...withoutShift.workflows.enabled, "shift"] } };

test("every shipped recipe still resolves to its own module, and no shipped id is compiled", () => {
  const shipped = [
    scoutWorkflow, planWorkflow, buildWorkflow, planBuildTestWorkflow,
    buildReviewWorkflow, simpleSdlcWorkflow, intakeWorkflow, designToPlanWorkflow,
  ];
  assert.deepEqual(WORKFLOW_RECIPES.map((recipe) => recipe.id), [...WORKFLOW_IDS]);
  for (const recipe of shipped) {
    assert.equal(workflowRecipe(recipe.id), recipe, recipe.id);
    assert.equal(compiledWorkflow(recipe.id), null, recipe.id);
    assert.equal(isCompiledWorkflowId(recipe.id), false, recipe.id);
  }
});

test("shift is the one compiled id, resolved through its compiler and never through the recipe list", () => {
  assert.deepEqual([...COMPILED_WORKFLOW_IDS], ["shift"]);
  assert.equal(workflowRecipe("shift"), null);
  assert.equal(compiledWorkflow("shift")?.compile, compileShift);
  assert.equal(compiledWorkflow("nothing"), null);
});

test("the compiler's declaration matches what a real compilation produces", () => {
  // One ticket, because a review over two build producers is refused until T06.
  const source = [
    "---", "id: T01", 'title: "One real ticket"', "milestone: M1", "state: todo", "depends_on: []", "---",
    "# T01 · One real ticket", "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```", "TASK T01.", "```", "",
  ].join("\n");
  const bytes = Buffer.from(source, "utf8");
  const manifest = sealShiftManifest({
    plan: "fixture-shift",
    milestones: ["M1"],
    tickets: [{ id: "T01", path: "specs/tickets/fixture-shift/T01.md", digest: ticketFileDigest(bytes) }],
  });
  const recipe = compileShift(manifest, new Map([["T01", bytes]]), {
    prompts: { builder: loadUserPrompt("builder"), reviewer: loadUserPrompt("reviewer") },
  });
  const declared = compiledWorkflow("shift")!;
  const agents = recipe.phases.filter((phase) => phase.kind === "agent");
  assert.equal(recipe.id, declared.id);
  assert.equal(recipe.tier, declared.tierFloor);
  assert.equal(declared.tierFloor, SHIFT_TIER_FLOOR);
  assert.deepEqual([...new Set(agents.map((phase) => phase.owner))], [...declared.agentOwners]);
  assert.equal(agents.some((phase) => phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID), declared.buysReview);
});

test("the compiled-vocabulary assertion refuses every way the two vocabularies can overlap or drift", () => {
  const shippedIds = [...WORKFLOW_IDS];
  const recipes = WORKFLOW_RECIPES.map((recipe) => ({ id: recipe.id }));
  const message = /compiled workflow ids and their compilers disagree/;
  assert.doesNotThrow(() => assertCompiledVocabulary(COMPILED_WORKFLOW_IDS, COMPILED_WORKFLOWS, shippedIds, recipes));
  // A placeholder recipe, alone and with its id also added to the shipped list.
  assert.throws(() => assertCompiledVocabulary(["shift"], [{ id: "shift" }], shippedIds, [...recipes, { id: "shift" }]), message);
  assert.throws(
    () => assertCompiledVocabulary(["shift"], [{ id: "shift" }], [...shippedIds, "shift"], [...recipes, { id: "shift" }]),
    message,
  );
  assert.throws(() => assertCompiledVocabulary(["shift"], [], shippedIds, recipes), message);
  assert.throws(() => assertCompiledVocabulary([], [{ id: "shift" }], shippedIds, recipes), message);
  assert.throws(() => assertCompiledVocabulary(["shift"], [{ id: "shift" }, { id: "shift" }], shippedIds, recipes), message);
});

test("config admits a compiled id in workflows.enabled and refuses it as default_workflow", () => {
  const enabled = deepClone(validConfig());
  enabled.workflows.enabled.push("shift");
  assert.deepEqual(loadConfig(toYaml(enabled)).workflows.enabled, ["build", "build-review", "shift"]);

  const asDefault = deepClone(validConfig());
  asDefault.workflows.enabled.push("shift");
  asDefault.project.default_workflow = "shift";
  assert.throws(() => loadConfig(toYaml(asDefault)), ConfigCompiledDefaultWorkflowError);
  assert.throws(() => loadConfig(toYaml(asDefault)), /name it with --workflow/);

  const unknown = deepClone(validConfig());
  unknown.workflows.enabled.push("not-compiled-either");
  assert.throws(() => loadConfig(toYaml(unknown)), ConfigUnknownWorkflowError);
});

test("selecting a shift takes its tier floor, refuses a lower tier, and still requires it enabled", () => {
  assert.deepEqual(selectWorkflow(withShift, "shift"), { workflow: "shift", tier: SHIFT_TIER_FLOOR });
  assert.deepEqual(selectWorkflow(withShift, "shift", "T2"), { workflow: "shift", tier: 2 });
  assert.throws(() => selectWorkflow(withShift, "shift", "T1"), /is compiled at T2 or above; got T1/);
  assert.throws(() => selectWorkflow(withoutShift, "shift"), /"shift" is not enabled/);
});

test("awsf workflows lists compiled ids in their own section without a phase or call count", () => {
  const lines = workflowsCommand(withShift);
  const header = lines.indexOf("Compiled per selection (phase count is selection-dependent):");
  assert.ok(header > 0, "compiled section header");
  const rows = lines.filter((line) => line.startsWith("shift:"));
  assert.equal(rows.length, 1);
  assert.ok(lines.indexOf(rows[0]!) > header, "shift is listed after the compiled header");
  assert.match(rows[0]!, /^shift: enabled, T2 or above, phase count selection-dependent — agents builder, reviewer$/);
  assert.doesNotMatch(rows[0]!, /provider call|corrections fundable/);
  assert.match(workflowsCommand(withoutShift).find((line) => line.startsWith("shift:")) ?? "", /^shift: not enabled,/);
});

test("the review, seed and start callers each take a compiled path instead of calling shift unknown", async () => {
  assert.equal(workflowBuysReview("shift"), true);
  assert.throws(
    () => validateInheritedSeed("/nonexistent", { workflow: "shift", integrationBaseSha: "a", seedCandidateSha: "b" }, withShift),
    (error: unknown) => error instanceof CandidateSeedRejected && /compiled per selection/.test(error.message),
  );
  await assert.rejects(
    builderSeedBinding(withShift, "/nonexistent/awsf.config.yaml", "shift"),
    (error: unknown) => error instanceof CandidateSeedRejected && /compiled per selection/.test(error.message),
  );
  const unbound = new CompiledWorkflowUnbound("shift", "task T99");
  assert.match(unbound.message, /^workflow "shift" compiles its phase list from a selection bound to its attempt, and task T99 has none/);
  assert.doesNotMatch(unbound.message, /no shipped recipe/);
});
