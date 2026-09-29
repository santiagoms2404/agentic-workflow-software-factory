import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import type { AdapterEntry } from "../../src/config/schema.ts";
import type { PhaseRouteSelection } from "../../src/contracts/route-selection.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { runSystemCommand } from "../../src/execution/transport-broker.ts";
import { callCeilingsOf } from "../../src/state/tiers.ts";
import { PROVING_GROUND_DIR } from "../../src/workflow/prove/bind.ts";
import { ReplayNotDeliverable } from "../../src/workflow/prove/compile.ts";
import type { SandboxProbe } from "../../src/policy/sandbox-broker.ts";
import { assertConfinedLaunch, countingBroker, git, hasBwrap, REQUEST, ReviewAdapter, world, type World } from "./_prove-replay.ts";

// W18 task 12, the runner half: one review replay from DRAFT to AWAITING_OWNER
// on the fixture route over a two-commit repository, so the pinned base and
// the seed commit are real Git objects. No provider is called. Seeded mode is
// taken, the arm's route is required, and land and journey refuse the replay.
// The harness is shared with the task 14 journey, `journeys/prove-replay.test.ts`.

const ARM_ROUTE = { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" } as const;

const terminal: OwnerTerminal = { interactive: true, write: () => undefined, confirm: async () => true };

/** `awsf new` for a replay, as `awsf prove` will call it (T13), then `awsf start` and the runner. */
async function runReplay(fixture: World, taskId: string, routeOverrides: Readonly<Record<string, PhaseRouteSelection>>,
  sandboxProbe: SandboxProbe = hasBwrap) {
  const created = await newCommand({
    stateRoot: fixture.stateRoot, project: fixture.config.project.slug, taskId, repository: fixture.canonical,
    request: REQUEST, workflow: "prove", tier: 2, replay: fixture.replay, routeOverrides,
    configSnapshotJson: toConfigSnapshotJson(fixture.config), callCeilings: callCeilingsOf(fixture.config.risk.call_ceiling),
    allowance: fixture.config.risk.correction_allowance,
  });
  const prepared = await startCommand({
    attemptDir: created.attemptDir, worktreeRoot: fixture.worktreeRoot, configPath: fixture.configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
  });
  const launches: string[] = [];
  const brokered: string[] = [];
  const commands: (readonly string[])[] = [];
  const done = await runProductionCommand({
    attemptDir: created.attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
    infrastructure: {
      adapterFor: (_entry: AdapterEntry, id: string) => new ReviewAdapter(id, () => prepared.worktree!, launches),
      createBroker: countingBroker(brokered, commands), runCommand: runSystemCommand, sandboxProbe,
    },
  });
  return { attemptDir: created.attemptDir, prepared, done, launches, brokered, commands };
}

test("a review replay starts at its pinned base, seeds one host commit, and is reviewed once on the arm's route", async () => {
  const fixture = world("prove-run");
  const { attemptDir, prepared, done, launches, brokered, commands } = await runReplay(fixture, "replay-probe", { reviewer: ARM_ROUTE });

  // The worktree starts at the item's base, not at the canonical HEAD that holds the corpus.
  assert.equal(prepared.baseSha, fixture.baseSha);
  assert.notEqual(git(fixture.canonical, "rev-parse", "HEAD"), fixture.baseSha);
  assert.deepEqual(prepared.replay, fixture.replay);

  assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail ?? done.lastActivity);
  // One host commit on the base, holding the patch's bytes and nothing else.
  const worktree = prepared.worktree!;
  assert.equal(git(worktree, "rev-list", "--count", `${fixture.baseSha}..HEAD`), "1");
  assert.equal(git(worktree, "rev-parse", "HEAD^"), fixture.baseSha);
  assert.equal(done.candidateSha, git(worktree, "rev-parse", "HEAD"));
  assert.equal(readFileSync(join(worktree, "README.md"), "utf8"), "base\nseeded\n");
  assert.equal(git(worktree, "log", "-1", "--format=%B"), REQUEST, "the seed commit's message is the request");
  assert.equal(git(worktree, "log", "-1", "--format=%an <%ae>"), "Santiago Marin <santiagomarinsuarez@me.com>");
  assert.equal(git(worktree, "ls-files", PROVING_GROUND_DIR), "", "the replay's tree holds no answer key");

  // One call: the review, on the arm's own route, through L11 and no other edge.
  assert.deepEqual(launches, ["review:claude:claude:opus:high"]);
  assert.deepEqual(brokered, ["edge L11"]);
  // The review ran confined to its worktree (task 18).
  assert.equal(commands.length, 1);
  assertConfinedLaunch(commands[0]!, fixture.canonical, fixture.stateRoot);
  assert.equal(done.budget.callsSpent, 1);
  assert.equal(done.budget.callsReserved, 0);
  assert.match(done.nextAction, /awsf cancel replay-probe/);
  assert.doesNotMatch(done.nextAction, /awsf land|awsf journey/);

  const evidence = await readAttemptEvidence(attemptDir);
  const reviewing = evidence.find((entry) => entry.type === "transition" && entry.to === "REVIEWING");
  assert.match(reviewing?.type === "transition" ? reviewing.reasonDetail ?? "" : "", /seeded anthropic review on the replay arm's route/);
  const seed = evidence.find((entry) => entry.type === "phase-accepted" && entry.accepted.phaseKey === "seed");
  assert.equal(seed?.type === "phase-accepted" ? seed.accepted.candidateSha : null, done.candidateSha,
    "the seed is accepted as the phase that produced the candidate");

  // A replay is measurement, never delivery.
  await assert.rejects(landCommand({ attemptDir, terminal }), (error: unknown) =>
    error instanceof ReplayNotDeliverable && /awsf land/.test(error.message) && /awsf cancel replay-probe/.test(error.message));
  await assert.rejects(journeyCommand({ attemptDir, terminal, journeyId: "w18-m4", observedSha: done.candidateSha! }), (error: unknown) =>
    error instanceof ReplayNotDeliverable && /awsf journey/.test(error.message));
  const after = await readAttempt(attemptDir);
  assert.equal(after.lifecycleState, "AWAITING_OWNER");
  assert.equal(after.revision, done.revision, "neither refusal wrote a record");
  assert.notEqual(git(fixture.canonical, "rev-parse", "HEAD"), done.candidateSha, "the canonical branch never moved");
});

test("seeded mode refuses a replay whose reviewer route is not the arm, before any call", async () => {
  const fixture = world("prove-run");
  const missing = await runReplay(fixture, "replay-unrouted", {});
  assert.equal(missing.done.lifecycleState, "BLOCKED");
  assert.match(missing.done.blocker?.detail ?? "", /^ReplayArmNotRouted: .*--route reviewer=claude\/anthropic\/claude:opus@high; the attempt records no route for it/);
  assert.deepEqual(missing.launches, []);
  assert.deepEqual(missing.brokered, []);
  assert.equal(missing.done.budget.callsSpent, 0);

  const partial = await runReplay(fixture, "replay-partial", { reviewer: { ...ARM_ROUTE, effort: "max" } });
  assert.equal(partial.done.lifecycleState, "BLOCKED");
  assert.match(partial.done.blocker?.detail ?? "", /ReplayArmNotRouted: .*differs in effort/);
  assert.equal(partial.done.budget.callsSpent, 0);
});

test("a replay on a host without bwrap blocks as ReplayConfinementUnavailable before any call", async () => {
  const fixture = world("prove-run");
  const refused = await runReplay(fixture, "replay-unconfined", { reviewer: ARM_ROUTE }, () => false);
  assert.equal(refused.done.lifecycleState, "BLOCKED");
  assert.equal(refused.done.blocker?.code, "phase-abort");
  assert.match(refused.done.blocker?.detail ?? "", /^ReplayConfinementUnavailable: replay phase "reviewer" cannot run confined to its worktree: .*needs the Linux bwrap sandbox/);
  assert.deepEqual(refused.launches, []);
  assert.deepEqual(refused.brokered, []);
  assert.equal(refused.done.budget.callsSpent, 0);
  assert.equal(refused.done.budget.callsReserved, 0);
  const evidence = await readAttemptEvidence(refused.attemptDir);
  assert.equal(evidence.some((entry) => entry.type === "phase-accepted"), false, "not even the host seed ran");
});

test("a prove task is created only with a replay record, and no other workflow carries one", async () => {
  const fixture = world("prove-run");
  const common = {
    stateRoot: fixture.stateRoot, project: fixture.config.project.slug, repository: fixture.canonical, request: REQUEST,
    configSnapshotJson: toConfigSnapshotJson(fixture.config),
  };
  await assert.rejects(newCommand({ ...common, taskId: "bare-prove", workflow: "prove", tier: 2 }), /requires a replay record, which only `awsf prove` creates/);
  await assert.rejects(newCommand({ ...common, taskId: "stray-replay", workflow: "build-review", tier: 2, replay: fixture.replay }), /cannot carry a replay record/);
  await assert.rejects(newCommand({ ...common, taskId: "bad-replay", workflow: "prove", tier: 2, replay: { ...fixture.replay, order: 0 } }), /invalid replay record/);
});
