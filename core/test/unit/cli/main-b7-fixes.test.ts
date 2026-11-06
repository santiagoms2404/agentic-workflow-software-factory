import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { defaultWorktreeRoot } from "../../../src/cli/commands/start.ts";
import { cliWorktreeRoot, main, parseArgs, shadowStop, shadowStopEnvironment } from "../../../src/cli/main.ts";
import { loadConfig } from "../../../src/config/load.ts";

function catalogless(): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-main-b7-ticket-"));
  mkdirSync(join(root, "specs", "tickets"), { recursive: true });
  const lightTicket = [
    "---",
    "id: T99",
    "title: Light-tier intake ticket",
    "milestone: M1",
    "tier: 0",
    "state: done",
    "depends_on: []",
    "workflow: intake",
    "outcome: Light",
    "context: [Light]",
    "acceptance: [Light]",
    "non_goals: [Light]",
    "---",
    "light-source-only-marker",
    "",
  ].join("\n");
  writeFileSync(join(root, "specs", "tickets", "T99.md"), lightTicket);
  return root;
}

function fixtureRepo(root: string): string {
  const repo = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "base\n");
  writeFileSync(join(repo, "awsf.config.yaml"), readFileSync(resolve("awsf.config.yaml"), "utf8"));
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Author", "-c", "user.email=author@example.com", "commit", "-q", "-m", "base"]);
  return repo;
}

async function drive(argv: readonly string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; output: string[]; errors: string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await main({
    argv,
    cwd,
    env,
    writeOut: (line) => { output.push(line); },
    writeError: (line) => { errors.push(line); },
  });
  return { code, output, errors };
}

test("B7-62: every owner-act arm shares the same terminal fallback", () => {
  const source = readFileSync(resolve("core/src/cli/main.ts"), "utf8");
  assert.doesNotMatch(source, /options\.terminal \?\? processOwnerTerminal\(\)/u);
  assert.equal([...source.matchAll(/ownerTerminal\(options\.terminal\)/gu)].length, 16);
});

test("B7-63: grant reuses the config already validated by main", () => {
  const source = readFileSync(resolve("core/src/cli/main.ts"), "utf8");
  const start = source.indexOf('case "grant":');
  const end = source.indexOf('case "raise":', start);
  assert.ok(start >= 0 && end > start);
  const grantArm = source.slice(start, end);
  assert.doesNotMatch(grantArm, /loadConfig|readFile/u);
  assert.match(grantArm, /grantCommand\(\{ attemptDir: located\.attemptDir, config, configPath, stateRoot/u);
});

test("B7-65: flag-value spellings share one routing table", () => {
  const equals = parseArgs(["--where=source", "--read=guide", "--consulted", "session-1", "--ticket=T01"]);
  const spaced = parseArgs(["--where", "source", "--read", "guide", "--consulted=session-1", "--ticket", "T01"]);
  assert.deepEqual(equals.where, spaced.where);
  assert.deepEqual(equals.read, spaced.read);
  assert.deepEqual(equals.consulted, spaced.consulted);
  assert.deepEqual(equals.tickets, spaced.tickets);
});

test("B7-66: a supplied CLI environment cannot re-enable the remote key under tests", () => {
  const supplied = { OPENROUTER_API_KEY: "not-a-real-value" };
  assert.equal(shadowStopEnvironment(supplied, true).OPENROUTER_API_KEY, undefined);
  assert.equal(shadowStopEnvironment({ ...supplied, NODE_TEST_CONTEXT: "1" }, false).OPENROUTER_API_KEY, undefined);
  assert.equal(shadowStopEnvironment(supplied, false), supplied);
});

test("B7-18: shadowStop callers in main.ts pass projection.projectDecision", () => {
  const source = readFileSync(resolve("core/src/cli/main.ts"), "utf8");
  const matches = [...source.matchAll(/await shadowStop\([^)]+\)/g)].map((m) => m[0]);
  // Intake, run and resume each stop on success and on the throw path (B7-36, B7-37).
  assert.equal(matches.length, 6, "expected 6 shadowStop call sites in main.ts");
  for (const call of matches) {
    assert.ok(call.includes("projection.projectDecision"), `Call site ${call} must pass projection.projectDecision`);
  }
});

test("B7-18: shadowStop accepts projectDecision parameter and executes gracefully", async () => {
  let projectDecisionCalled = false;
  const projectDecision = (_record: unknown) => { projectDecisionCalled = true; };
  await assert.doesNotReject(async () => {
    await shadowStop("/nonexistent/dir", { workflows: { enabled: [] }, agents: [] } as any, "/unused", {}, projectDecision);
  });
  assert.equal(projectDecisionCalled, false);
});

test("B7-36 & B7-37: intake, run and resume each stop the shadow owner when the run throws after sealing", () => {
  const source = readFileSync(resolve("core/src/cli/main.ts"), "utf8");
  // A catch that stops the shadow owner and then rethrows. The run arm already had one; intake and resume did not.
  const catches = [...source.matchAll(/\} catch \(error\) \{([\s\S]*?)\n\s*\}/g)].map((m) => m[1] ?? "");
  const throwPaths = catches.filter((body) => body.includes("await shadowStop(") && body.includes("throw error;"));
  assert.equal(throwPaths.length, 3, "expected a shadow stop on the throw path of intake, run and resume");
});

test("B7-19: --state-root empty string is rejected", async () => {
  const { code, errors } = await drive(["ticket", "list", "--state-root", ""]);
  assert.equal(code, 1);
  assert.match(errors[0] ?? "", /--state-root must not be empty/);

  const { code: code2, errors: errors2 } = await drive(["ticket", "list", "--state-root", "   "]);
  assert.equal(code2, 1);
  assert.match(errors2[0] ?? "", /--state-root must not be empty/);
});

test("B7-19: --worktree-root empty string is rejected", async () => {
  const { code, errors } = await drive(["start", "T01", "--worktree-root", ""]);
  assert.equal(code, 1);
  assert.match(errors[0] ?? "", /--worktree-root must not be empty/);

  const { code: code2, errors: errors2 } = await drive(["start", "T01", "--worktree-root", "   "]);
  assert.equal(code2, 1);
  assert.match(errors2[0] ?? "", /--worktree-root must not be empty/);
});

test("B7-19: cliWorktreeRoot treats empty string AWSF_WORKTREE_ROOT as unset", () => {
  const stateRoot = "/tmp/state-root";
  const expectedDefault = defaultWorktreeRoot(stateRoot);
  assert.equal(cliWorktreeRoot(undefined, undefined, stateRoot), expectedDefault);
  assert.equal(cliWorktreeRoot(undefined, "", stateRoot), expectedDefault);
  assert.equal(cliWorktreeRoot(undefined, "   ", stateRoot), expectedDefault);
  assert.equal(cliWorktreeRoot(undefined, "/custom/worktree", stateRoot), resolve("/custom/worktree"));
  assert.equal(cliWorktreeRoot("/flag/worktree", "/custom/worktree", stateRoot), resolve("/flag/worktree"));
});

test("B7-20: awsf ticket new and refine in catalogless repository fall back to ticketStoreFor", async () => {
  const root = catalogless();
  try {
    const { code, errors } = await drive(["ticket", "new", "T99", "Some Intent"], root);
    assert.equal(code, 1);
    assert.match(errors[0] ?? "", /ticket T99 already exists; use awsf ticket refine/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B7-21: --repository is not supported by awsf new", async () => {
  const { code, errors } = await drive(["new", "my-task", "my intent", "--repository", "repo=path"]);
  assert.equal(code, 1);
  assert.match(errors[0] ?? "", /--repository is not supported by awsf new/);
});

test("B7-21: --route is not supported by awsf start, run, resume", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-main-b7-flags-"));
  try {
    const repo = fixtureRepo(root);
    const stateRoot = join(root, "state");
    const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    const created = await newCommand({
      stateRoot,
      project: config.project.slug,
      taskId: "test-task",
      repository: repo,
      request: "Test discarded flags",
      workflow: "build",
      tier: 1,
      configSnapshotJson: JSON.stringify(config),
    });
    assert.ok(created.attemptDir);

    const startResult = await drive(["start", "test-task", "--route", "build=a/b/c@low", "--state-root", stateRoot], repo);
    assert.equal(startResult.code, 1);
    assert.match(startResult.errors[0] ?? "", /--route is not supported by awsf start/);

    const runResult = await drive(["run", "test-task", "--route", "build=a/b/c@low", "--state-root", stateRoot], repo);
    assert.equal(runResult.code, 1);
    assert.match(runResult.errors[0] ?? "", /--route is not supported by awsf run/);

    const resumeResult = await drive(["resume", "test-task", "--route", "build=a/b/c@low", "--state-root", stateRoot], repo);
    assert.equal(resumeResult.code, 1);
    assert.match(resumeResult.errors[0] ?? "", /--route is not supported by awsf resume/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
