// `awsf prove <task> --item <id> --arm "<adapter>/<provider>/<model>@<effort>" --rep <n> [--order <k>] --reason "<why>"`
// — the owner act that creates one proving-ground replay (W18 DD7, task 13).
//
// A replay measures one route arm on one frozen item. This creates its task in
// DRAFT, carrying the replay record the `prove` workflow compiles from and the
// arm as the attempt's own route for the one phase the item measures. It
// spawns nothing: no worktree, no provider and no git process. The owner
// starts the replay, and cancels it once its evidence is read, because a
// replay is measurement and never lands (Q7).
//
// It is the OWNER'S, with the shape `degrade-review` and `attribute` use: an
// interactive terminal first, then a written reason that is never
// credential-shaped, both checked before anything is read or persisted. Gate
// G18-B registered it in `main.ts` with its guard verb in the same commit,
// because `boundary-claims.test.ts` requires the guard's verbs to equal the
// arms that construct an owner terminal.
//
// What `awsf start` would refuse about the item and the arm is refused here,
// before the owner confirms: an unknown or invalid item, an arm short of four
// parts, and an arm the item's role cannot be routed to. Whether the pinned
// base already holds the answer key needs git, so that check stays at start.
//
// One (item, arm, repetition) is one task, and within an (item, repetition)
// each place in the order belongs to one arm. The scorer counts a second
// replay of a triple as `replay-duplicated` and a repeated place as
// `order-invalid`, so both are refused here rather than discovered there.

import { nextSteps } from "../../lifecycle/next-steps.ts";
import { renderProveActions } from "../../lifecycle/renderer.ts";
import { randomInt } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import { SEEDED_DEFECT_CLASSES, type ProvingGroundItem, type ReplayRecord } from "../../contracts/proving-ground.ts";
import { armKey, parseRouteArm } from "../../metrics/route-arm-score.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";
import { callCeilingsOf } from "../../state/tiers.ts";
import { requestedPhaseRoute } from "../../workflow/phase-routing.ts";
import { assertReplayArmRoute, compileProve, PROVE_WORKFLOW_ID } from "../../workflow/prove/compile.ts";
import { provingGroundItemIds, readProvingGroundItem, readProvingGroundPatch } from "../../workflow/prove/corpus.ts";
import { assertRoutesReachWorkflow, parseRouteFlag, type PhaseRouteOverrides } from "../../workflow/route-flags.ts";
import type { OwnerTerminal } from "../tty.ts";
import { latestAttemptNumber, readAttempt, taskRoot, type AttemptProjector, type AttemptStatus } from "./attempt.ts";
import { newCommand } from "./new.ts";
import { selectWorkflow } from "./workflows.ts";

const MAX_REASON = 2_000;

/** `awsf` is the package's bin, not on the owner's PATH, so printed commands run through the root script (T11 C13). */


export class ProveNotInteractive extends Error {
  constructor(taskId: string) {
    super(
      `awsf prove ${taskId} requires an interactive owner terminal: creating a replay is the owner's act, ` +
        "and a piped or redirected stdin cannot make it",
    );
    this.name = "ProveNotInteractive";
  }
}

export class ProveReasonRequired extends Error {
  constructor() {
    super("awsf prove requires --reason naming why this replay is worth running; it is a record, never a key");
    this.name = "ProveReasonRequired";
  }
}

export class ProveCredentialRejected extends Error {
  constructor(source: string) {
    super(`replay rejected ${source}: credential-shaped data is never persisted`);
    this.name = "ProveCredentialRejected";
  }
}

/** `--rep` or `--order` is not a place a replay can hold. */
export class ProvePlaceInvalid extends Error {
  constructor(flag: "--rep" | "--order", value: unknown) {
    super(`${flag} read ${JSON.stringify(value)}; it is a positive integer`);
    this.name = "ProvePlaceInvalid";
  }
}

export class ProveItemUnknown extends Error {
  readonly itemId: string;

  constructor(itemId: string, known: readonly string[]) {
    super(`the corpus holds no item ${JSON.stringify(itemId)}; ` +
      (known.length === 0 ? "this checkout holds no proving-ground item" : `known items: ${known.join(", ")}`));
    this.name = "ProveItemUnknown";
    this.itemId = itemId;
  }
}

/** The arm cannot be the attempt's route for the phase the item measures. */
export class ProveArmNotRouted extends Error {
  readonly arm: string;
  readonly role: string;

  constructor(arm: string, role: string, detail: string) {
    super(`arm ${JSON.stringify(arm)} does not reach the ${role} this item measures: ${detail}`);
    this.name = "ProveArmNotRouted";
    this.arm = arm;
    this.role = role;
  }
}

/**
 * A task id is written into its candidate ref, `refs/awsf/candidates/<project>/<task>/<attempt>`,
 * in the git directory every later replay's worktree shares (T11 C5).
 */
export class ProveTaskNamesDefect extends Error {
  constructor(taskId: string, defectClass: string) {
    super(`task id ${JSON.stringify(taskId)} names the seeded defect class ${defectClass}; a task id reaches the candidate refs ` +
      "every replay's worktree shares, and nothing a reviewer can read may name what it is looking for");
    this.name = "ProveTaskNamesDefect";
  }
}

export class ProveReplayRepeated extends Error {
  readonly heldBy: string;

  constructor(itemId: string, arm: string, repetition: number, heldBy: string) {
    super(`${itemId} on ${arm} at repetition ${String(repetition)} is already task ${heldBy}; ` +
      `one (item, arm, repetition) is one replay, and \`awsf retry ${heldBy}\` is how that task is run again`);
    this.name = "ProveReplayRepeated";
    this.heldBy = heldBy;
  }
}

export class ProveOrderTaken extends Error {
  readonly heldBy: string;

  constructor(itemId: string, repetition: number, order: number, heldBy: string) {
    super(`place ${String(order)} in ${itemId}'s repetition ${String(repetition)} order is already task ${heldBy}; ` +
      "each place belongs to one arm, so give another --order or omit it to draw a free one");
    this.name = "ProveOrderTaken";
    this.heldBy = heldBy;
  }
}

export interface ProveCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  /** The canonical checkout: the item is read from its corpus, and the task records it. */
  readonly repository: string;
  readonly itemId: string;
  readonly arm: string;
  readonly repetition: number;
  /** The replay's place in its repetition's order. Omitted, a free place is drawn. */
  readonly order?: number;
  readonly reason: string;
  readonly terminal: OwnerTerminal;
  readonly config: AwsfConfig;
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
  readonly sessionId?: () => string;
  /** Picks one of the free places. Uniform by default; a test seam. */
  readonly draw?: (free: readonly number[]) => number;
}

export interface ProveCommandResult {
  readonly confirmed: boolean;
  /** The created attempt, or `null` when the owner declined. */
  readonly status: AttemptStatus | null;
  readonly replay: ReplayRecord | null;
  /** The next two commands, as printed: start the replay, then cancel it once its evidence is read. */
  readonly commands: { readonly start: string; readonly cancel: string } | null;
}

/** The owner's written record of why this replay is worth running. */
export function assertProveReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) throw new ProveReasonRequired();
  const bounded = normalized.length <= MAX_REASON ? normalized : normalized.slice(0, MAX_REASON);
  if (scrubCredentialString(bounded) !== bounded || bounded.includes(REDACTED_VALUE)) {
    throw new ProveCredentialRejected("owner prove reason");
  }
  return bounded;
}

function assertPlace(flag: "--rep" | "--order", value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new ProvePlaceInvalid(flag, value);
}

/**
 * The arm as the attempt's own route for the phase the item measures: the
 * `--route <role>=<arm>` the runner requires (T12 C14), refused when it is short
 * of four parts, when `prove` never routes that role, or when its adapter is
 * disabled or undeclared.
 */
function armRoute(config: AwsfConfig, item: ProvingGroundItem, arm: string): PhaseRouteOverrides {
  try {
    parseRouteArm(arm);
    const { phaseId, selection } = parseRouteFlag(`${item.role}=${arm}`);
    const overrides: PhaseRouteOverrides = { [phaseId]: selection };
    assertRoutesReachWorkflow(overrides, PROVE_WORKFLOW_ID);
    const agent = config.agents.find((candidate) => candidate.name === item.role);
    if (agent === undefined) throw new Error(`the config defines no ${item.role} agent`);
    requestedPhaseRoute(config, item.role, agent, overrides);
    return overrides;
  } catch (error) {
    throw new ProveArmNotRouted(arm, item.role, error instanceof Error ? error.message : String(error));
  }
}

interface RecordedReplay {
  readonly taskId: string;
  readonly replay: ReplayRecord;
}

/** Every replay task of the project, read from its latest attempt: a retry carries the same record. */
async function recordedReplays(stateRoot: string, project: string): Promise<RecordedReplay[]> {
  const tasks = join(stateRoot, "projects", project, "tasks");
  let entries;
  try {
    entries = await readdir(tasks, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const recorded: RecordedReplay[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const root = join(tasks, entry.name);
    const latest = await latestAttemptNumber(root);
    if (latest === null) continue;
    const status = await readAttempt(join(root, String(latest)));
    if (status.workflow === PROVE_WORKFLOW_ID && status.replay != null) recorded.push({ taskId: status.taskId, replay: status.replay });
  }
  return recorded;
}

function keyOf(arm: string): string | null {
  try {
    return armKey(parseRouteArm(arm));
  } catch {
    return null;
  }
}

interface Placement {
  readonly order: number;
  /** The free places the order was drawn from, or `null` when the owner gave it. */
  readonly drawnFrom: readonly number[] | null;
  /** Distinct arms this project's replays name, this one included. */
  readonly arms: number;
}

/**
 * Refuses a repeated (item, arm, repetition) and a place already taken in its
 * order. Without `--order`, the place is drawn uniformly from the free places
 * among 1..n, where n counts the distinct arms this project's replays name,
 * this one included: the protocol has no record of its own, so its arms are
 * the ones replayed so far (T11 C11, C12).
 */
function placeReplay(
  recorded: readonly RecordedReplay[],
  itemId: string,
  arm: string,
  repetition: number,
  order: number | undefined,
  draw: (free: readonly number[]) => number,
): Placement {
  const key = armKey(parseRouteArm(arm));
  const pair = recorded.filter(({ replay }) => replay.itemId === itemId && replay.repetition === repetition);
  const repeated = pair.find(({ replay }) => keyOf(replay.arm) === key);
  if (repeated !== undefined) throw new ProveReplayRepeated(itemId, arm, repetition, repeated.taskId);
  const arms = new Set([key, ...recorded.flatMap(({ replay }) => keyOf(replay.arm) ?? [])]).size;
  if (order !== undefined) {
    const holder = pair.find(({ replay }) => replay.order === order);
    if (holder !== undefined) throw new ProveOrderTaken(itemId, repetition, order, holder.taskId);
    return { order, drawnFrom: null, arms };
  }
  const taken = new Set(pair.map(({ replay }) => replay.order));
  const free = Array.from({ length: arms }, (_, index) => index + 1).filter((place) => !taken.has(place));
  const drawn = draw(free);
  if (!free.includes(drawn)) throw new Error(`drew place ${String(drawn)}, which is not one of the free places ${free.join(", ")}`);
  return { order: drawn, drawnFrom: free, arms };
}

function uniform(free: readonly number[]): number {
  return free[randomInt(free.length)]!;
}

export async function proveCommand(options: ProveCommandOptions): Promise<ProveCommandResult> {
  const { project, taskId, arm, repetition } = options;
  // The medium first: a caller that cannot type into a terminal cannot take
  // this act, whatever it asks for, and nothing is read on its behalf.
  if (!options.terminal.interactive) throw new ProveNotInteractive(taskId);
  const reason = assertProveReason(options.reason);
  assertPlace("--rep", repetition);
  if (options.order !== undefined) assertPlace("--order", options.order);
  selectWorkflow(options.config, PROVE_WORKFLOW_ID);

  const item = readProvingGroundItem(options.repository, options.itemId);
  if (item === null) throw new ProveItemUnknown(options.itemId, provingGroundItemIds(options.repository));
  const routeOverrides = armRoute(options.config, item, arm);
  // The compile `awsf start` and the runner repeat on the same bytes: an item
  // whose role is not its kind's, or that names a gate the config lacks, is
  // refused now rather than after the owner has confirmed.
  const recipe = compileProve(
    { item, patch: readProvingGroundPatch(options.repository, item) },
    arm,
    { prompts: { builder: "", reviewer: "" }, gates: Object.keys(options.config.gates) },
  );
  assertReplayArmRoute(recipe, routeOverrides);
  if (item.kind === "review") {
    const named = SEEDED_DEFECT_CLASSES.find((defectClass) => taskId.toLowerCase().includes(defectClass));
    if (named !== undefined) throw new ProveTaskNamesDefect(taskId, named);
  }
  const existing = await latestAttemptNumber(taskRoot(options.stateRoot, project, taskId));
  if (existing !== null) throw new Error(`${project}/${taskId} already has attempt ${String(existing)}; a replay is a new task`);

  const draw = options.draw ?? uniform;
  const placed = placeReplay(await recordedReplays(options.stateRoot, project), item.id, arm, repetition, options.order, draw);
  const replay: ReplayRecord = {
    itemId: item.id, itemDigest: recipe.itemDigest, arm, repetition, order: placed.order, baseSha: item.baseSha,
  };

  options.terminal.write(`Task: ${project}/${taskId}, a proving-ground replay (workflow ${PROVE_WORKFLOW_ID}, T${String(recipe.tier)})`);
  options.terminal.write(`Item: ${item.id}, a ${item.kind} item measuring the ${item.role}, pinned to ${item.baseSha}`);
  options.terminal.write(`Arm: ${arm}, recorded as --route ${recipe.armPhaseId}=${arm}`);
  options.terminal.write(`Repetition ${String(repetition)}, place ${String(placed.order)} in its order` + (placed.drawnFrom === null
    ? ", as given"
    : `, drawn from the free place(s) ${placed.drawnFrom.join(", ")} of the ${String(placed.arms)} arm(s) this project's replays name`));
  options.terminal.write(`Reason on record: ${reason}`);
  options.terminal.write("The replay runs the item's request through the production prompts, sandbox and gates, on this arm alone. It never lands: once its evidence is read, it is cancelled.");
  options.terminal.write("This creates the task in DRAFT and nothing else: no worktree, provider or process exists until it is started.");
  const confirmed = await options.terminal.confirm(`Create replay ${taskId}: ${item.id} on ${arm}, repetition ${String(repetition)}, place ${String(placed.order)}?`);
  if (!confirmed) return { confirmed: false, status: null, replay: null, commands: null };

  // Close the display-to-write race: another terminal may have recorded this
  // triple, or taken this place, since the owner read it.
  placeReplay(await recordedReplays(options.stateRoot, project), item.id, arm, repetition, placed.order, draw);
  const created = await newCommand({
    stateRoot: options.stateRoot,
    project,
    taskId,
    repository: options.repository,
    // The item's own words, or `bind.ts` refuses the replay at start.
    request: item.request,
    workflow: PROVE_WORKFLOW_ID,
    tier: recipe.tier,
    replay,
    configSnapshotJson: toConfigSnapshotJson(options.config),
    routeOverrides,
    callCeilings: callCeilingsOf(options.config.risk.call_ceiling),
    allowance: options.config.risk.correction_allowance,
    lastActivity: `owner created this proving-ground replay: ${reason}`,
    ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
  });
  const { commands, lines } = renderProveActions(nextSteps({ ...created.status, state: created.status.lifecycleState }));
  options.terminal.write(`Created ${project}/${taskId} attempt ${String(created.status.attempt)} in DRAFT. Nothing has started.`);
  for (const line of lines) options.terminal.write(line);
  return { confirmed: true, status: created.status, replay, commands };
}
