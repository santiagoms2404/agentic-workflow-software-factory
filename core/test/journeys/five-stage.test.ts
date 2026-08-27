// The five-stage ladder, walked end to end in one temporary directory.
//
// AC-6's journey: a throwaway project travels init -> project-register ->
// design-to-plan -> build -> publish on the stub route, with no provider
// contacted and no network touched. Every arrow between two stages is an owner
// act this file performs explicitly. Nothing here advances by itself, which is
// the same claim `core/test/unit/stages/stops.test.ts` proves one boundary at a
// time and this file exercises across the whole ladder.
//
// Q5's ABSENCE DOES NOT APPLY. All five captured stages are reachable, so all
// five travel and none of them is [f]. The block that does exist is narrower
// and belongs to T18: under `W05-HOST-COMMAND-ENVELOPES`, stages 1, 2 and 5
// store no typed envelope, because their captured command results fit none of
// the thirteen registered schema ids (the plan's T04 amendment request records
// the three ids W05 would have to add). This file therefore joins each stage to
// its captured fixture by the facts the stage actually produces; the stored
// envelope join at every boundary is T18's row and stays [f] until W05 lands.
//
// THE HARNESS IS NOT A NEW ONE. It is the offline world of
// `core/test/unit/cli/design-to-plan-route.test.ts`, factored into
// `_offline-route.ts` and extended here with the bootstrap: this journey begins
// from an empty directory through W03's `initCommand` rather than from a
// repository that already exists. Publication's remote is a bare repository
// created inside the same temporary directory, following
// `core/test/journeys/publish.test.ts` and its `bareFixture` helper.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";

import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { initCommand } from "../../src/cli/commands/init.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { registerProject } from "../../src/cli/commands/project.ts";
import { publishCommand } from "../../src/cli/commands/publish.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { EnvelopeBase } from "../../src/contracts/envelope-base.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { GitResult } from "../../src/git/changes.ts";
import { phasesForSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { defaultWorktreeRoot } from "../../src/persistence/platform-paths.ts";
import { STAGE_ORDER, type StageId } from "../../src/stages/contract.ts";
import {
  CannedStubAdapter,
  RouteLog,
  design,
  fakeBroker,
  fixtureConfig,
  git,
  installPrompts,
  plan,
  prepareTask,
  review,
} from "../unit/cli/_offline-route.ts";

const SLUG = "five-stage-journey";
const REPOSITORY_ID = "canonical";
const PLAN_STEM = "five-stage-plan";
const BUILD_TASK = "five-stage-build";
const BUILT_FILE = "core/src/generated.ts";
const BRANCH = "published";
const ROLES = ["designer", "architecture-reviewer", "planner", "builder"] as const;
const PLAN_REQUEST = "Make design claims traceable into rendered tickets.";
const BUILD_REQUEST = "Write one bounded source file the host can gate.";

/** No inherited Git configuration reaches the publication remote. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process["env"],
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function isolatedGit(repository: string): (argv: readonly string[]) => GitResult {
  return (argv) => {
    const result = spawnSync("git", ["-C", repository, ...argv], { encoding: "utf8", env: GIT_ENV });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message ?? null,
    };
  };
}

function commit(repository: string, message: string, ...paths: string[]): string {
  git(repository, "add", ...paths);
  git(
    repository,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", message,
  );
  return git(repository, "rev-parse", "HEAD");
}

function remoteSha(bare: string, branch: string): string | null {
  const output = execFileSync("git", ["ls-remote", bare, `refs/heads/${branch}`], { encoding: "utf8", env: GIT_ENV });
  return /^([0-9a-f]{40})\s/u.exec(output)?.[1] ?? null;
}

/** Every configured URL is an absolute local path beneath this journey's root. */
function assertRemotesStayUnder(root: string, repository: string): void {
  const names = git(repository, "remote").split("\n").filter(Boolean);
  const urls = names.flatMap((name) => git(repository, "remote", "get-url", "--all", name).split("\n").filter(Boolean));
  assert.deepEqual(names, ["origin"]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(isAbsolute(url), true, `${url} is not a local absolute path`);
    assert.equal(relative(root, url).startsWith(".."), false, `${url} escapes ${root}`);
  }
}

function catalog(defaultBranch: string): string {
  return [
    "version: awsf.project/v1",
    "",
    "project:",
    `  slug: ${SLUG}`,
    "",
    "repositories:",
    `  ${REPOSITORY_ID}:`,
    "    role: plan",
    `    default_branch: ${defaultBranch}`,
    "    gates: {}",
    "    publish:",
    "      remotes: [origin]",
    `      branches: [${BRANCH}]`,
    "",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
    `  default: ${PLAN_STEM}`,
    "",
  ].join("\n");
}

function buildPlan(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "Write one bounded source.",
    artifacts: [],
    notesForNextPhase: `Write ${BUILT_FILE}.`,
    goals: ["Write one source file."],
    nonGoals: ["Touch anything else."],
    implementationSteps: [{
      id: "one",
      title: "Write the source file",
      files: [BUILT_FILE],
      acceptanceCriteria: ["The host records the candidate."],
    }],
    testStrategy: ["Run the configured host commands."],
    risks: [],
    openQuestions: [],
  };
}

function buildOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "Wrote one bounded source.",
    artifacts: [{ path: BUILT_FILE, kind: "source", description: "Bounded source." }],
    notesForNextPhase: "Run host gates.",
    changedFiles: [BUILT_FILE],
    implementationNotes: ["Scripted fixture implementation."],
    commandsRun: [],
    proposedCommitMessage: "feat: add generated source",
  };
}

function terminal(lines: string[]): OwnerTerminal {
  return {
    interactive: true,
    write: (line) => { lines.push(line); },
    confirm: async () => true,
  };
}

/** Applies a scripted build envelope's claimed diff, so the host has one to capture. */
function applyBuild(worktree: string): (response: EnvelopeBase) => void {
  return (response) => {
    if (response.schema !== "awsf.build-output/v1") return;
    for (const path of (response as BuildOutput).changedFiles) {
      const target = join(worktree, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "export const generated = true;\n");
    }
  };
}

test("a throwaway project travels all five captured stages on the stub route without a provider or a network", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-five-stage-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  const worktreeRoot = defaultWorktreeRoot(stateRoot);
  const bare = join(root, "remote.git");
  const sideEffect = join(root, "provider-process-ran.json");
  const log = new RouteLog();
  const travelled: StageId[] = [];
  const lines: string[] = [];
  let projection: ReturnType<typeof createDashboardProjection> | null = null;

  try {
    // ---- Stage 1 · init ---------------------------------------------------
    // The journey starts with no repository at all: `canonical` does not exist.
    assert.equal(existsSync(canonical), false);
    const initialized = await initCommand({ path: canonical, slug: SLUG });
    travelled.push("init");

    assert.equal(initialized.path, canonical);
    assert.match(initialized.commitSha, /^[0-9a-f]{40}$/u);
    assert.deepEqual(
      git(canonical, "show", "--name-only", "--pretty=format:", initialized.commitSha).split("\n").filter(Boolean),
      ["awsf.config.yaml"],
      "S1 commits its minimal configuration and nothing else",
    );
    // S1's captured observation: no state root, so no session and no attempt.
    assert.equal(existsSync(stateRoot), false);
    const defaultBranch = git(canonical, "rev-parse", "--abbrev-ref", "HEAD");

    // The publication remote is a bare repository inside this temporary
    // directory. It is the only remote this journey ever knows.
    execFileSync("git", ["init", "--bare", bare], { stdio: "ignore", env: GIT_ENV });
    git(canonical, "remote", "add", "origin", bare);
    assertRemotesStayUnder(root, canonical);

    // ---- Boundary S1 -> S2 · owner act ------------------------------------
    // `awsf init` writes no catalog. The owner authors and commits one.
    writeFileSync(join(canonical, "awsf.project.yaml"), catalog(defaultBranch));
    commit(canonical, "chore: declare the project catalog", "awsf.project.yaml");

    // ---- Stage 2 · project register ---------------------------------------
    const registered = await registerProject({
      stateRoot,
      catalogPath: join(canonical, "awsf.project.yaml"),
      repositories: [`${REPOSITORY_ID}=${canonical}`],
    });
    travelled.push("project-register");

    assert.equal(registered.resolvedProject.slug, SLUG);
    assert.equal(registered.resolvedProject.repositories[REPOSITORY_ID]?.path, canonical);
    assert.equal(registered.resolvedProject.repositories[REPOSITORY_ID]?.worktreeRoot, worktreeRoot);
    assert.equal(existsSync(join(stateRoot, "projects", SLUG, "placement.yaml")), true);
    // S2's captured observation: a placement and nothing else under the state root.
    assert.deepEqual(readdirSync(stateRoot), ["projects"]);

    // ---- Boundary S2 -> S3 · owner act ------------------------------------
    // The configuration `awsf init` wrote enables only `intake` and declares no
    // agent. The owner replaces it and supplies the role prompts.
    const config = fixtureConfig({ slug: SLUG, roles: ROLES });
    const configPath = join(canonical, "awsf.config.yaml");
    writeFileSync(configPath, stringify(config));
    installPrompts(canonical, ROLES);
    commit(canonical, "chore: configure the stub route and its prompts", "awsf.config.yaml", "prompts");

    projection = createDashboardProjection(stateRoot);
    const configSnapshotJson = toConfigSnapshotJson(config);

    // ---- Stage 3 · design-to-plan -----------------------------------------
    const planTask = await prepareTask({
      stateRoot,
      project: SLUG,
      taskId: PLAN_STEM,
      repository: canonical,
      request: PLAN_REQUEST,
      workflow: "design-to-plan",
      tier: 1,
      worktreeRoot,
      configPath,
      configSnapshotJson,
      projectRecord: projection.project,
    });
    const planAdapter = new CannedStubAdapter({
      sideEffectPath: sideEffect,
      responses: [design(), review(false), plan()],
      log,
    });
    const planned = await runProductionCommand({
      attemptDir: planTask.attemptDir,
      stateRoot,
      config,
      configPath,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => planAdapter,
        createBroker: fakeBroker,
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline journey"); },
        sandboxProbe: () => false,
      },
    });
    travelled.push("design-to-plan");

    assert.equal(planned.lifecycleState, "AWAITING_OWNER", planned.blocker?.detail);
    assert.equal(planned.budget.callsSpent, 3);
    assert.equal(planned.budget.callsReserved, 0);
    assert.equal(planAdapter.responsesRemaining, 0);
    for (const document of [
      join("specs", `${PLAN_STEM}.html`),
      join("specs", `${PLAN_STEM}-build-prompts.md`),
      join("specs", "tickets", PLAN_STEM, "T01.md"),
    ]) {
      assert.equal(existsSync(join(planTask.worktree, document)), true, `${document} was not rendered`);
    }

    // ---- Boundary S3 -> S4 · owner act ------------------------------------
    const landedPlan = await landCommand({
      attemptDir: planTask.attemptDir,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
    });
    assert.equal(landedPlan.status.lifecycleState, "LANDED");
    assert.equal(git(canonical, "rev-parse", "HEAD"), planned.candidateSha);
    assert.equal(
      existsSync(join(canonical, "specs", `${PLAN_STEM}.html`)),
      true,
      "S4's entry precondition: the rendered plan set is on the default branch",
    );

    // ---- Stage 4 · build ---------------------------------------------------
    const buildTask = await prepareTask({
      stateRoot,
      project: SLUG,
      taskId: BUILD_TASK,
      repository: canonical,
      request: BUILD_REQUEST,
      workflow: "plan-build-test",
      tier: 1,
      worktreeRoot,
      configPath,
      configSnapshotJson,
      projectRecord: projection.project,
    });
    const buildAdapter = new CannedStubAdapter({
      sideEffectPath: sideEffect,
      responses: [buildPlan(), buildOutput()],
      log,
      onResponse: applyBuild(buildTask.worktree),
    });
    const built = await runProductionCommand({
      attemptDir: buildTask.attemptDir,
      stateRoot,
      config,
      configPath,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => buildAdapter,
        createBroker: fakeBroker,
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline journey"); },
        sandboxProbe: () => false,
      },
    });
    travelled.push("build");

    assert.equal(built.lifecycleState, "AWAITING_OWNER", built.blocker?.detail);
    assert.equal(built.budget.callsSpent, 2);
    assert.equal(built.budget.callsReserved, 0);
    assert.equal(buildAdapter.responsesRemaining, 0);
    assert.equal(existsSync(join(buildTask.worktree, BUILT_FILE)), true);

    // ---- Boundary S4 -> S5 · owner act ------------------------------------
    const landedBuild = await landCommand({
      attemptDir: buildTask.attemptDir,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
    });
    assert.equal(landedBuild.status.lifecycleState, "LANDED");
    assert.equal(git(canonical, "rev-parse", "HEAD"), built.candidateSha);
    assert.equal(git(canonical, "status", "--porcelain"), "", "S5's entry precondition: a clean checkout at the candidate");

    // ---- Stage 5 · publish -------------------------------------------------
    assert.equal(remoteSha(bare, BRANCH), null);
    const published = await publishCommand({
      attemptDir: buildTask.attemptDir,
      stateRoot,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      gitRunner: isolatedGit(canonical),
    });
    travelled.push("publish");

    assert.equal(published.outcome, "published", JSON.stringify(published));
    if (published.outcome !== "published") throw new Error("the ladder did not reach publication");
    assert.equal(published.status.lifecycleState, "PUBLISHED");
    assert.equal(remoteSha(bare, BRANCH), built.candidateSha);
    assert.equal((await readAttempt(buildTask.attemptDir)).lifecycleState, "PUBLISHED");
    assert.ok(lines.includes(`Revision: ${built.candidateSha!}`));
    assert.ok(lines.includes("Remote: origin"));
    assert.ok(lines.includes(`Branch: ${BRANCH}`));

    // ---- The ladder, and what it cost --------------------------------------
    assert.deepEqual(travelled, [...STAGE_ORDER], "every captured stage travelled, in the captured order");
    // The route log, not a count: every contact this journey made was the stub. The number of
    // scripted calls is already pinned by each adapter's `responsesRemaining`, so this row asserts
    // the set of providers contacted, which is what "no launch beyond the stub" actually means.
    assert.ok(log.providers.length > 0, "the route log recorded no contact at all");
    assert.deepEqual([...new Set(log.providers)], ["stub"], "no provider beyond the scripted stub was contacted");
    assert.deepEqual(log.launches, log.providers, "no launch happened that the route did not record");
    assert.equal(existsSync(sideEffect), false, "the fixture provider process must never run");
    assertRemotesStayUnder(root, canonical);

    const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.deepEqual(phasesForSession(db, planTask.sessionId).map((phase) => [phase.phase_key, phase.status]), [
        ["request", "SUCCEEDED"],
        ["design-context", "SUCCEEDED"],
        ["design", "SUCCEEDED"],
        ["architecture-review", "SUCCEEDED"],
        ["plan-context", "SUCCEEDED"],
        ["plan", "SUCCEEDED"],
        ["plan-render", "SUCCEEDED"],
      ]);
      assert.deepEqual(phasesForSession(db, buildTask.sessionId).map((phase) => [phase.phase_key, phase.status]), [
        ["request", "SUCCEEDED"],
        ["planner", "SUCCEEDED"],
        ["builder", "SUCCEEDED"],
        ["tests", "SUCCEEDED"],
      ]);
    } finally {
      db.close();
    }
  } finally {
    projection?.close();
    rmSync(root, { recursive: true, force: true });
  }
  // No residue: the whole journey lived under one temporary directory.
  assert.equal(existsSync(root), false);
});
