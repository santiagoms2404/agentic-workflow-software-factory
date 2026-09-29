// `awsf prove` — the owner act that creates one proving-ground replay (W18 task 13).
//
// Under test: it is the owner's (an interactive terminal and a written,
// credential-free reason, both before anything is read); it refuses an unknown
// item, an arm that does not reach the item's role, a repeated (item, arm,
// repetition) and a place already taken in its order, each by name and before
// the owner is asked; it creates a DRAFT task that `awsf start`'s binding
// accepts, prints the start and cancel commands, and spawns nothing. It is
// driven with a fake owner terminal because it is not registered in `main.ts`
// until gate G18-B.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import {
  ProveArmNotRouted,
  ProveCredentialRejected,
  ProveItemUnknown,
  ProveNotInteractive,
  ProveOrderTaken,
  ProvePlaceInvalid,
  ProveReasonRequired,
  ProveReplayRepeated,
  ProveTaskNamesDefect,
  proveCommand,
  type ProveCommandOptions,
} from "../../../src/cli/commands/prove.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { provingGroundItemDigest, type ReviewItem } from "../../../src/contracts/proving-ground.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { bindProveRecipe, PROVING_GROUND_DIR } from "../../../src/workflow/prove/bind.ts";
import { ProveItemInvalid } from "../../../src/workflow/prove/compile.ts";

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const ARM = "claude/anthropic/claude:opus@high";
const OTHER = "codex/openai-codex/codex:gpt-6-sol@xhigh";
const REASON = "the D3 suite's first reviewer arm";
const PATCH = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n base\n+seeded\n";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** The committed config, with `prove` enabled as gate G18-B will enable it. */
function enabledConfig(): AwsfConfig {
  return loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8").replace(/(\n {4}enabled: \[[^\]]*)\]/u, "$1, prove]"));
}

function item(id: string, baseSha: string, role = "reviewer"): ReviewItem {
  return {
    schema: "awsf.proving-ground-item/v1", id, kind: "review", taskClass: "evidence-heavy-defect-review", role, baseSha,
    request: "Report the probe's second line.",
    seed: { patch: `${PROVING_GROUND_DIR}/${id}.patch`, defectClass: "off-by-one", expected: [{ file: "README.md", lineStart: 2, lineEnd: 2 }] },
  };
}

/** A canonical checkout whose corpus postdates its base: probe-01 measures the reviewer, probe-02 names a role prove never routes. */
function world(label: string) {
  const root = mkdtempSync(join(tmpdir(), `awsf-prove-${label}-`));
  const canonical = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", canonical]);
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "base");
  const baseSha = git(canonical, "rev-parse", "HEAD");
  mkdirSync(join(canonical, PROVING_GROUND_DIR), { recursive: true });
  for (const probe of [item("probe-01", baseSha), item("probe-02", baseSha, "planner")]) {
    writeFileSync(join(canonical, PROVING_GROUND_DIR, `${probe.id}.json`), `${JSON.stringify(probe, null, 2)}\n`);
    writeFileSync(join(canonical, probe.seed.patch), PATCH);
  }
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "corpus");
  const config = enabledConfig();
  return {
    root, canonical, baseSha, config, project: config.project.slug, stateRoot: join(root, "state"),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

type World = ReturnType<typeof world>;

interface FakeTerminal extends OwnerTerminal {
  readonly lines: string[];
  readonly prompts: string[];
}

function terminal(answer: boolean | (() => Promise<boolean>), interactive = true): FakeTerminal {
  const lines: string[] = [];
  const prompts: string[] = [];
  return {
    interactive, lines, prompts,
    write: (line) => { lines.push(line); },
    confirm: async (prompt) => {
      prompts.push(prompt);
      return typeof answer === "boolean" ? answer : answer();
    },
  };
}

function options(w: World, overrides: Partial<ProveCommandOptions> = {}): ProveCommandOptions {
  return {
    stateRoot: w.stateRoot, project: w.project, taskId: "replay-a", repository: w.canonical, itemId: "probe-01", arm: ARM,
    repetition: 1, reason: REASON, terminal: terminal(true), config: w.config, ...overrides,
  };
}

function written(w: World, taskId: string): boolean {
  return existsSync(join(w.stateRoot, "projects", w.project, "tasks", taskId));
}

test("awsf prove is the owner's: a non-interactive terminal is refused before anything is read", async () => {
  const w = world("medium");
  try {
    const piped = terminal(true, false);
    // An unknown item would be refused too; the medium is refused first.
    await assert.rejects(proveCommand(options(w, { terminal: piped, itemId: "no-such-item" })), ProveNotInteractive);
    assert.deepEqual(piped.prompts, []);
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("the reason is required and never credential-shaped, and --rep and --order are positive integers", async () => {
  const w = world("reason");
  try {
    await assert.rejects(proveCommand(options(w, { reason: "   " })), ProveReasonRequired);
    await assert.rejects(proveCommand(options(w, { reason: `measuring ghp_${"a".repeat(36)}` })), ProveCredentialRejected);
    for (const place of [{ repetition: 0 }, { repetition: 1.5 }, { order: 0 }, { order: -2 }]) {
      await assert.rejects(proveCommand(options(w, place)), ProvePlaceInvalid, JSON.stringify(place));
    }
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("prove is refused until the config enables it, as gate G18-B will", async () => {
  const w = world("disabled");
  try {
    const committed = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    await assert.rejects(proveCommand(options(w, { config: committed })), /workflow "prove" is not enabled/);
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("an unknown item is refused by name, and so is an id that is a path", async () => {
  const w = world("item");
  try {
    await assert.rejects(proveCommand(options(w, { itemId: "probe-09" })), (error: unknown) =>
      error instanceof ProveItemUnknown && /known items: probe-01, probe-02/.test(error.message));
    await assert.rejects(proveCommand(options(w, { itemId: "../probe-01" })), ProveItemUnknown);
    await assert.rejects(proveCommand(options(w, { repository: w.root })), /this checkout holds no proving-ground item/);
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("an item that fails its schema, or names a gate the config lacks, is refused by name", async () => {
  const w = world("invalid");
  try {
    const dir = join(w.canonical, PROVING_GROUND_DIR);
    writeFileSync(join(dir, "probe-03.json"), JSON.stringify({ ...item("probe-03", w.baseSha), seed: undefined }));
    writeFileSync(join(dir, "probe-04.json"), JSON.stringify({
      schema: "awsf.proving-ground-item/v1", id: "probe-04", kind: "build", taskClass: "bounded-build", role: "builder",
      baseSha: w.baseSha, request: "Make the probe pass.", gates: ["benchmark"], acceptance: ["the probe passes"],
    }));
    writeFileSync(join(dir, "probe-05.json"), JSON.stringify(item("probe-01", w.baseSha)));
    for (const [itemId, detail] of [
      ["probe-03", /probe-03\.json: invalid awsf\.proving-ground-item\/v1 item/],
      ["probe-04", /names gate\(s\) the config does not declare: benchmark/],
      ["probe-05", /probe-05\.json holds item probe-01/],
    ] as const) {
      const owner = terminal(true);
      await assert.rejects(proveCommand(options(w, { itemId, arm: itemId === "probe-04" ? OTHER : ARM, terminal: owner })), (error: unknown) =>
        error instanceof ProveItemInvalid && detail.test(error.message), itemId);
      assert.deepEqual(owner.prompts, []);
    }
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("an arm that does not reach the item's role is refused before the owner is asked", async () => {
  const w = world("arm");
  try {
    const refusals: ReadonlyArray<readonly [Partial<ProveCommandOptions>, RegExp]> = [
      [{ arm: "claude/anthropic/claude:opus" }, /expected <adapter>\/<provider>\/<model>@<effort>/],
      [{ arm: "claude:opus@high" }, /names its adapter, provider and model/],
      [{ arm: "claude/anthropic/claude:opus@turbo" }, /no effort level named "turbo"/],
      [{ arm: "nosuch/anthropic/opus@high" }, /adapter "nosuch" is disabled or undeclared/],
      [{ arm: "antigravity/google/gemini@high" }, /adapter "antigravity" is disabled or undeclared/],
      [{ itemId: "probe-02" }, /"planner", which workflow "prove" never routes/],
    ];
    for (const [overrides, detail] of refusals) {
      const owner = terminal(true);
      await assert.rejects(proveCommand(options(w, { ...overrides, terminal: owner })), (error: unknown) =>
        error instanceof ProveArmNotRouted && detail.test(error.message), JSON.stringify(overrides));
      assert.deepEqual(owner.prompts, [], "refused before the owner is asked");
    }
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("a task id that names a seeded defect class is refused: it reaches the candidate refs a reviewer's worktree shares", async () => {
  const w = world("taskid");
  try {
    await assert.rejects(proveCommand(options(w, { taskId: "replay-Off-By-One-1" })), ProveTaskNamesDefect);
    assert.equal(written(w, "replay-Off-By-One-1"), false);
  } finally { w.close(); }
});

test("a declined replay writes nothing", async () => {
  const w = world("declined");
  try {
    const owner = terminal(false);
    const result = await proveCommand(options(w, { terminal: owner }));
    assert.deepEqual(result, { confirmed: false, status: null, replay: null, commands: null });
    assert.equal(owner.prompts.length, 1);
    assert.equal(written(w, "replay-a"), false);
  } finally { w.close(); }
});

test("a confirmed replay is a DRAFT task carrying its record and its arm's route, and it spawns nothing", async () => {
  const w = world("created");
  const projection = createDashboardProjection(w.stateRoot);
  try {
    const owner = terminal(true);
    const result = await proveCommand(options(w, { terminal: owner, projectRecord: projection.project }));
    assert.equal(result.confirmed, true);
    const status = result.status!;
    const probe = item("probe-01", w.baseSha);
    const replay = {
      itemId: "probe-01", itemDigest: provingGroundItemDigest(probe, new Uint8Array(Buffer.from(PATCH))), arm: ARM,
      repetition: 1, order: 1, baseSha: w.baseSha,
    };
    assert.deepEqual(result.replay, replay);
    assert.deepEqual(status.replay, replay);
    assert.equal(status.workflow, "prove");
    assert.equal(status.tier, 2, "a review item is a T2 replay");
    assert.equal(status.request, probe.request, "the item's own words, or bind refuses it at start");
    assert.deepEqual(status.routeOverrides, { reviewer: { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "high" } });
    assert.equal(status.lifecycleState, "DRAFT");
    assert.equal(status.worktree, null);
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.lastActivity, `owner created this proving-ground replay: ${REASON}`);
    assert.deepEqual(await readAttempt(join(w.stateRoot, "projects", w.project, "tasks", "replay-a", "1")), status);

    // The owner saw what they confirmed, and is handed the two commands that follow.
    assert.match(owner.prompts[0]!, /^Create replay replay-a: probe-01 on claude\/anthropic\/claude:opus@high, repetition 1, place 1\?$/);
    assert.ok(owner.lines.includes(`Reason on record: ${REASON}`), owner.lines.join("\n"));
    assert.ok(owner.lines.includes(`Arm: ${ARM}, recorded as --route reviewer=${ARM}`), owner.lines.join("\n"));
    const commands = {
      start: `npm run awsf -- start replay-a --project ${w.project}`,
      cancel: `npm run awsf -- cancel replay-a --project ${w.project}`,
    };
    assert.deepEqual(result.commands, commands);
    assert.ok(owner.lines.includes(`Start it: ${commands.start}`), owner.lines.join("\n"));
    assert.ok(owner.lines.includes(`Cancel it once its evidence is read: ${commands.cancel}`), owner.lines.join("\n"));

    // `awsf start`'s binding accepts the task as created.
    const recipe = await bindProveRecipe(status, { prompts: { builder: "", reviewer: "" }, gates: Object.keys(w.config.gates) });
    assert.equal(recipe.itemId, "probe-01");
    assert.equal(recipe.armPhaseId, "reviewer");

    // The projector wrote the replay record once, as a session-level event.
    const db = openDatabase(join(w.stateRoot, "awsf.db"), { readonly: true });
    try {
      const rows = db.prepare("SELECT session_id, phase_id, payload_json FROM events WHERE type = 'replay'").all() as
        Array<{ session_id: string; phase_id: string | null; payload_json: string }>;
      assert.deepEqual(rows.map((row) => [row.session_id, row.phase_id, JSON.parse(row.payload_json)]), [[status.sessionId, null, replay]]);
    } finally {
      db.close();
    }
  } finally {
    projection.close();
    w.close();
  }

  // Neither the command nor the corpus reader imports a module that starts a run or a process.
  for (const file of ["core/src/cli/commands/prove.ts", "core/src/workflow/prove/corpus.ts"]) {
    const imports = [...readFileSync(resolve(file), "utf8").matchAll(/from "([^"]+)"/gu)].map((match) => match[1]!);
    for (const banned of ["child_process", "transport-broker", "git/", "start.ts", "run.ts", "production-run.ts", "prove/bind.ts"]) {
      assert.equal(imports.some((path) => path.includes(banned)), false, `${file} imports ${banned}`);
    }
  }
});

test("a repeated (item, arm, repetition) is refused however the arm is spelled, and a task id is used once", async () => {
  const w = world("repeat");
  try {
    await proveCommand(options(w));
    for (const arm of [ARM, "claude/anthropic/opus@high"]) {
      const owner = terminal(true);
      await assert.rejects(proveCommand(options(w, { taskId: "replay-b", arm, terminal: owner })), (error: unknown) =>
        error instanceof ProveReplayRepeated && error.heldBy === "replay-a" && /awsf retry replay-a/.test(error.message), arm);
      assert.deepEqual(owner.prompts, []);
    }
    assert.equal(written(w, "replay-b"), false);
    await assert.rejects(proveCommand(options(w, { repetition: 2 })), /replay-a already has attempt 1; a replay is a new task/);
    const next = await proveCommand(options(w, { taskId: "replay-b", repetition: 2 }));
    assert.equal(next.status?.replay?.repetition, 2);
  } finally { w.close(); }
});

test("each place in a repetition's order belongs to one arm, and an omitted order is drawn from the free places", async () => {
  const w = world("order");
  try {
    const offered: number[][] = [];
    const last = (free: readonly number[]): number => { offered.push([...free]); return free[free.length - 1]!; };
    const place = async (taskId: string, arm: string, repetition: number, order?: number): Promise<number> =>
      (await proveCommand(options(w, { taskId, arm, repetition, draw: last, ...(order === undefined ? {} : { order }) }))).status!.replay!.order;

    assert.equal(await place("r1-a", ARM, 1), 1);
    await assert.rejects(proveCommand(options(w, { taskId: "r1-b", arm: OTHER, order: 1 })), (error: unknown) =>
      error instanceof ProveOrderTaken && error.heldBy === "r1-a");
    assert.equal(await place("r1-b", OTHER, 1), 2);
    // Two arms are known now, and repetition 2 has taken no place.
    assert.equal(await place("r2-a", ARM, 2), 2);
    assert.equal(await place("r2-b", OTHER, 2), 1);
    assert.deepEqual(offered, [[1], [2], [1, 2], [1]]);

    // A place taken by another terminal while the owner was reading is refused after the confirm, and nothing is written.
    const sonnet = "claude/anthropic/claude:sonnet@high";
    const racing = terminal(async () => {
      await proveCommand(options(w, { taskId: "r1-d", arm: "codex/openai-codex/codex:gpt-6-sol@high", order: 3 }));
      return true;
    });
    await assert.rejects(proveCommand(options(w, { taskId: "r1-c", arm: sonnet, order: 3, terminal: racing })), (error: unknown) =>
      error instanceof ProveOrderTaken && error.heldBy === "r1-d");
    assert.equal(written(w, "r1-c"), false);
    assert.equal(written(w, "r1-d"), true);
  } finally { w.close(); }
});
