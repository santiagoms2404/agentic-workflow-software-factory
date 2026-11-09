// B3-02 / B3-03: `awsf publish` used to push first and validate its output
// record after, so any status the closed publish-output schema refused moved
// the remote and then threw before PUBLISHED was recorded — and every retry
// pushed again and failed again. These cases pin both halves of the repair:
// the statuses real attempts carry (a shift selection, a ticket selection, a
// pre-ceiling legacy budget) validate, and a record that does not validate
// stops the command before any push argv reaches the runner.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { publishCommand, type PublishCommandResult } from "../../../src/cli/commands/publish.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { sealTicketSelection } from "../../../src/contracts/ticket-selection-record.ts";
import type { GitRunner } from "../../../src/git/changes.ts";
import { SHIFT_WORKFLOW_ID } from "../../../src/workflow/shift/compile.ts";
import { bareFixture, remoteSha, type BareFixture } from "./_bare.ts";

const AT = "2026-08-25T00:00:00.000Z";
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const CATALOG = `version: awsf.project/v1
project:
  slug: publish-test
repositories:
  plans:
    role: plan
    default_branch: main
    publish:
      remotes: [origin]
      branches: [published]
plans:
  root: specs
  format: awsf-plan-html/v1
`;

const TICKET = {
  id: "T01",
  path: "specs/tickets/publish-plan/T01.md",
  digest: createHash("sha256").update("T01 ticket bytes", "utf8").digest("hex"),
};

function terminal(): OwnerTerminal {
  return { interactive: true, write: () => {}, confirm: async () => true };
}

function configurePublish(repository: string): string {
  writeFileSync(join(repository, "awsf.project.yaml"), CATALOG);
  execFileSync("git", ["-C", repository, "add", "awsf.project.yaml"], { env: GIT_ENV });
  execFileSync("git", ["-C", repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: configure publication"], { env: GIT_ENV });
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8", env: GIT_ENV }).trim();
}

type Creation = Pick<Parameters<typeof newCommand>[0], "workflow" | "shift" | "ticketSelection" | "planRef">;

/** A LANDED attempt minted the way `awsf new` mints one, with `update` applied at landing. */
async function landed(
  fixture: BareFixture,
  taskId: string,
  creation: Creation,
  update: (status: AttemptStatus) => Partial<AttemptStatus> = () => ({}),
): Promise<string> {
  const sha = configurePublish(fixture.work);
  const created = await newCommand({
    stateRoot: join(fixture.root, "state"),
    project: "publish-test",
    taskId,
    repository: fixture.work,
    request: "publish the landed candidate",
    tier: 1,
    now: () => AT,
    sessionId: () => `${taskId}-session`,
    ...creation,
  });
  await persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.transitioned",
    next: nextRevision(created.status, {
      lifecycleState: "LANDED",
      candidateSha: sha,
      landingApproval: { candidateSha: sha, summary: "Publish this revision.", approvedAt: AT },
      lastActivityAt: AT,
      lastActivity: "candidate landed",
      ...update(created.status),
    }),
  });
  return created.attemptDir;
}

/** Counts push argv reaching the runner; everything else is the fixture's own local Git. */
function countingRunner(fixture: BareFixture): { runner: GitRunner; pushes: () => number } {
  let pushes = 0;
  return {
    runner: (argv) => {
      if (argv[0] === "push") pushes += 1;
      return fixture.runner(argv);
    },
    pushes: () => pushes,
  };
}

/** The outcome, or the refusal message, so a post-push validation failure reads as an assertion. */
async function publishOutcome(attemptDir: string, fixture: BareFixture, runner: GitRunner): Promise<PublishCommandResult | string> {
  try {
    return await publishCommand({
      attemptDir,
      stateRoot: join(fixture.root, "state"),
      terminal: terminal(),
      gitRunner: runner,
      now: () => AT,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function publishedStatus(result: PublishCommandResult | string): AttemptStatus {
  assert.equal(typeof result === "string" ? result : result.outcome, "published");
  assert.ok(typeof result !== "string" && result.outcome === "published");
  return result.status;
}

test("a shift attempt's publish record validates, so its one push is recorded as PUBLISHED", async () => {
  const fixture = bareFixture();
  try {
    const shift = sealShiftManifest({ plan: "publish-plan", milestones: ["M1"], tickets: [TICKET] });
    const attemptDir = await landed(fixture, "T18-shift", { workflow: SHIFT_WORKFLOW_ID, shift });
    const counting = countingRunner(fixture);

    const status = publishedStatus(await publishOutcome(attemptDir, fixture, counting.runner));

    assert.deepEqual(status.shift, shift);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "PUBLISHED");
    assert.equal(counting.pushes(), 1);
  } finally {
    fixture.dispose();
  }
});

test("a ticket-selection attempt's publish record validates and carries its selection", async () => {
  const fixture = bareFixture();
  try {
    const ticketSelection = sealTicketSelection({ plan: "publish-plan", tickets: [TICKET] });
    const attemptDir = await landed(fixture, "T18-ticket", { workflow: "build", planRef: "publish-plan", ticketSelection });
    const counting = countingRunner(fixture);

    const status = publishedStatus(await publishOutcome(attemptDir, fixture, counting.runner));

    assert.deepEqual(status.ticketSelection, ticketSelection);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "PUBLISHED");
    assert.equal(counting.pushes(), 1);
  } finally {
    fixture.dispose();
  }
});

test("a pre-ceiling legacy attempt publishes with its ceiling still absent, read as the tier default", async () => {
  const fixture = bareFixture();
  try {
    const attemptDir = await landed(fixture, "T18-legacy", { workflow: "build" }, (status) => {
      const { ceiling: _ceiling, ...budget } = status.budget;
      return { budget: budget as AttemptStatus["budget"] };
    });
    assert.equal("ceiling" in (await readAttempt(attemptDir)).budget, false, "the fixture is a pre-dial status");
    const counting = countingRunner(fixture);

    const status = publishedStatus(await publishOutcome(attemptDir, fixture, counting.runner));

    // The legacy default is absence: `ceilingFor` reads it as the tier default,
    // and writing a number in would claim a ceiling the attempt never recorded.
    assert.equal("ceiling" in status.budget, false);
    assert.equal(counting.pushes(), 1);
  } finally {
    fixture.dispose();
  }
});

test("a publish record that does not validate stops the command before any push", async () => {
  const fixture = bareFixture();
  try {
    const attemptDir = await landed(fixture, "T18-invalid", { workflow: "build" }, () =>
      ({ undeclaredField: true }) as Partial<AttemptStatus>);
    const counting = countingRunner(fixture);

    const result = await publishOutcome(attemptDir, fixture, counting.runner);

    assert.equal(counting.pushes(), 0, "the remote must not move for a record that cannot be recorded");
    assert.equal(remoteSha(fixture, "published"), null);
    assert.match(String(result), /^invalid awsf\.publish-output\/v1: .*undeclaredField/u);
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "LANDED");
  } finally {
    fixture.dispose();
  }
});
