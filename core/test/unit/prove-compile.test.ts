import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BuildOutputSchema, BUILD_OUTPUT_SCHEMA_ID } from "../../src/contracts/build-output.ts";
import { provingGroundItemDigest, type ReplayRecord, type ReviewItem } from "../../src/contracts/proving-ground.ts";
import { RouteArmSpecInvalid } from "../../src/metrics/route-arm-score.ts";
import { compiledWorkflow, WORKFLOW_RECIPES, workflowRecipe } from "../../src/workflow/catalog.ts";
import { COMPILED_WORKFLOW_IDS } from "../../src/workflow/compiled-ids.ts";
import {
  compileWorkflow,
  compileWorkflowStructure,
  InvalidReviewBuildProducerCount,
  seededReviewProducer,
  type WorkflowDefinition,
} from "../../src/workflow/compiler.ts";
import type { PhaseDefinition } from "../../src/workflow/phase.ts";
import { bindProveRecipe, PROVING_GROUND_DIR, ReplayBindingRefused } from "../../src/workflow/prove/bind.ts";
import {
  assertReplayArmRoute,
  compileProve,
  ProveItemInvalid,
  ReplayArmNotRouted,
  type ProveSeedPhase,
} from "../../src/workflow/prove/compile.ts";
import { loadUserPrompt, requireHostExecution } from "../../src/workflow/recipe-support.ts";
import { buildReviewWorkflow } from "../../src/workflow/recipes/build-review.ts";
import { InvalidReviewInversion, runMandatoryReview } from "../../src/workflow/review-routing.ts";

// W18 task 12: the prove workflow. The compiler half is pure and is proved
// here; the runner half (seeded mode, the seed commit, land and journey
// refusing a replay) is proved end to end in `prove-run.test.ts`.

const ARM = "claude/anthropic/claude:opus@high";
const CONFIG = {
  prompts: { builder: loadUserPrompt("builder"), reviewer: loadUserPrompt("reviewer") },
  gates: ["test", "typecheck", "lint"],
};

function corpusItem(id: string): { item: ReviewItem; patch: Uint8Array } {
  const item = JSON.parse(readFileSync(resolve(PROVING_GROUND_DIR, `${id}.json`), "utf8")) as ReviewItem;
  return { item, patch: new Uint8Array(readFileSync(resolve(item.seed.patch))) };
}

const BUILD_ITEM = {
  schema: "awsf.proving-ground-item/v1",
  id: "build-01",
  kind: "build",
  taskClass: "bounded-feature",
  role: "builder",
  baseSha: "a".repeat(40),
  request: "Add a widget that reports its own name.",
  gates: ["test"],
  acceptance: ["The widget reports its own name"],
} as const;

const shape = (phases: readonly PhaseDefinition[]): string[] =>
  phases.map((phase) => `${phase.id}:${phase.kind}:${phase.owner}:${phase.schemaId}:${String(phase.maxCorrections)}`);

// ---------------------------------------------------------------------------
// The compiler's review rule is relaxed for prove and nowhere else.
// ---------------------------------------------------------------------------

/**
 * What each shipped recipe compiled to at ebd85d9, the base this task was
 * built on, read from `compileWorkflowStructure` there. The seeded exception
 * must leave every one of them exactly as it was.
 */
const SHIPPED_BEFORE: Readonly<Record<string, { minimumCalls: number; reviewBuildPhaseId: string | null; reviewBuildPhaseIds: readonly string[] }>> = {
  scout: { minimumCalls: 1, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
  plan: { minimumCalls: 1, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
  build: { minimumCalls: 1, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
  "plan-build-test": { minimumCalls: 2, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
  "build-review": { minimumCalls: 2, reviewBuildPhaseId: "builder", reviewBuildPhaseIds: ["builder"] },
  "simple-sdlc": { minimumCalls: 4, reviewBuildPhaseId: "builder", reviewBuildPhaseIds: ["builder"] },
  intake: { minimumCalls: 1, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
  "design-to-plan": { minimumCalls: 3, reviewBuildPhaseId: null, reviewBuildPhaseIds: [] },
};

test("every shipped recipe compiles to the value it compiled to before, and none is seeded", () => {
  assert.deepEqual(WORKFLOW_RECIPES.map((recipe) => recipe.id), Object.keys(SHIPPED_BEFORE));
  for (const recipe of WORKFLOW_RECIPES) {
    const compiled = compileWorkflowStructure(recipe);
    const before = SHIPPED_BEFORE[recipe.id]!;
    assert.equal(compiled.minimumCalls, before.minimumCalls, recipe.id);
    assert.equal(compiled.reviewBuildPhaseId, before.reviewBuildPhaseId, recipe.id);
    assert.deepEqual(compiled.reviewBuildPhaseIds, before.reviewBuildPhaseIds, recipe.id);
    assert.deepEqual(shape(compiled.phases as unknown as PhaseDefinition[]), shape(recipe.phases), recipe.id);
    assert.equal(seededReviewProducer(compiled), null, recipe.id);
  }
});

function reviewWithout(workflowId: string, producer: "none" | "seed" | "two-seeds"): WorkflowDefinition {
  const review = buildReviewWorkflow.phases.find((phase) => phase.id === "reviewer")!;
  const seed = (id: string): PhaseDefinition => ({
    id, kind: "code", owner: "host", description: "Commit a frozen patch as the candidate no provider built",
    schemaId: BUILD_OUTPUT_SCHEMA_ID, outputSchema: BuildOutputSchema, maxCorrections: 0, gates: [],
    execute: (context) => requireHostExecution(id, context),
  });
  const seeds = producer === "none" ? [] : producer === "seed" ? [seed("seed")] : [seed("seed"), seed("seed-again")];
  return { id: workflowId, phases: [...seeds, review] };
}

test("a review with no build producer still throws its original error class, for every workflow", () => {
  for (const id of ["build-review", "shift", "prove", "a-future-workflow"]) {
    assert.throws(() => compileWorkflowStructure(reviewWithout(id, "none")), InvalidReviewBuildProducerCount, id);
  }
});

test("a host seed is a review's build producer for prove only, and only when it is the one producer", () => {
  const prove = compileWorkflowStructure(reviewWithout("prove", "seed"));
  assert.deepEqual(prove.reviewBuildPhaseIds, ["seed"]);
  assert.equal(prove.reviewBuildPhaseId, "seed");
  assert.equal(seededReviewProducer(prove), "seed");
  // The same shape under any other id is still a review with no producer.
  for (const id of ["build-review", "simple-sdlc", "shift", "a-future-workflow"]) {
    assert.throws(() => compileWorkflowStructure(reviewWithout(id, "seed")), InvalidReviewBuildProducerCount, id);
  }
  assert.throws(() => compileWorkflowStructure(reviewWithout("prove", "two-seeds")), InvalidReviewBuildProducerCount);
  // A prove recipe whose producer is an agent is not seeded: it would invert.
  const agentBuilt = compileWorkflowStructure({ id: "prove", phases: buildReviewWorkflow.phases });
  assert.deepEqual(agentBuilt.reviewBuildPhaseIds, ["builder"]);
  assert.equal(seededReviewProducer(agentBuilt), null);
});

// ---------------------------------------------------------------------------
// compileProve.
// ---------------------------------------------------------------------------

test("prove is a compiled id with its own compiler and no placeholder recipe", () => {
  assert.ok((COMPILED_WORKFLOW_IDS as readonly string[]).includes("prove"));
  assert.equal(workflowRecipe("prove"), null);
  const declared = compiledWorkflow("prove")!;
  assert.equal(declared.compile, compileProve);
  assert.equal(declared.tierFloor, 1);
  assert.equal(declared.buysReview, false, "a build replay compiles no review, so not every compilation buys one");
  assert.deepEqual([...declared.agentOwners], ["builder", "reviewer"]);
});

test("a review item compiles to a host seed, the gates, the evidence and one reviewer, at T2", () => {
  const { item, patch } = corpusItem("review-01");
  const recipe = compileProve({ item, patch }, ARM, CONFIG);
  assert.equal(recipe.id, "prove");
  assert.equal(recipe.tier, 2);
  assert.equal(recipe.itemId, "review-01");
  assert.equal(recipe.itemDigest, provingGroundItemDigest(item, patch));
  assert.equal(recipe.arm.spec, ARM);
  assert.equal(recipe.armPhaseId, "reviewer");
  assert.deepEqual(shape(recipe.phases), [
    "seed:code:host:awsf.build-output/v1:0",
    "tests:code:host:awsf.test-output/v1:0",
    "review-context:code:host:awsf.review-context/v1:0",
    "reviewer:agent:reviewer:awsf.review-output/v1:1",
  ]);
  const seed = recipe.phases[0] as ProveSeedPhase;
  assert.deepEqual(seed.seed.patch, patch, "the recipe carries the patch's exact bytes");
  // Nothing the reviewer can read names the suite, the item or its defect.
  assert.equal(seed.seed.message, item.request);
  for (const leak of [item.id, item.seed.defectClass, "proving", "seed"]) assert.equal(seed.seed.message.includes(leak), false, leak);

  const compiled = compileWorkflow(recipe, recipe.tier);
  assert.equal(compiled.minimumCalls, 1);
  assert.deepEqual(compiled.reviewBuildPhaseIds, ["seed"]);
  assert.equal(seededReviewProducer(compiled), "seed");
});

test("a build item compiles to the item's brief, one builder on the arm and the gates, with no review tail", () => {
  const recipe = compileProve({ item: BUILD_ITEM, patch: null }, "codex/openai-codex/gpt-5.6-sol@high", CONFIG);
  assert.equal(recipe.tier, 1);
  assert.equal(recipe.armPhaseId, "builder");
  assert.deepEqual(shape(recipe.phases), [
    "request:engineer:host:awsf.plan-output/v1:0",
    "builder:agent:builder:awsf.build-output/v1:1",
    "tests:code:host:awsf.test-output/v1:0",
  ]);
  const brief = recipe.phases[0] as PhaseDefinition & { intent: { goals: string[]; implementationSteps: { acceptanceCriteria: string[] }[] } };
  assert.deepEqual(brief.intent.goals, [BUILD_ITEM.request]);
  assert.deepEqual(brief.intent.implementationSteps[0]!.acceptanceCriteria, BUILD_ITEM.acceptance);
  const compiled = compileWorkflow(recipe, recipe.tier);
  assert.deepEqual(compiled.reviewBuildPhaseIds, []);
  assert.equal(seededReviewProducer(compiled), null);
});

test("compileProve refuses an item it cannot replay faithfully, each by name", () => {
  const { item, patch } = corpusItem("review-02");
  assert.throws(() => compileProve({ item, patch: null }, ARM, CONFIG), ProveItemInvalid);
  assert.throws(() => compileProve({ item: BUILD_ITEM, patch }, ARM, CONFIG), ProveItemInvalid);
  assert.throws(() => compileProve({ item: { ...BUILD_ITEM, gates: ["deploy"] }, patch: null }, ARM, CONFIG), /does not declare: deploy/);
  assert.throws(() => compileProve({ item: { ...item, role: "planner" }, patch }, ARM, CONFIG), /measures the reviewer/);
  assert.throws(() => compileProve({ item: { ...item, schema: "awsf.other/v1" }, patch }, ARM, CONFIG), ProveItemInvalid);
  // An arm names every part of its route, so a replay never measures a default.
  for (const partial of ["claude:opus", "claude/anthropic/claude:opus", "claude//claude:opus@high"]) {
    assert.throws(() => compileProve({ item, patch }, partial, CONFIG), RouteArmSpecInvalid, partial);
  }
});

test("the digest covers the patch bytes as well as the item, so a moved patch moves it", () => {
  const { item, patch } = corpusItem("review-03");
  const moved = new Uint8Array([...patch, 0x0a]);
  assert.notEqual(provingGroundItemDigest(item, patch), provingGroundItemDigest(item, moved));
  assert.notEqual(provingGroundItemDigest(item, patch), provingGroundItemDigest({ ...item, request: `${item.request} ` }, patch));
  assert.equal(provingGroundItemDigest(item, patch), provingGroundItemDigest(JSON.parse(JSON.stringify(item)) as ReviewItem, patch.slice()));
});

// ---------------------------------------------------------------------------
// Seeded mode's route: the arm, whole, or nothing.
// ---------------------------------------------------------------------------

test("seeded mode refuses a missing or partial reviewer route by name", () => {
  const { item, patch } = corpusItem("review-01");
  const recipe = compileProve({ item, patch }, ARM, CONFIG);
  const whole = { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" } as const;
  assert.doesNotThrow(() => assertReplayArmRoute(recipe, { reviewer: whole }));
  assert.throws(() => assertReplayArmRoute(recipe, {}), (error: unknown) =>
    error instanceof ReplayArmNotRouted && error.phaseId === "reviewer" && /records no route for it/.test(error.message) &&
    error.message.includes(`--route reviewer=${ARM}`));
  // A builder route is not the reviewer's.
  assert.throws(() => assertReplayArmRoute(recipe, { builder: whole }), ReplayArmNotRouted);
  const { effort: _effort, ...noEffort } = whole;
  assert.throws(() => assertReplayArmRoute(recipe, { reviewer: noEffort }), /differs in effort/);
  assert.throws(() => assertReplayArmRoute(recipe, { reviewer: { ...whole, provider: "openai-codex" } }), /differs in provider/);
  assert.throws(() => assertReplayArmRoute(recipe, { reviewer: { model: "claude:opus" } }), /differs in adapter, provider, effort/);
});

test("a seeded review runs on the provider it names, and refuses to run without one", async () => {
  const routed: string[] = [];
  const result = await runMandatoryReview({
    workerProvider: "host", mode: "seeded", reviewProvider: "anthropic",
    isTransportFailure: () => false,
    execute: async (provider) => { routed.push(provider); return provider; },
  });
  assert.equal(result, "anthropic");
  assert.deepEqual(routed, ["anthropic"], "no pair and no inversion: the named provider, once");
  await assert.rejects(runMandatoryReview({
    workerProvider: "host", mode: "seeded", isTransportFailure: () => false, execute: async () => "never",
  }), InvalidReviewInversion);
});

// ---------------------------------------------------------------------------
// bind.ts: the bytes come from the canonical repository and must still match.
// ---------------------------------------------------------------------------

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const REQUEST = "Report the probe's second line.";
const PATCH = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n base\n+seeded\n";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** A two-commit repository: the base, then the corpus that must postdate it. */
function corpusRepository(): { repository: string; baseSha: string; replay: ReplayRecord } {
  const repository = mkdtempSync(join(tmpdir(), "awsf-prove-bind-"));
  execFileSync("git", ["init", "-q", "-b", "main", repository]);
  writeFileSync(join(repository, "README.md"), "base\n");
  git(repository, "add", ".");
  git(repository, ...OWNER, "commit", "-q", "-m", "base");
  const baseSha = git(repository, "rev-parse", "HEAD");
  const item: ReviewItem = {
    schema: "awsf.proving-ground-item/v1", id: "probe-01", kind: "review", taskClass: "evidence-heavy-defect-review",
    role: "reviewer", baseSha, request: REQUEST,
    seed: { patch: `${PROVING_GROUND_DIR}/probe-01.patch`, defectClass: "off-by-one",
      expected: [{ file: "README.md", lineStart: 2, lineEnd: 2 }] },
  };
  mkdirSync(join(repository, PROVING_GROUND_DIR), { recursive: true });
  writeFileSync(join(repository, PROVING_GROUND_DIR, "probe-01.json"), `${JSON.stringify(item, null, 2)}\n`);
  writeFileSync(join(repository, item.seed.patch), PATCH);
  git(repository, "add", ".");
  git(repository, ...OWNER, "commit", "-q", "-m", "corpus");
  const replay: ReplayRecord = {
    itemId: "probe-01", itemDigest: provingGroundItemDigest(item, new Uint8Array(Buffer.from(PATCH))),
    arm: ARM, repetition: 1, order: 1, baseSha,
  };
  return { repository, baseSha, replay };
}

test("bind compiles the replay's item from the canonical repository and records its digest", async () => {
  const { repository, replay } = corpusRepository();
  const recipe = await bindProveRecipe({ repository, request: REQUEST, replay }, CONFIG);
  assert.equal(recipe.itemDigest, replay.itemDigest);
  assert.equal(Buffer.from((recipe.phases[0] as ProveSeedPhase).seed.patch).toString("utf8"), PATCH);
});

test("bind refuses a replay whose item, patch, request or base no longer describe it", async () => {
  const { repository, replay } = corpusRepository();
  const bind = (attempt: { request?: string; replay?: unknown }) =>
    bindProveRecipe({ repository, request: attempt.request ?? REQUEST, replay: attempt.replay ?? replay }, CONFIG);
  await assert.rejects(bind({ replay: { ...replay, repetition: 0 } }), ReplayBindingRefused);
  await assert.rejects(bind({ request: `${REQUEST} And more.` }), /not item probe-01's request/);
  await assert.rejects(bind({ replay: { ...replay, baseSha: "f".repeat(40) } }), /pinned to/);
  // The arm is the replay's own choice, not item bytes, so it moves no digest.
  assert.equal((await bind({ replay: { ...replay, arm: "claude/anthropic/claude:opus@max" } })).arm.effort, "max");
  // INV-4: one moved byte in the patch refuses the compile.
  writeFileSync(join(repository, PROVING_GROUND_DIR, "probe-01.patch"), `${PATCH}\n`);
  await assert.rejects(bind({}), /changed since the replay was created/);
});

test("bind refuses a base that already holds the item, since its worktree would hold the answer key", async () => {
  const { repository } = corpusRepository();
  const head = git(repository, "rev-parse", "HEAD");
  const item = JSON.parse(readFileSync(join(repository, PROVING_GROUND_DIR, "probe-01.json"), "utf8")) as ReviewItem;
  const repinned = { ...item, baseSha: head };
  writeFileSync(join(repository, PROVING_GROUND_DIR, "probe-01.json"), `${JSON.stringify(repinned, null, 2)}\n`);
  const replay: ReplayRecord = {
    itemId: "probe-01", itemDigest: provingGroundItemDigest(repinned, new Uint8Array(Buffer.from(PATCH))),
    arm: ARM, repetition: 1, order: 1, baseSha: head,
  };
  await assert.rejects(bindProveRecipe({ repository, request: REQUEST, replay }, CONFIG),
    /already contains core\/src\/metrics\/proving-ground\/probe-01\.json, core\/src\/metrics\/proving-ground\/probe-01\.patch/);
});
