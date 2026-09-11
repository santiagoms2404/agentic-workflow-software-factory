// `awsf degrade-review` — the owner act that lets ONE attempt buy a review from
// the provider that wrote its candidate.
//
// The properties under test are the ones that keep it a decision rather than a
// fallback: interactive-only, reasoned, attempt-scoped, unrepeatable, and
// refused where there is no review to degrade. The rule it must not break is
// the one `schema.ts` states — the HOST never selects same-provider review from
// availability, quota, or a transport failure — so the grant is only ever
// reachable through this command, and only from a terminal.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import {
  ReviewDegradeAlreadyGranted,
  ReviewDegradeAttemptNotLive,
  ReviewDegradeCredentialRejected,
  ReviewDegradeNoReviewPhase,
  ReviewDegradeNotInteractive,
  ReviewDegradeReasonRequired,
  degradeReviewCommand,
  workflowBuysReview,
} from "../../../src/cli/commands/degrade-review.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { callCeilingsOf } from "../../../src/state/tiers.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

const AT = "2026-09-10T00:00:00.000Z";
const REASON = "codex quota is exhausted until 14:00 UTC and this task cannot wait";
const PROJECT = "agentic-workflow-software-factory";

function terminal(answer: boolean, interactive = true, lines: string[] = []): OwnerTerminal {
  return { interactive, write: (line) => { lines.push(line); }, confirm: async () => answer };
}

async function attempt(root: string, taskId: string, workflow = "build-review"): Promise<string> {
  const created = await newCommand({
    stateRoot: join(root, "state"),
    project: PROJECT,
    taskId,
    repository: resolve("."),
    request: "prove a degraded review is an owner act",
    workflow,
    tier: 2,
    callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 7 }),
    now: () => AT,
    sessionId: () => `${taskId}-session`,
  });
  return created.attemptDir;
}

test("a piped stdin cannot take the act, whatever it is asking for", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "piped");

  await assert.rejects(
    degradeReviewCommand({ attemptDir: dir, reason: REASON, terminal: terminal(true, false) }),
    ReviewDegradeNotInteractive,
  );
  assert.equal((await readAttempt(dir)).reviewDegradation, null, "nothing was written");
});

test("the reason is required, bounded, and never credential-shaped", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "reasoned");

  await assert.rejects(
    degradeReviewCommand({ attemptDir: dir, reason: "   ", terminal: terminal(true) }),
    ReviewDegradeReasonRequired,
  );
  await assert.rejects(
    degradeReviewCommand({
      attemptDir: dir,
      reason: "using sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA for the reviewer",
      terminal: terminal(true),
    }),
    ReviewDegradeCredentialRejected,
  );
});

test("a workflow that buys no review has no independence to give up", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "no-review", "build");

  assert.equal(workflowBuysReview("build"), false);
  assert.equal(workflowBuysReview("build-review"), true);
  assert.equal(workflowBuysReview("simple-sdlc"), true);
  // design-to-plan's architecture review carries its own schema and no
  // inversion rule attaches to it.
  assert.equal(workflowBuysReview("design-to-plan"), false);

  await assert.rejects(
    degradeReviewCommand({ attemptDir: dir, reason: REASON, terminal: terminal(true) }),
    ReviewDegradeNoReviewPhase,
  );
});

test("declining records nothing and leaves the attempt requiring an independent review", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "declined");
  const lines: string[] = [];

  const result = await degradeReviewCommand({ attemptDir: dir, reason: REASON, terminal: terminal(false, true, lines) });
  assert.equal(result.confirmed, false);
  assert.equal((await readAttempt(dir)).reviewDegradation, null);
  assert.ok(
    lines.some((line) => /finds less than an independent one/.test(line)),
    "the owner is told what the grant costs before they answer",
  );
});

test("confirming records the grant, the reason, and one piece of evidence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "granted");

  const result = await degradeReviewCommand({
    attemptDir: dir, reason: REASON, terminal: terminal(true), now: () => AT,
  });
  assert.equal(result.confirmed, true);

  const status = await readAttempt(dir);
  assert.deepEqual(status.reviewDegradation, { reason: REASON, attempt: 1, at: AT });
  assert.match(status.lastActivity, /owner allowed a same-provider review/);
  assert.equal(status.lifecycleState, "DRAFT", "the grant moves no lifecycle edge");
  assert.equal(status.budget.callsSpent, 0, "and spends no call");
});

test("an attempt takes at most one grant", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "twice");

  await degradeReviewCommand({ attemptDir: dir, reason: REASON, terminal: terminal(true), now: () => AT });
  await assert.rejects(
    degradeReviewCommand({ attemptDir: dir, reason: "a second thought", terminal: terminal(true) }),
    ReviewDegradeAlreadyGranted,
  );
});

test("a sealed attempt is past degrading, and the refusal names the way forward", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "sealed");

  const current = await readAttempt(dir);
  await persistAttempt(dir, current.revision, {
    kind: "attempt.updated",
    next: nextRevision(current, { lifecycleState: "CANCELLED" }),
  });

  await assert.rejects(
    degradeReviewCommand({ attemptDir: dir, reason: REASON, terminal: terminal(true) }),
    (error: Error) => error instanceof ReviewDegradeAttemptNotLive && /awsf retry sealed/.test(error.message),
  );
});

test("the grant is journalled as evidence in its own right", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = await attempt(root, "journalled");
  const recorded: AttemptEvidence[] = [];

  await degradeReviewCommand({
    attemptDir: dir,
    reason: REASON,
    terminal: terminal(true),
    now: () => AT,
    projectRecord: (record) => {
      const evidence = record.event.evidence;
      if (evidence !== undefined) recorded.push(evidence);
    },
  });

  assert.deepEqual(recorded, [{ type: "review-degradation", reason: REASON, attempt: 1, at: AT }]);
});

test("a retry carries the routes forward and the grant not at all", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-degrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  const created = await newCommand({
    stateRoot,
    project: PROJECT,
    taskId: "retried",
    repository: resolve("."),
    request: "prove a grant does not outlive the attempt it was given to",
    workflow: "build-review",
    tier: 2,
    routeOverrides: { builder: { adapter: "claude", provider: "anthropic", model: "claude:sonnet", effort: "high" } },
    callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 7 }),
    now: () => AT,
    sessionId: () => "retried-session",
  });

  await degradeReviewCommand({ attemptDir: created.attemptDir, reason: REASON, terminal: terminal(true), now: () => AT });
  const granted = await readAttempt(created.attemptDir);
  assert.notEqual(granted.reviewDegradation, null);

  // A retry opens only from a sealed attempt, so seal this one first.
  await persistAttempt(created.attemptDir, granted.revision, {
    kind: "attempt.updated",
    next: nextRevision(granted, { lifecycleState: "CANCELLED" }),
  });

  const retried = await retryCommand({
    attemptDir: created.attemptDir,
    stateRoot,
    configSnapshotJson: granted.configSnapshotJson,
    callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 7 }),
    allowance: { auto: 1, owner: 1 },
    now: () => AT,
  });

  assert.deepEqual(
    retried.status.routeOverrides,
    { builder: { adapter: "claude", provider: "anthropic", model: "claude:sonnet", effort: "high" } },
    "the owner's routing choice is still the task's",
  );
  assert.equal(
    retried.status.reviewDegradation,
    null,
    "but the next attempt asks the owner again, exactly as it does for owner re-entries",
  );
});
