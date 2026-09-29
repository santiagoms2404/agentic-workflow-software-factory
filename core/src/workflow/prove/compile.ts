import { BuildOutputSchema, BUILD_OUTPUT_SCHEMA_ID, type BuildOutput } from "../../contracts/build-output.ts";
import { PlanOutputSchema, type PlanOutput } from "../../contracts/plan-output.ts";
import {
  assertProvingGroundItem,
  provingGroundItemDigest,
  type BuildItem,
  type ReviewItem,
} from "../../contracts/proving-ground.ts";
import { ReviewContextSchema } from "../../contracts/review-context.ts";
import { ReviewOutputSchema } from "../../contracts/review-output.ts";
import type { PhaseRouteSelection } from "../../contracts/route-selection.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import { parseRouteArm, type RouteArm } from "../../metrics/route-arm-score.ts";
import type { Tier } from "../../state/tiers.ts";
import { assertEarnedDescription, type WorkflowRecipe } from "../compiler.ts";
import type { LocalPhaseDefinition, PhaseDefinition } from "../phase.ts";
import { requireHostExecution } from "../recipe-support.ts";

// The prove compiler (W18 DD7, task 12): one frozen proving-ground item and one
// route arm become one recipe. Pure, as `shift/compile.ts` is: it reads no file,
// no clock and no provider. The caller supplies every byte, so the first run,
// `awsf start` and every recovery compile the same recipe, and `bind.ts`
// refuses when the bytes no longer match the digest the replay recorded.
//
// A review item's candidate is built by no provider. The host commits the
// item's patch on its pinned base, and that host phase is the review's one
// build producer. With no builder provider there is no inversion to compute,
// so the review runs on the arm's explicit route: seeded mode in
// `production-run.ts`. A build item is ordinary build work on the arm's route
// with no review tail. Neither ever lands (Q7).
//
// Phase ids are the shipped ones wherever a shipped role is repeated, so the
// runner's role-keyed tables (output ownership, builder gates, the commit
// message) apply to a replay unchanged and no role mapping is needed.

export const PROVE_WORKFLOW_ID = "prove";
export const PROVE_SEED_PHASE_ID = "seed";

/** A build replay is gated only, at T1; a review replay buys its review, at T2. */
export const PROVE_TIER_FLOOR: Tier = 1;

export interface ProveCompileConfig {
  /** The committed builder and reviewer user prompts. The caller reads them; the compiler never does. */
  readonly prompts: { readonly builder: string; readonly reviewer: string };
  /** The gate ids the effective config declares. A build item may name only these. */
  readonly gates: readonly string[];
}

/** The item as read, and the bytes of the patch it names: null for a build item. */
export interface ProveItemSource {
  readonly item: unknown;
  readonly patch: Uint8Array | null;
}

/** The seed carries its patch and message, so the recipe's bytes include the planted change. */
export interface ProveSeedPhase extends LocalPhaseDefinition<BuildOutput> {
  readonly kind: "code";
  readonly seed: { readonly patch: Uint8Array; readonly message: string };
}

/** A build replay's brief carries the item's own words, as a shift brief carries its ticket's. */
export interface ProveBriefPhase extends LocalPhaseDefinition<PlanOutput> {
  readonly kind: "engineer";
  readonly intent: PlanOutput;
}

export interface ProveRecipe extends WorkflowRecipe {
  readonly id: typeof PROVE_WORKFLOW_ID;
  readonly itemId: string;
  readonly itemDigest: string;
  readonly arm: RouteArm;
  /** The one agent phase the arm routes: the reviewer of a review item, the builder of a build item. */
  readonly armPhaseId: "reviewer" | "builder";
  readonly phases: readonly PhaseDefinition[];
}

/** The item fails its schema, its patch bytes are missing or unexpected, or it names a gate the config lacks. */
export class ProveItemInvalid extends Error {
  constructor(reason: string) {
    super(`proving-ground item cannot be compiled: ${reason}`);
    this.name = "ProveItemInvalid";
  }
}

/**
 * The arm must reach its phase as the attempt's own explicit, complete route.
 * A part left to the configured default would measure whatever the config held
 * that day, and a seeded review has no builder provider to invert against, so
 * nothing else can supply its route.
 */
export class ReplayArmNotRouted extends Error {
  readonly phaseId: string;
  readonly arm: string;

  constructor(phaseId: string, arm: string, detail: string) {
    super(`replay arm ${JSON.stringify(arm)} must route phase ${JSON.stringify(phaseId)} as the attempt's explicit ` +
      `--route ${phaseId}=${arm}; ${detail}`);
    this.name = "ReplayArmNotRouted";
    this.phaseId = phaseId;
    this.arm = arm;
  }
}

/**
 * A replay's agent cannot be confined to its worktree, so it does not run
 * (W18 task 18). A reviewer that can read the corpus, this plan or another
 * checkout could read the answer key, and its score would measure nothing.
 */
export class ReplayConfinementUnavailable extends Error {
  readonly phaseId: string;

  constructor(phaseId: string, detail: string) {
    super(`replay phase ${JSON.stringify(phaseId)} cannot run confined to its worktree: ${detail}`);
    this.name = "ReplayConfinementUnavailable";
    this.phaseId = phaseId;
  }
}

/** A replay is measurement, never delivery (Q7). The owner cancels each one. */
export class ReplayNotDeliverable extends Error {
  readonly taskId: string;

  constructor(taskId: string, act: "land" | "journey") {
    super(`task ${taskId} is a proving-ground replay: a replay is measurement, never delivery, so \`awsf ${act}\` ` +
      `refuses it; run \`awsf cancel ${taskId}\` once its evidence is read`);
    this.name = "ReplayNotDeliverable";
    this.taskId = taskId;
  }
}

/** Refuses unless the attempt's own override names every part of the arm, exactly. */
export function assertReplayArmRoute(
  recipe: Pick<ProveRecipe, "arm" | "armPhaseId">,
  overrides: Readonly<Record<string, PhaseRouteSelection>>,
): void {
  const selected = overrides[recipe.armPhaseId];
  if (selected === undefined) throw new ReplayArmNotRouted(recipe.armPhaseId, recipe.arm.spec, "the attempt records no route for it");
  const differing = (["adapter", "provider", "model", "effort"] as const).filter((part) => selected[part] !== recipe.arm[part]);
  if (differing.length > 0) {
    throw new ReplayArmNotRouted(recipe.armPhaseId, recipe.arm.spec, `the recorded route differs in ${differing.join(", ")}`);
  }
}

function reviewPhases(item: ReviewItem, patch: Uint8Array | null, config: ProveCompileConfig): PhaseDefinition[] {
  if (patch === null) throw new ProveItemInvalid(`${item.id} is a review item and no bytes were supplied for its patch ${item.seed.patch}`);
  const seed: ProveSeedPhase = {
    id: PROVE_SEED_PHASE_ID,
    kind: "code",
    owner: "host",
    description: "Commit the item's patch on its pinned base as the one candidate, built by no provider",
    schemaId: BUILD_OUTPUT_SCHEMA_ID,
    outputSchema: BuildOutputSchema,
    maxCorrections: 0,
    gates: [],
    // The request is the message: the reviewer can read the log, and a
    // message naming the item or the suite would tell it what to look for.
    seed: { patch, message: item.request },
    execute: (context) => requireHostExecution(PROVE_SEED_PHASE_ID, context),
  };
  return [
    seed,
    // Not in the task's list, and required by the runner: review evidence
    // carries the gates' result, L11 is authorized on `gatesPass`, and DD7
    // runs a replay through production's gates as well as its prompts.
    {
      id: "tests",
      kind: "code",
      owner: "host",
      description: "Run the configured quality commands against the seeded candidate commit",
      schemaId: "awsf.test-output/v1",
      outputSchema: TestOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("tests", context),
    },
    {
      id: "review-context",
      kind: "code",
      owner: "host",
      description: "Compose the host-observed diff, intent, and gate evidence the reviewer must judge against",
      schemaId: "awsf.review-context/v1",
      outputSchema: ReviewContextSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("review-context", context),
    },
    {
      id: "reviewer",
      kind: "agent",
      owner: "reviewer",
      description: "Audit the seeded candidate on the arm's explicit route and report concrete defects",
      schemaId: "awsf.review-output/v1",
      outputSchema: ReviewOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: config.prompts.reviewer,
    },
  ];
}

function buildIntent(item: BuildItem): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: item.request,
    artifacts: [],
    notesForNextPhase: "Implement only this request in the managed worktree.",
    goals: [item.request],
    nonGoals: ["Unrequested changes and changes outside the configured write policy"],
    implementationSteps: [{ id: "request", title: "Implement the request", files: [], acceptanceCriteria: [...item.acceptance] }],
    testStrategy: [`Pass the configured gates ${item.gates.join(", ")} on the first candidate`],
    risks: [],
    openQuestions: [],
  };
}

function buildPhases(item: BuildItem, patch: Uint8Array | null, config: ProveCompileConfig): PhaseDefinition[] {
  if (patch !== null) throw new ProveItemInvalid(`${item.id} is a build item and names no patch, but patch bytes were supplied`);
  const unknown = item.gates.filter((gate) => !config.gates.includes(gate));
  if (unknown.length > 0) throw new ProveItemInvalid(`${item.id} names gate(s) the config does not declare: ${unknown.join(", ")}`);
  const intent = Object.freeze(buildIntent(item));
  const brief: ProveBriefPhase = {
    id: "request",
    kind: "engineer",
    owner: "host",
    description: "Carry the item's request and acceptance into the replay verbatim, without a provider",
    schemaId: "awsf.plan-output/v1",
    outputSchema: PlanOutputSchema,
    maxCorrections: 0,
    gates: [],
    intent,
    execute: async () => intent,
  };
  return [
    brief,
    {
      id: "builder",
      kind: "agent",
      owner: "builder",
      description: "Implement the item's request on the arm's explicit route as one host commit",
      schemaId: BUILD_OUTPUT_SCHEMA_ID,
      outputSchema: BuildOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: config.prompts.builder,
    },
    {
      id: "tests",
      kind: "code",
      owner: "host",
      description: "Run the configured quality commands against the host-created candidate commit",
      schemaId: "awsf.test-output/v1",
      outputSchema: TestOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("tests", context),
    },
  ];
}

/** Compiles one item on one arm into one prove recipe. Pure. */
export function compileProve(source: ProveItemSource, arm: string, config: ProveCompileConfig): ProveRecipe {
  const item = source.item;
  try {
    assertProvingGroundItem(item);
  } catch (error) {
    throw new ProveItemInvalid(error instanceof Error ? error.message : String(error));
  }
  const expectedRole = item.kind === "review" ? "reviewer" : "builder";
  if (item.role !== expectedRole) {
    throw new ProveItemInvalid(`${item.id} is a ${item.kind} item, which measures the ${expectedRole}, and it names role ${JSON.stringify(item.role)}`);
  }
  const parsedArm = parseRouteArm(arm);
  const phases = item.kind === "review" ? reviewPhases(item, source.patch, config) : buildPhases(item, source.patch, config);
  for (const phase of phases) assertEarnedDescription(phase.id, phase.description);
  // The arm measures one role, so every replay spends one initial call.
  const calls = phases.filter((phase) => phase.kind === "agent").length;
  if (calls !== 1) throw new Error(`prove compiled ${String(calls)} agent phases for item ${item.id}; expected 1`);
  return Object.freeze({
    id: PROVE_WORKFLOW_ID,
    tier: item.kind === "review" ? 2 : PROVE_TIER_FLOOR,
    itemId: item.id,
    itemDigest: provingGroundItemDigest(item, source.patch),
    arm: parsedArm,
    armPhaseId: expectedRole,
    phases: Object.freeze(phases.map((phase) => Object.freeze(phase))),
  });
}
