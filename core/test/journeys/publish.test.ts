import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";

import {
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptStatus,
} from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { publishCommand } from "../../src/cli/commands/publish.ts";
import { main } from "../../src/cli/main.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { observePublishTarget, runPublish } from "../../src/git/publish.ts";
import type {
  PublishRepositoryFacts,
  PublishStatusFacts,
} from "../../src/publish/authorize.ts";
import { parseRefspec } from "../../src/publish/refspec.ts";
import { SealedAttempt } from "../../src/persistence/attempt-lock.ts";
import { TASK_STATES, type TaskState } from "../../src/state/task-machine.ts";
import { bareFixture, remoteSha, type BareFixture } from "../unit/publish/_bare.ts";

const PROJECT = "agentic-workflow-software-factory";
const TASK = "T23-publish-journey";
const AT = "2026-08-25T00:00:00.000Z";
const BRANCH = "published";
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], {
    encoding: "utf8",
    env: GIT_ENV,
  }).trim();
}

function commit(repository: string, message: string): void {
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", message);
}

function prepareCandidate(fixture: BareFixture): { base: string; candidate: string } {
  writeFileSync(join(fixture.work, "awsf.project.yaml"), `version: awsf.project/v1
project:
  slug: ${PROJECT}
repositories:
  awsf:
    role: plan
    default_branch: main
    publish:
      remotes: [origin]
      branches: [${BRANCH}]
plans:
  root: specs
  format: awsf-plan-html/v1
`);
  git(fixture.work, "add", "awsf.project.yaml");
  commit(fixture.work, "test: configure local publication");
  const base = git(fixture.work, "rev-parse", "HEAD");

  git(fixture.work, "checkout", "-b", "publish-candidate");
  writeFileSync(join(fixture.work, "message.txt"), "landed publication candidate\n");
  git(fixture.work, "add", "message.txt");
  commit(fixture.work, "feat: exact publication candidate");
  const candidate = git(fixture.work, "rev-parse", "HEAD");
  git(fixture.work, "checkout", "main");
  return { base, candidate };
}

function terminal(lines: string[] = []): OwnerTerminal {
  return {
    interactive: true,
    write: (line) => { lines.push(line); },
    confirm: async () => true,
  };
}

function awaiting(fixture: BareFixture, base: string, candidate: string): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "publish-journey-session",
    project: PROJECT,
    taskId: TASK,
    attempt: 1,
    repository: fixture.work,
    worktree: join(fixture.root, "candidate-worktree"),
    workflow: "build-review",
    tier: 2,
    request: "publish the exact landed candidate",
    configSnapshotJson: "{}",
    lifecycleState: "AWAITING_OWNER",
    baseSha: base,
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
    model: { resolved: "stub/review", provenance: "stream-authoritative" },
    lastActivityAt: AT,
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

async function seedAwaiting(
  fixture: BareFixture,
  stateRoot: string,
  base: string,
  candidate: string,
): Promise<string> {
  const attemptDir = join(stateRoot, "projects", PROJECT, "tasks", TASK, "1");
  const projection = createDashboardProjection(stateRoot);
  try {
    await persistAttempt(
      attemptDir,
      null,
      { kind: "attempt.created", next: awaiting(fixture, base, candidate) },
      projection.project,
    );
  } finally {
    projection.close();
  }
  return attemptDir;
}

async function constructAttempt(
  stateRoot: string,
  repository: string,
  candidate: string,
  state: TaskState,
): Promise<AttemptStatus> {
  const taskId = `T23-refuse-${state.toLowerCase()}`;
  const created = await newCommand({
    stateRoot,
    project: PROJECT,
    taskId,
    repository,
    request: `refuse publication from ${state}`,
    workflow: "build",
    tier: 1,
    now: () => AT,
    sessionId: () => `${taskId}-session`,
  });
  return persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.transitioned",
    next: nextRevision(created.status, {
      lifecycleState: state,
      baseSha: candidate,
      candidateSha: candidate,
      landingApproval: {
        candidateSha: candidate,
        summary: "Valid landing facts isolate the lifecycle-state refusal.",
        approvedAt: AT,
      },
      gatesPass: true,
      requiredReviewPresent: true,
      journeyApproved: true,
      protectedApprovalsValid: true,
      lastActivityAt: AT,
      lastActivity: `constructed ${state} refusal fixture`,
    }),
  });
}

function lsRemoteBytes(bare: string): string {
  return execFileSync("git", ["ls-remote", bare], { encoding: "utf8", env: GIT_ENV });
}

/** Every configured URL is an absolute local path beneath this fixture's root. */
function assertRemoteUrlsStayUnder(root: string, repository: string): void {
  const names = git(repository, "remote").split("\n").filter(Boolean);
  const urls = names.flatMap((name) =>
    git(repository, "remote", "get-url", "--all", name).split("\n").filter(Boolean),
  );
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(isAbsolute(url), true, `${url} is not a local absolute path`);
    const fromRoot = relative(root, url);
    assert.equal(fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot), false, `${url} escapes ${root}`);
  }
}

function journalRecords(attemptDir: string): Array<{
  event: {
    kind: string;
    next: AttemptStatus;
    evidence?: { type?: string; publishedSha?: string };
  };
}> {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      event: {
        kind: string;
        next: AttemptStatus;
        evidence?: { type?: string; publishedSha?: string };
      };
    });
}

test("the real owner path publishes one landed candidate and every other state is inert", async () => {
  const fixture = bareFixture();
  try {
    assertRemoteUrlsStayUnder(fixture.root, fixture.work);
    const { base, candidate } = prepareCandidate(fixture);
    const stateRoot = join(fixture.root, "state");
    const attemptDir = await seedAwaiting(fixture, stateRoot, base, candidate);
    const configPath = resolve("awsf.config.yaml");
    const lines: string[] = [];

    const landedCode = await main({
      argv: ["land", TASK, "--state-root", stateRoot, "--config", configPath],
      cwd: fixture.work,
      terminal: terminal(lines),
      writeOut: (line) => { lines.push(line); },
      writeError: (line) => { lines.push(`ERR ${line}`); },
    });
    assert.equal(landedCode, 0, lines.join("\n"));
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "LANDED");
    assert.equal(git(fixture.work, "rev-parse", "HEAD"), candidate);

    const publishedCode = await main({
      argv: ["publish", TASK, "--state-root", stateRoot, "--config", configPath],
      cwd: fixture.work,
      terminal: terminal(lines),
      writeOut: (line) => { lines.push(line); },
      writeError: (line) => { lines.push(`ERR ${line}`); },
    });
    assert.equal(publishedCode, 0, lines.join("\n"));
    assert.equal(remoteSha(fixture, BRANCH), candidate);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "PUBLISHED");

    const publishRecords = journalRecords(attemptDir).filter(
      (record) => record.event.evidence?.type === "publish",
    );
    assert.equal(publishRecords.length, 1);
    assert.equal(publishRecords[0]?.event.kind, "attempt.transitioned");
    assert.equal(publishRecords[0]?.event.next.lifecycleState, "PUBLISHED");
    assert.match(publishRecords[0]?.event.next.lastActivity ?? "", /^L27 published /u);
    assert.equal(publishRecords[0]?.event.evidence?.publishedSha, candidate);

    const beforeSecondPublish = lsRemoteBytes(fixture.bare);
    let secondPublishGitCalls = 0;
    await assert.rejects(
      publishCommand({
        attemptDir,
        stateRoot,
        terminal: terminal(),
        gitRunner: (argv) => {
          secondPublishGitCalls += 1;
          return fixture.runner(argv);
        },
      }),
      (error: unknown) => error instanceof SealedAttempt,
    );
    assert.equal(secondPublishGitCalls, 0);
    assert.equal(lsRemoteBytes(fixture.bare), beforeSecondPublish);

    const observed = observePublishTarget(fixture.work, "origin", BRANCH, fixture.runner);
    const repository: PublishRepositoryFacts = {
      ...observed.repository,
      allow: { remotes: ["origin"], branches: [BRANCH] },
    };
    const refspec = parseRefspec(`${candidate}:refs/heads/${BRANCH}`);
    let refused = 0;
    for (const state of TASK_STATES.filter((candidateState) => candidateState !== "LANDED")) {
      const status = await constructAttempt(stateRoot, fixture.work, candidate, state);
      const facts: PublishStatusFacts = {
        lifecycleState: status.lifecycleState,
        candidateSha: status.candidateSha,
        landingApproval: status.landingApproval,
      };
      const before = lsRemoteBytes(fixture.bare);
      const result = runPublish(facts, repository, observed.remote, refspec, fixture.runner);
      assert.equal(result.decision, "refused", state);
      if (result.decision !== "refused") throw new Error(`${state} unexpectedly published`);
      assert.equal(result.code, "not-landed", state);
      assert.equal(lsRemoteBytes(fixture.bare), before, state);
      refused += 1;
    }
    assert.equal(refused, TASK_STATES.length - 1);
    assertRemoteUrlsStayUnder(fixture.root, fixture.work);
  } finally {
    fixture.dispose();
  }
});
