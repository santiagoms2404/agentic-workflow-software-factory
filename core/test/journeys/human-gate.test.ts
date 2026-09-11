import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ActorNotPermitted, InteractiveOwnerRequired } from "../../src/state/errors.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptStatus,
} from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { main } from "../../src/cli/main.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const PROJECT = "agentic-workflow-software-factory";
const TASK = "T21-fixture";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function makeCandidate(root: string): { repository: string; base: string; candidate: string } {
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, "README.md"), "base\n");
  git(repository, "add", "README.md");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed owner gate");
  const base = git(repository, "rev-parse", "HEAD");
  git(repository, "checkout", "-b", "candidate");
  writeFileSync(join(repository, "README.md"), "candidate\n");
  git(repository, "add", "README.md");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "feat: exact landing candidate");
  const candidate = git(repository, "rev-parse", "HEAD");
  git(repository, "checkout", "main");
  return { repository, base, candidate };
}

function awaiting(repository: string, candidate: string): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "owner-gate-session",
    project: PROJECT,
    taskId: TASK,
    continuesTask: null,
    attempt: 1,
    repository,
    worktree: join(repository, "candidate-worktree"),
    workflow: "build-review",
    tier: 2,
    request: "land the exact tested candidate",
    configSnapshotJson: "{}",
    lifecycleState: "AWAITING_OWNER",
    baseSha: git(repository, "rev-parse", "HEAD"),
    candidateSha: candidate,
    phase: { name: "reviewer", state: "SUCCEEDED", round: 1, maximumRounds: 1 },
    budget: {
      attempt: 1,
      callsSpent: 2,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 },
      ceiling: 5,
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: { resolved: "stub/review", provenance: "stream-authoritative" },
    lastActivityAt: "2026-08-07T00:00:00.000Z",
    lastActivity: "gates and opposite-provider review passed",
    nextAction: `run \`awsf land ${TASK}\``,
    gatesPass: true,
    requiredReviewPresent: true,
    journeyApproved: true,
    protectedApprovalsValid: true,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
  };
}

function terminal(interactive: boolean, answer: boolean, lines: string[] = []): OwnerTerminal {
  return {
    interactive,
    write: (line) => { lines.push(line); },
    confirm: async () => answer,
  };
}

async function seed(
  root: string,
  observability: "healthy" | "degraded" = "healthy",
): Promise<{ attemptDir: string; repository: string; base: string; candidate: string }> {
  const fixture = makeCandidate(root);
  const stateRoot = join(root, "state");
  const attemptDir = join(stateRoot, "projects", PROJECT, "tasks", TASK, "1");
  const projection = createDashboardProjection(stateRoot);
  const initial = awaiting(fixture.repository, fixture.candidate);
  await persistAttempt(
    attemptDir,
    null,
    { kind: "attempt.created", next: initial },
    projection.project,
  );
  if (observability === "degraded") {
    // Reproduce a real projection lifecycle gap: revision 2 is durable in the
    // journal/status but not projected, so revision 3 cannot be projected
    // contiguously and the writer marks this session degraded without throwing.
    const skipped = nextRevision(initial, {
      lastActivity: "durable fixture update intentionally skipped by projection",
    });
    await persistAttempt(attemptDir, initial.revision, { kind: "attempt.updated", next: skipped });
    const failed = nextRevision(skipped, {
      lastActivity: "projection receives a non-contiguous source sequence",
    });
    await persistAttempt(
      attemptDir,
      skipped.revision,
      { kind: "attempt.updated", next: failed },
      projection.project,
    );
  }
  projection.close();
  return { attemptDir, ...fixture };
}

for (const actor of ["host", "owner"] as const) {
  test(`landing throws ActorNotPermitted for the ${actor} actor`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-human-actor-"));
    try {
      const fixture = await seed(root);
      await assert.rejects(
        landCommand({ attemptDir: fixture.attemptDir, terminal: terminal(false, false), actor }),
        ActorNotPermitted,
      );
      assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "AWAITING_OWNER");
      assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.base);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("the owner command refuses piped stdin before confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-human-pipe-"));
  try {
    const fixture = await seed(root);
    let prompts = 0;
    await assert.rejects(
      landCommand({
        attemptDir: fixture.attemptDir,
        terminal: { interactive: false, write: () => {}, confirm: async () => { prompts += 1; return true; } },
      }),
      InteractiveOwnerRequired,
    );
    assert.equal(prompts, 0);
    assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "AWAITING_OWNER");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real process.stdin pipe is refused even when it contains yes", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-human-real-pipe-"));
  try {
    const fixture = await seed(root);
    const child = spawnSync(process.execPath, [
      "--experimental-strip-types",
      resolve("core/src/cli/main.ts"),
      "land",
      TASK,
      "--state-root",
      join(root, "state"),
      "--config",
      resolve("awsf.config.yaml"),
    ], {
      cwd: fixture.repository,
      input: "yes\n",
      encoding: "utf8",
      // A cold WSL2 strip-types + SQLite startup can exceed 20 s under the
      // full parallel suite; this is a refusal proof, not a startup benchmark.
      timeout: 60_000,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /InteractiveOwnerRequired/);
    assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "AWAITING_OWNER");
    assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the actual CLI path shows the exact SHA, persists LANDING, fast-forwards, and verifies LANDED", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-human-cli-"));
  try {
    const fixture = await seed(root);
    const lines: string[] = [];
    const configPath = resolve("awsf.config.yaml");
    const code = await main({
      argv: ["land", TASK, "--state-root", join(root, "state"), "--config", configPath],
      cwd: fixture.repository,
      terminal: terminal(true, true, lines),
      writeOut: (line) => { lines.push(line); },
      writeError: (line) => { lines.push(`ERR ${line}`); },
    });
    assert.equal(code, 0, lines.join("\n"));
    assert.ok(lines.includes(`Candidate SHA: ${fixture.candidate}`));
    assert.ok(lines.some((line) => line.includes("feat: exact landing candidate")));
    assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.candidate);
    assert.equal(git(fixture.repository, "status", "--porcelain"), "");
    assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "LANDED");

    const summary = readFileSync(join(fixture.attemptDir, "landing-summary.md"), "utf8");
    assert.match(summary, /^# Landing Summary/m);
    for (const heading of ["Problem", "Changes", "Verification", "Risks"]) assert.match(summary, new RegExp(`^## ${heading}$`, "m"));
    assert.match(summary, /land the exact tested candidate/);
    assert.match(summary, new RegExp(fixture.candidate));

    const journal = readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8");
    assert.match(journal, /"lifecycleState":"LANDING"/);
    assert.match(journal, /"lifecycleState":"LANDED"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a landing summary write failure never blocks the candidate the human approved", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-human-summary-failure-"));
  try {
    const fixture = await seed(root);
    const result = await landCommand({
      attemptDir: fixture.attemptDir,
      terminal: terminal(true, true),
      summaryWriter: async () => { throw new Error("fixture write failure"); },
    });
    assert.equal(result.status.lifecycleState, "LANDED");
    assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.candidate);
    assert.equal(existsSync(join(fixture.attemptDir, "landing-summary.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real degraded projection still blocks landing while the healthy fixture above lands", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-human-degraded-"));
  try {
    const fixture = await seed(root, "degraded");
    const lines: string[] = [];
    const code = await main({
      argv: ["land", TASK, "--state-root", join(root, "state"), "--config", resolve("awsf.config.yaml")],
      cwd: fixture.repository,
      terminal: terminal(true, true, lines),
      writeOut: (line) => { lines.push(line); },
      writeError: (line) => { lines.push(`ERR ${line}`); },
    });
    assert.equal(code, 1);
    assert.ok(lines.some((line) => line.includes("DegradedObservabilityHold")));
    assert.equal((await readAttempt(fixture.attemptDir)).lifecycleState, "AWAITING_OWNER");
    assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.base);
    assert.doesNotMatch(readFileSync(join(fixture.attemptDir, "journal.jsonl"), "utf8"), /"lifecycleState":"LANDING"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("there is one L20 call site and no API module can reach it", () => {
  const commands = join(resolve("core/src/cli/commands"));
  const source = readdirSync(commands)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(commands, name), "utf8"))
    .join("\n");
  assert.equal((source.match(/to:\s*["']LANDING["']/g) ?? []).length, 1);

  const api = join(resolve("core/src/api"));
  const apiSource = readdirSync(api)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(api, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    apiSource,
    /commands\/land|git\/land|\blandCommand\b|commands\/publish|git\/publish|\bpublishCommand\b/,
  );
});
