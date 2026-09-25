import { test } from "node:test";
import assert from "node:assert/strict";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { WORKFLOW_RECIPES } from "../../src/workflow/catalog.ts";
import {
  InvalidReviewBuildProducerCount,
  ReviewBuildProvidersDisagree,
  compileWorkflow,
  compileWorkflowStructure,
  reviewWorkerProvider,
  type WorkflowDefinition,
  type WorkflowRecipe,
} from "../../src/workflow/compiler.ts";
import { loadUserPrompt } from "../../src/workflow/recipe-support.ts";
import { buildReviewWorkflow } from "../../src/workflow/recipes/build-review.ts";
import { InvalidReviewInversion, oppositeProvider, providerPairFrom } from "../../src/workflow/review-routing.ts";
import { compileShift, type ShiftRecipe } from "../../src/workflow/shift/compile.ts";

// The review rule is "the build producers resolve to exactly one distinct
// provider". The compiler holds the phase half and `reviewWorkerProvider` the
// provider half, so each test names which half it is watching.

const CONFIG = { prompts: { builder: loadUserPrompt("builder"), reviewer: loadUserPrompt("reviewer") } };
const THREE = ["T01", "T02", "T03"] as const;
const BUILDERS = ["t01-build", "t02-build", "t03-build"] as const;

function ticketSource(id: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(`Ticket ${id} does its own distinct work`)}`,
    "milestone: M2",
    "state: todo",
    "depends_on: []",
    "---",
    `# ${id}`,
    "",
    "## Handoff",
    "",
    "_Empty at authoring time._",
    "",
    "## Build prompt",
    "",
    "```",
    `TASK ${id}. Build the ${id} widget.`,
    "```",
    "",
  ].join("\n");
}

function shift(ids: readonly string[]): ShiftRecipe {
  const bodies = new Map(ids.map((id) => [id, Buffer.from(ticketSource(id), "utf8")] as const));
  const manifest = sealShiftManifest({
    plan: "fixture-shift",
    milestones: ["M2"],
    tickets: ids.map((id) => ({ id, path: `specs/tickets/fixture-shift/${id}.md`, digest: ticketFileDigest(bodies.get(id)!) })),
  });
  return compileShift(manifest, bodies, CONFIG);
}

/** The runner's lookup, reduced to a table. An unrouted phase is a test bug, not a provider. */
function routes(table: Record<string, string>): (phaseId: string) => string {
  return (phaseId) => {
    const provider = table[phaseId];
    if (provider === undefined) throw new Error(`test routed no provider for ${phaseId}`);
    return provider;
  };
}

test("a shift of three tickets compiles one review over all three builders", () => {
  const recipe = shift(THREE);
  for (const compiled of [compileWorkflowStructure(recipe), compileWorkflow(recipe, 2)]) {
    assert.equal(compiled.minimumCalls, 4);
    assert.deepEqual(compiled.reviewBuildPhaseIds, BUILDERS);
    // No one builder is the worker, so the single id stays empty rather than
    // letting a reader invert against one builder and skip the other two.
    assert.equal(compiled.reviewBuildPhaseId, null);
  }
  const one = compileWorkflowStructure(shift(["T01"]));
  assert.equal(one.reviewBuildPhaseId, "t01-build");
  assert.deepEqual(one.reviewBuildPhaseIds, ["t01-build"]);
});

test("builders on one provider resolve to it, and providerPairFrom is unchanged", () => {
  const compiled = compileWorkflowStructure(shift(THREE));
  const providerFor = routes({ "t01-build": "anthropic", "t02-build": "anthropic", "t03-build": "anthropic", "shift-review": "openai" });
  const worker = reviewWorkerProvider(compiled, providerFor);
  assert.equal(worker, "anthropic");
  // N builders on one provider plus one reviewer on the other is still
  // exactly two distinct providers, so the pair needs no amendment.
  const agents = compiled.phases.filter((phase) => phase.kind === "agent").map((phase) => providerFor(phase.id));
  const pair = providerPairFrom(agents);
  assert.deepEqual(pair, ["anthropic", "openai"]);
  assert.equal(oppositeProvider(worker, pair), "openai");
});

test("builders on two providers are refused, naming every build phase and its provider", () => {
  const compiled = compileWorkflowStructure(shift(THREE));
  const providerFor = routes({ "t01-build": "anthropic", "t02-build": "openai", "t03-build": "anthropic", "shift-review": "openai" });
  // Why the provider half is needed: this route surface passes the pair check,
  // and a review inverted against t01's provider would land on t02's.
  const agents = compiled.phases.filter((phase) => phase.kind === "agent").map((phase) => providerFor(phase.id));
  assert.deepEqual(providerPairFrom(agents), ["anthropic", "openai"]);
  assert.equal(oppositeProvider("anthropic", providerPairFrom(agents)), providerFor("t02-build"));

  assert.throws(
    () => reviewWorkerProvider(compiled, providerFor),
    (error: unknown) => {
      assert.ok(error instanceof ReviewBuildProvidersDisagree);
      // The runner classifies it as the inversion failure it is.
      assert.ok(error instanceof InvalidReviewInversion);
      assert.deepEqual(error.providers, [
        { provider: "anthropic", phaseIds: ["t01-build", "t03-build"] },
        { provider: "openai", phaseIds: ["t02-build"] },
      ]);
      assert.equal(
        error.message,
        "review inversion is invalid: every build producer must resolve to one provider for the review to invert against; " +
          't01-build, t03-build on "anthropic"; t02-build on "openai"',
      );
      assert.doesNotMatch(error.message, /\bfound \d/u, "phases are named, not counted");
      return true;
    },
  );
});

test("a shipped recipe given a second builder compiles, and is refused only when its builders split", () => {
  // The old rule refused this recipe for having two builders. The amended rule
  // asks where they run.
  const builder = buildReviewWorkflow.phases.find((phase) => phase.id === "builder")!;
  const twoBuilders = {
    ...buildReviewWorkflow,
    id: "review-with-two-builds",
    phases: [...buildReviewWorkflow.phases, { ...builder, id: "second-builder" }],
  } satisfies WorkflowRecipe;
  const compiled = compileWorkflow(twoBuilders, twoBuilders.tier);
  assert.deepEqual(compiled.reviewBuildPhaseIds, ["builder", "second-builder"]);
  assert.equal(compiled.reviewBuildPhaseId, null);
  assert.equal(reviewWorkerProvider(compiled, routes({ builder: "openai", "second-builder": "openai" })), "openai");
  assert.throws(
    () => reviewWorkerProvider(compiled, routes({ builder: "openai", "second-builder": "anthropic" })),
    (error: unknown) => error instanceof ReviewBuildProvidersDisagree
      && error.message.endsWith('builder on "openai"; second-builder on "anthropic"'),
  );
});

test("a review with zero build producers still throws InvalidReviewBuildProducerCount, on both compile paths", () => {
  const zeroMessage =
    'a workflow with a review phase requires at least one build-producing agent phase with schema "awsf.build-output/v1", ' +
    "all on one provider; found 0";
  const isZero = (error: unknown): boolean => error instanceof InvalidReviewBuildProducerCount
    && error.count === 0 && error.phaseIds.length === 0 && error.message === zeroMessage;

  const missing = {
    ...buildReviewWorkflow,
    id: "review-without-build",
    phases: buildReviewWorkflow.phases.filter((phase) => phase.id !== "builder"),
  } satisfies WorkflowRecipe;
  assert.throws(() => compileWorkflow(missing, missing.tier), isZero);
  // compileWorkflowStructure is the recovery path, and it refuses the same way.
  assert.throws(() => compileWorkflowStructure(missing), isZero);

  const recipe = shift(THREE);
  const reviewOnly: WorkflowDefinition = { id: "shift", phases: recipe.phases.filter((phase) => !phase.id.endsWith("-build")) };
  assert.throws(() => compileWorkflowStructure(reviewOnly), isZero);

  // The provider half refuses an empty set too, before it consults any route.
  assert.throws(
    () => reviewWorkerProvider({ reviewBuildPhaseIds: [] }, () => assert.fail("no route is consulted")),
    isZero,
  );
});

test("every shipped recipe compiles unchanged, and reviewBuildPhaseId keeps its value", () => {
  // Measured at e39ac26, before the amendment, for each recipe in WORKFLOW_RECIPES.
  const before: Record<string, string | null> = {
    scout: null,
    plan: null,
    build: null,
    "plan-build-test": null,
    "build-review": "builder",
    "simple-sdlc": "builder",
    intake: null,
    "design-to-plan": null,
  };
  assert.deepEqual(WORKFLOW_RECIPES.map((recipe) => recipe.id), Object.keys(before));
  for (const recipe of WORKFLOW_RECIPES) {
    const expected = before[recipe.id]!;
    for (const compiled of [compileWorkflow(recipe, recipe.tier), compileWorkflowStructure(recipe)]) {
      assert.equal(compiled.reviewBuildPhaseId, expected, recipe.id);
      assert.deepEqual(compiled.reviewBuildPhaseIds, expected === null ? [] : [expected], recipe.id);
    }
  }
});
