// B9-05: `awsf retry T --attempt <older>` minted latest+1 from whichever
// attempt it was handed. The new attempt carried the OLDER attempt's smaller
// spend and could sit beside a later live attempt, so the task-lifetime call
// ceiling stopped binding — repeatably, because the older attempt never changes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  latestAttemptNumber,
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";

const PROJECT = "agentic-workflow-software-factory";
const TASK = "retry-older";

interface Box { readonly root: string; readonly stateRoot: string; readonly close: () => void }

function sandbox(label: string): Box {
  const root = mkdtempSync(join(tmpdir(), `awsf-b9-05-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

/** Records `calls` spent calls on the attempt, then optionally ends it BLOCKED. */
async function spendThen(attemptDir: string, calls: number, terminal: boolean): Promise<AttemptStatus> {
  const status = await readAttempt(attemptDir);
  return persistAttempt(attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {
      budget: { ...status.budget, callsSpent: calls },
      ...(terminal ? { lifecycleState: "BLOCKED" as const, lastActivity: "blocked by the B9-05 harness" } : {}),
    }),
  });
}

function retry(box: Box, attemptDir: string): ReturnType<typeof retryCommand> {
  return retryCommand({
    attemptDir, stateRoot: box.stateRoot, configSnapshotJson: "{}", allowance: { auto: 1, owner: 1 },
  });
}

/**
 * Attempt 1 BLOCKED after one call; attempt 2 minted by retry, which then
 * spends to three calls in total and is left live or BLOCKED.
 */
async function twoAttempts(box: Box, secondTerminal: boolean): Promise<{ first: string; second: string; root: string }> {
  const created = await newCommand({
    stateRoot: box.stateRoot, project: PROJECT, taskId: TASK,
    repository: box.root, request: "retry an older attempt", workflow: "build", tier: 1,
  });
  await spendThen(created.attemptDir, 1, true);
  const second = await retry(box, created.attemptDir);
  assert.equal(second.status.attempt, 2);
  await spendThen(second.attemptDir, 3, secondTerminal);
  return { first: created.attemptDir, second: second.attemptDir, root: taskRoot(box.stateRoot, PROJECT, TASK) };
}

test("B9-05 RED: retrying an older terminal attempt is refused and mints nothing", async () => {
  const box = sandbox("older");
  try {
    const { first, root } = await twoAttempts(box, true);
    await assert.rejects(retry(box, first), /attempt 1 is not the latest attempt \(2\)/u);
    assert.equal(await latestAttemptNumber(root), 2, "no attempt 3 may be minted from attempt 1's spend");
  } finally { box.close(); }
});

test("B9-05 triangulate: retrying an older attempt is refused while a later attempt is live", async () => {
  const box = sandbox("live");
  try {
    const { first, second, root } = await twoAttempts(box, false);
    assert.equal((await readAttempt(second)).lifecycleState, "DRAFT");
    await assert.rejects(retry(box, first), /attempt 2 is live \(DRAFT\)/u);
    assert.equal(await latestAttemptNumber(root), 2, "a second live attempt may not coexist with attempt 2");
    const untouched = await readAttempt(second);
    assert.equal(untouched.budget.callsSpent, 3);
    assert.equal(untouched.lifecycleState, "DRAFT");
  } finally { box.close(); }
});

test("B9-05 triangulate: the latest terminal attempt still retries and carries its own spend", async () => {
  const box = sandbox("latest");
  try {
    const { second, root } = await twoAttempts(box, true);
    const third = await retry(box, second);
    assert.equal(third.status.attempt, 3);
    assert.equal(third.status.lifecycleState, "DRAFT");
    assert.equal(third.status.budget.callsSpent, 3, "the task's full spend carries, not attempt 1's");
    assert.equal(third.attemptDir, join(root, "3"));
    assert.equal(await latestAttemptNumber(root), 3);
  } finally { box.close(); }
});
