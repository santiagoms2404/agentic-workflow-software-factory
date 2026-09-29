import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AdapterEntry } from "../../src/config/schema.ts";
import type { ReviewFinding } from "../../src/contracts/review-output.ts";
import { main } from "../../src/cli/main.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection, type DashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { metricsCommand } from "../../src/cli/commands/metrics.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { proveCommand } from "../../src/cli/commands/prove.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { runSystemCommand } from "../../src/execution/transport-broker.ts";
import { readRoleRows } from "../../src/metrics/role-rows.ts";
import { readReplayOutcomes, routeArmProtocol, routeArmReplays } from "../../src/metrics/route-arm-replays.ts";
import { scoreRouteArms, type RouteArmScore } from "../../src/metrics/route-arm-score.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { attemptDir as attemptDirectory } from "../../src/persistence/platform-paths.ts";
import { ReplayNotDeliverable } from "../../src/workflow/prove/compile.ts";
import { PROVING_GROUND_DIR, readProvingGroundCorpus } from "../../src/workflow/prove/corpus.ts";
import { countingBroker, git, ITEM_ID, REQUEST, ReviewAdapter, world, type World } from "../unit/_prove-replay.ts";

// W18 M4 task 14: one replay end to end, and replays never land. `awsf prove`
// (driven with a fake owner terminal until gate G18-B registers it) creates two
// replays of one synthetic item on two fixture arms. Each starts through the
// start command `awsf prove` printed, at the item's pinned base in a throwaway
// two-commit repository, so the base and the seed commit are real Git objects.
// The host seeds one commit, the arm reviews it once, the replay waits at
// AWAITING_OWNER, `awsf land` refuses it by name, and the owner cancels it
// through the cancel command `awsf prove` printed.
// Both rows are tagged proving ground, and the scorer's recall is read back
// from the projection a real runner wrote. No provider is called, and nothing
// reads the owner's state root.

const OPUS = "claude/anthropic/claude:opus@high";
const SOL = "codex/openai-codex/codex:gpt-6-sol@xhigh";
const REASON = "the journey's two fixture arms";
const EXTRACTED_AT = "2026-09-29T12:00:00.000Z";
const AWSF_INVOCATION = "npm run awsf -- ";

function finding(line: number | null, severity: ReviewFinding["severity"]): ReviewFinding {
  return {
    id: `readme-${String(line ?? "file")}`, severity, file: "README.md", line, title: "an unrequested second line",
    detail: "The candidate appends a line the request never asked for.",
    consequence: "Readers of README.md see a line that documents nothing.",
    evidence: "README.md line 2 adds `seeded` after the base line.",
  };
}

/** Opus locates the planted defect; Sol names only its file. */
const REPLAYS = [
  { taskId: "replay-opus", arm: OPUS, order: 1, launch: "review:claude:claude:opus:high", findings: [finding(2, "high")] },
  { taskId: "replay-sol", arm: SOL, order: 2, launch: "review:codex:codex:gpt-6-sol:xhigh", findings: [finding(null, "medium")] },
] as const;

/** The owner at a terminal, confirming everything asked and recording what was asked. */
function ownerTerminal(): OwnerTerminal & { readonly prompts: string[] } {
  const prompts: string[] = [];
  return { interactive: true, prompts, write: () => undefined, confirm: async (prompt) => { prompts.push(prompt); return true; } };
}

/** One projection writer per act, closed before the next opens: each CLI invocation opens its own. */
async function projected<T>(stateRoot: string, act: (projection: DashboardProjection) => Promise<T>): Promise<T> {
  const projection = createDashboardProjection(stateRoot);
  try {
    return await act(projection);
  } finally {
    projection.close();
  }
}

/** The real CLI, on the fixture's state root and config, with the owner's terminal where an act needs one. */
async function cli(fixture: World, printed: string, flags: readonly string[], terminal?: OwnerTerminal): Promise<{ code: number; out: string[]; err: string[] }> {
  assert.ok(printed.startsWith(AWSF_INVOCATION), printed);
  const argv = [...printed.slice(AWSF_INVOCATION.length).split(" "), ...flags, "--state-root", fixture.stateRoot, "--config", fixture.configPath];
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv, cwd: fixture.canonical, writeOut: (line) => out.push(line), writeError: (line) => err.push(line),
    ...(terminal === undefined ? {} : { terminal }),
  });
  return { code, out, err };
}

test("awsf prove creates a replay that runs from its pinned base to AWAITING_OWNER, never lands, is cancelled, and is scored", async () => {
  const fixture = world("prove-replay");
  const project = fixture.config.project.slug;
  const corpusSha = git(fixture.canonical, "rev-parse", "HEAD");
  try {
    // A throwaway repository of two commits: the base the item pins, then the corpus.
    assert.equal(git(fixture.canonical, "rev-list", "--count", "HEAD"), "2");
    assert.equal(git(fixture.canonical, "rev-parse", "HEAD^"), fixture.baseSha);

    for (const { taskId, arm, order, launch, findings } of REPLAYS) {
      // The owner's act: a DRAFT task with the replay record and the arm as its route, and nothing else.
      const owner = ownerTerminal();
      const created = await projected(fixture.stateRoot, (projection) => proveCommand({
        stateRoot: fixture.stateRoot, project, taskId, repository: fixture.canonical, itemId: ITEM_ID, arm,
        repetition: 1, order, reason: REASON, terminal: owner, config: fixture.config, projectRecord: projection.project,
      }));
      assert.equal(created.confirmed, true);
      assert.deepEqual(owner.prompts, [`Create replay ${taskId}: ${ITEM_ID} on ${arm}, repetition 1, place ${String(order)}?`]);
      assert.deepEqual(created.replay, { ...fixture.replay, arm, order });
      assert.equal(created.status?.lifecycleState, "DRAFT");
      assert.equal(created.status?.worktree, null);

      // Started through the command it printed, at the item's pinned base, not the canonical HEAD that holds the corpus.
      const started = await cli(fixture, created.commands!.start, ["--stub", "true", "--worktree-root", fixture.worktreeRoot]);
      assert.equal(started.code, 0, started.err.join("\n"));
      assert.deepEqual(started.err, [], "the projection took every record");
      assert.equal(started.out[0], `Prepared ${taskId} at ${fixture.baseSha}.`);
      const attemptDir = attemptDirectory(fixture.stateRoot, project, taskId, "1");
      const prepared = await readAttempt(attemptDir);
      assert.equal(prepared.lifecycleState, "PREPARED");
      assert.equal(prepared.baseSha, fixture.baseSha);
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), fixture.baseSha);

      // The seed and the fixture review, on the arm's own route.
      const launches: string[] = [];
      const brokered: string[] = [];
      const done = await projected(fixture.stateRoot, (projection) => runProductionCommand({
        attemptDir, stateRoot: fixture.stateRoot, config: fixture.config, configPath: fixture.configPath,
        projectRecord: projection.project, assertAdvancement: projection.assertAdvancement,
        assertLaunchProjection: projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ReviewAdapter(id, () => prepared.worktree!, launches, findings),
          createBroker: countingBroker(brokered), runCommand: runSystemCommand, sandboxProbe: () => false,
        },
      }));
      assert.equal(done.lifecycleState, "AWAITING_OWNER", done.blocker?.detail ?? done.lastActivity);
      assert.deepEqual(launches, [launch]);
      assert.deepEqual(brokered, ["edge L11"]);
      assert.equal(done.budget.callsSpent, 1);
      assert.equal(done.budget.callsReserved, 0);

      // The seed commit: one host commit on the pinned base, holding the patch and no answer key.
      const worktree = prepared.worktree!;
      assert.equal(git(worktree, "rev-list", "--count", `${fixture.baseSha}..HEAD`), "1");
      assert.equal(git(worktree, "rev-parse", "HEAD^"), fixture.baseSha);
      assert.equal(done.candidateSha, git(worktree, "rev-parse", "HEAD"));
      assert.equal(readFileSync(join(worktree, "README.md"), "utf8"), "base\nseeded\n");
      assert.equal(git(worktree, "log", "-1", "--format=%B"), REQUEST);
      assert.equal(git(worktree, "ls-files", PROVING_GROUND_DIR), "");
      const evidence = await readAttemptEvidence(attemptDir);
      const seed = evidence.find((entry) => entry.type === "phase-accepted" && entry.accepted.phaseKey === "seed");
      assert.equal(seed?.type === "phase-accepted" ? seed.accepted.candidateSha : null, done.candidateSha);

      // A replay is measurement, never delivery: land is refused by name, at a terminal and whatever the state.
      const refused = (error: unknown): boolean =>
        error instanceof ReplayNotDeliverable && /awsf land/.test(error.message) && error.message.includes(`awsf cancel ${taskId}`);
      await assert.rejects(landCommand({ attemptDir, terminal: owner }), refused);
      assert.equal((await readAttempt(attemptDir)).revision, done.revision, "the refusal wrote no record");
      assert.equal(owner.prompts.length, 1, "land asked nothing");

      // Cancelled through the command it printed, and land still refuses by name.
      const cancelled = await cli(fixture, created.commands!.cancel, [], owner);
      assert.equal(cancelled.code, 0, cancelled.err.join("\n"));
      assert.deepEqual(cancelled.out, ["CANCELLED: survivors []"]);
      assert.equal((await readAttempt(attemptDir)).lifecycleState, "CANCELLED");
      const land = `${AWSF_INVOCATION}land ${taskId} --project ${project}`;
      const after = await cli(fixture, land, [], owner);
      assert.equal(after.code, 1);
      assert.match(after.err.join("\n"), new RegExp(`^ReplayNotDeliverable: task ${taskId} is a proving-ground replay`, "u"));
      assert.equal(owner.prompts.length, 2, "cancel asked once, and land never");
      const settled = await readAttemptEvidence(attemptDir);
      assert.equal(settled.some((entry) => entry.type === "transition" && (entry.to === "LANDING" || entry.to === "LANDED")), false);
    }
    assert.equal(git(fixture.canonical, "rev-parse", "main"), corpusSha, "the canonical branch never moved");

    // Rows tagged proving ground, read from the projection the runner wrote.
    const dbPath = join(fixture.stateRoot, "awsf.db");
    const db = openDatabase(dbPath, { readonly: true });
    const { rows, outcomes } = (() => {
      try {
        return { rows: readRoleRows(db).sort((a, b) => a.taskId.localeCompare(b.taskId)), outcomes: readReplayOutcomes(db) };
      } finally {
        db.close();
      }
    })();
    assert.deepEqual(rows.map((row) => [row.taskId, row.role, row.source, row.itemId, row.arm, row.repetition, row.order, row.stateGroup]), [
      ["replay-opus", "reviewer", "proving-ground", ITEM_ID, OPUS, 1, 1, "CANCELLED"],
      ["replay-sol", "reviewer", "proving-ground", ITEM_ID, SOL, 1, 2, "CANCELLED"],
    ]);

    // The scorer's recall, read back. The observed model is the selector the
    // runner launched, as the projection recorded it (T13 C11): the scorer
    // compares it with the arm's selector, and the pair below is valid.
    const corpus = readProvingGroundCorpus(fixture.canonical);
    assert.deepEqual(corpus, [fixture.item]);
    const replays = routeArmReplays(rows, outcomes, corpus);
    const base = { itemId: ITEM_ID, repetition: 1, usageAuthority: "provider", envelopeValid: true, pausedAtCeiling: false } as const;
    assert.deepEqual(replays, [
      { ...base, arm: OPUS, order: 1, observed: { provider: "anthropic", model: "claude:opus" },
        outcome: { kind: "review", findings: [{ file: "README.md", line: 2 }] } },
      { ...base, arm: SOL, order: 2, observed: { provider: "openai-codex", model: "codex:gpt-6-sol" },
        outcome: { kind: "review", findings: [{ file: "README.md", line: null }] } },
    ]);
    const protocol = routeArmProtocol(replays, corpus);
    assert.deepEqual(protocol, { arms: [OPUS, SOL], repetitions: 1, items: [fixture.item] });
    const suite = scoreRouteArms(protocol!, replays);
    assert.equal(suite.complete, true);
    assert.deepEqual(suite.pairs.map((pair) => [pair.valid, pair.order, pair.reasons]), [[true, [OPUS, SOL], []]]);
    const [opus, sol] = suite.byScope[0]!.arms;
    const counts = (score: RouteArmScore | undefined) => {
      const { replays: n, located, fileOnly, falseAlarms, recall } = score!.review;
      return { n, located, fileOnly, falseAlarms, recall: recall.p, invalidPairs: score!.invalidPairs };
    };
    assert.deepEqual(counts(opus), { n: 1, located: 1, fileOnly: 0, falseAlarms: 0, recall: 1, invalidPairs: 0 });
    assert.deepEqual(counts(sol), { n: 1, located: 0, fileOnly: 1, falseAlarms: 0, recall: 0, invalidPairs: 0 });

    // And through the readout the owner runs: `awsf metrics --source proving-ground`.
    const lines = metricsCommand({ dbPath, extractedAt: EXTRACTED_AT, source: "proving-ground", repository: fixture.canonical });
    assert.ok(lines.includes("Route arms · 2 replay(s) in scope"), lines.join("\n"));
    assert.ok(lines.includes("2 arms · 1 repetition(s) · 1 item(s) · 1 of 1 pairs valid · complete"), lines.join("\n"));
    const heading = lines.indexOf(`${ITEM_ID} · review · reviewer · evidence-heavy-defect-review`);
    assert.ok(heading >= 0, lines.join("\n"));
    assert.deepEqual(lines.slice(heading + 2, heading + 4).map((line) => line.trim().split(/\s{2,}/u)), [
      [OPUS, "1", "1", "100% [21%–100%]", "0", "0", "0"],
      [SOL, "1", "0", "0% [0%–79%]", "1", "0", "0"],
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
