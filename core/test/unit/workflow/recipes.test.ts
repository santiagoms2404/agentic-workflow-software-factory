import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTPUT_SCHEMA_PLACEHOLDER, PREVIOUS_ENVELOPE_PLACEHOLDER } from "../../../src/contracts/json-schema.ts";
import { compileWorkflow, type WorkflowRecipe } from "../../../src/workflow/compiler.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";
import { buildWorkflow } from "../../../src/workflow/recipes/build.ts";
import { planBuildTestWorkflow } from "../../../src/workflow/recipes/plan-build-test.ts";
import { planWorkflow } from "../../../src/workflow/recipes/plan.ts";
import { scoutWorkflow } from "../../../src/workflow/recipes/scout.ts";
import { simpleSdlcWorkflow } from "../../../src/workflow/recipes/simple-sdlc.ts";

const recipes: readonly WorkflowRecipe[] = [
  scoutWorkflow,
  planWorkflow,
  buildWorkflow,
  planBuildTestWorkflow,
  buildReviewWorkflow,
  simpleSdlcWorkflow,
];

const expected = {
  scout: { tier: 0, phases: ["request:engineer", "scout:agent"], calls: 1 },
  plan: { tier: 0, phases: ["request:engineer", "planner:agent"], calls: 1 },
  build: { tier: 1, phases: ["request:engineer", "builder:agent", "tests:code"], calls: 1 },
  "plan-build-test": { tier: 1, phases: ["request:engineer", "planner:agent", "builder:agent", "tests:code"], calls: 2 },
  "build-review": { tier: 2, phases: ["request:engineer", "builder:agent", "tests:code", "reviewer:agent"], calls: 2 },
  "simple-sdlc": { tier: 2, phases: ["planner:agent", "builder:agent", "tests:code", "documenter:agent", "final-tests:code", "reviewer:agent"], calls: 4 },
} as const;

test("the shipped catalog is exactly six data-shaped recipes with the Phase Contract order", () => {
  assert.deepEqual(recipes.map((recipe) => recipe.id), Object.keys(expected));
  for (const recipe of recipes) {
    const contract = expected[recipe.id as keyof typeof expected];
    assert.equal(recipe.tier, contract.tier);
    assert.deepEqual(recipe.phases.map((phase) => `${phase.id}:${phase.kind}`), contract.phases);
    assert.ok(Object.isFrozen(compileWorkflow(recipe, recipe.tier).phases));
  }
});

test("all recipe prompts compile from TypeBox schemas and render their handoff", () => {
  for (const recipe of recipes) {
    const compiled = compileWorkflow(recipe, recipe.tier);
    assert.equal(compiled.minimumCalls, expected[recipe.id as keyof typeof expected].calls);
    for (const phase of compiled.phases) {
      if (phase.kind !== "agent") continue;
      assert.ok(!phase.promptTemplate.includes(OUTPUT_SCHEMA_PLACEHOLDER));
      assert.ok(phase.promptTemplate.includes('"additionalProperties": false'));
      const rendered = phase.renderPrompt(null);
      assert.ok(!rendered.includes(PREVIOUS_ENVELOPE_PLACEHOLDER));
      assert.match(rendered, /Previous phase envelope:\s*null/);
    }
  }
});

test("a real shipped workflow whose minimum cannot fit the selected tier is rejected before execution", () => {
  assert.throws(() => compileWorkflow(planBuildTestWorkflow, 0), /workflow plan-build-test at T0/i);
  assert.throws(() => compileWorkflow(simpleSdlcWorkflow, 1), /workflow simple-sdlc at T1/i);
});
