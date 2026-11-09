// B9-03: `awsf raise` while a provider call is running.
//
// The runner writes its status with the revision it cached, so an owner raise
// that bumps the revision mid-call makes the run's next status write fail its
// compare-and-swap — and the run's in-memory budget never sees the new ceiling
// anyway. Like `awsf grant`, the act waits for a quiescent attempt: no recorded
// process and no reserved call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { raiseCommand } from "../../../src/cli/commands/raise.ts";
import { callCeilingsOf } from "../../../src/state/tiers.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";

const AT = "2026-08-16T00:00:00.000Z";
const REASON = "the replacement review needs two calls and one remained";
const PROJECT = "agentic-workflow-software-factory";
const PROCESS = { pid: 424242, pgid: 424242, startIdentity: "synthetic", startIdentitySource: "test" } as const;
const WAIT = /wait for the call to finish/;

interface Owner { readonly terminal: OwnerTerminal; readonly prompts: () => number }

function owner(beforeAnswer: () => Promise<void> = async () => {}): Owner {
  let prompts = 0;
  return {
    terminal: { interactive: true, write: () => {}, confirm: async () => { prompts++; await beforeAnswer(); return true; } },
    prompts: () => prompts,
  };
}

async function runningAttempt(
  root: string, taskId: string, live: { process: typeof PROCESS | null; callsReserved: number },
): Promise<string> {
  const created = await newCommand({
    stateRoot: join(root, "state"), project: PROJECT, taskId, repository: resolve("."),
    request: "prove a raise waits for the running call", workflow: "build-review", tier: 2,
    callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 5 }), now: () => AT, sessionId: () => `${taskId}-session`,
  });
  await persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.updated",
    next: nextRevision(created.status, {
      lifecycleState: "RUNNING", process: live.process,
      budget: { ...created.status.budget, callsReserved: live.callsReserved },
    }),
  });
  return created.attemptDir;
}

function grantCount(attemptDir: string): number {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean)
    .filter((line) => (JSON.parse(line) as { event?: { evidence?: { type?: string } } }).event?.evidence?.type === "ceiling-grant")
    .length;
}

async function withRoot(name: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), `awsf-raise-b9-03-${name}-`));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("B9-03: raise is refused while the attempt records a running provider process, and the revision is unchanged", async () => {
  await withRoot("process", async (root) => {
    const dir = await runningAttempt(root, "raise-live-process", { process: PROCESS, callsReserved: 0 });
    const before = await readAttempt(dir);
    const asker = owner();
    await assert.rejects(
      raiseCommand({ attemptDir: dir, calls: 2, reason: REASON, terminal: asker.terminal, now: () => AT }),
      { name: "CeilingRaiseCallInFlight", message: WAIT },
    );
    const after = await readAttempt(dir);
    assert.equal(after.revision, before.revision, "the runner's cached revision still matches");
    assert.equal(after.budget.ceiling, 5);
    assert.equal(grantCount(dir), 0);
    assert.equal(asker.prompts(), 0, "the owner is not asked to confirm an act that cannot land");
  });
});

test("B9-03: raise is refused while a call is reserved, and the refusal tells the owner to wait for it", async () => {
  await withRoot("reserved", async (root) => {
    const dir = await runningAttempt(root, "raise-reserved-call", { process: null, callsReserved: 1 });
    const before = await readAttempt(dir);
    const error = await raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: owner().terminal })
      .then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof Error, "the raise was refused");
    assert.match(error.message, WAIT);
    assert.match(error.message, /raise-reserved-call/);
    assert.match(error.message, /1 call\(s\) reserved/);
    assert.equal((await readAttempt(dir)).revision, before.revision);
  });
});

test("B9-03: a call that starts while the owner is deciding is caught at the re-read", async () => {
  await withRoot("race", async (root) => {
    const dir = await runningAttempt(root, "raise-call-started", { process: null, callsReserved: 0 });
    const asker = owner(async () => {
      const shown = await readAttempt(dir);
      await persistAttempt(dir, shown.revision, {
        kind: "attempt.updated",
        next: nextRevision(shown, { process: PROCESS, budget: { ...shown.budget, callsReserved: 1 } }),
      });
    });
    await assert.rejects(
      raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: asker.terminal }),
      { name: "CeilingRaiseCallInFlight", message: WAIT },
    );
    assert.equal(asker.prompts(), 1);
    const after = await readAttempt(dir);
    assert.equal(after.budget.ceiling, 5, "nothing was granted");
    assert.equal(grantCount(dir), 0);
  });
});

test("B9-03: an idle non-terminal attempt still raises", async () => {
  await withRoot("idle", async (root) => {
    const dir = await runningAttempt(root, "raise-idle", { process: null, callsReserved: 0 });
    const before = await readAttempt(dir);
    const result = await raiseCommand({ attemptDir: dir, calls: 2, reason: REASON, terminal: owner().terminal, now: () => AT });
    assert.equal(result.confirmed, true);
    assert.equal(result.ceiling, 7);
    assert.equal(result.status.lifecycleState, "RUNNING");
    assert.equal(result.status.revision, before.revision + 1);
    assert.equal(grantCount(dir), 1);
  });
});
