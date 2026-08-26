import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  isTerminalStatus,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptEvent,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { toAttemptStatusProjection } from "../../../src/cli/commands/attempt-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import {
  CeilingRaiseAttemptNotLive,
  raiseCommand,
} from "../../../src/cli/commands/raise.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { watchCommand } from "../../../src/cli/commands/watch.ts";
import { AttemptLock, runWriteProtocol } from "../../../src/persistence/attempt-lock.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { tryReadStatus } from "../../../src/persistence/status-store.ts";
import { TASK_STATES, transition, type TaskState } from "../../../src/state/task-machine.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { validInput } from "../_lifecycle-harness.ts";

const AT = "2026-08-25T00:00:00.000Z";
const SHA = "c".repeat(40);

function errorNamed(name: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.name === name;
}

async function withRoot(name: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), `awsf-publish-seal-${name}-`));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function createAttempt(root: string, taskId: string): Promise<{ stateRoot: string; attemptDir: string; status: AttemptStatus }> {
  const stateRoot = join(root, "state");
  const created = await newCommand({
    stateRoot,
    project: "agentic-workflow-software-factory",
    taskId,
    repository: resolve("."),
    request: "prove the publication seal",
    workflow: "build",
    tier: 1,
    now: () => AT,
    sessionId: () => `${taskId}-session`,
  });
  return { stateRoot, attemptDir: created.attemptDir, status: created.status };
}

async function makeLanded(root: string, taskId: string): Promise<{ stateRoot: string; attemptDir: string; status: AttemptStatus }> {
  const created = await createAttempt(root, taskId);
  const landed = nextRevision(created.status, {
    lifecycleState: "LANDED",
    candidateSha: SHA,
    landingApproval: {
      candidateSha: SHA,
      summary: "Publish the landed candidate.",
      approvedAt: AT,
    },
    lastActivityAt: AT,
    lastActivity: "candidate landed",
  });
  const status = await persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.transitioned",
    next: landed,
  });
  return { ...created, status };
}

async function makePublished(root: string, taskId: string): Promise<{ stateRoot: string; attemptDir: string; status: AttemptStatus }> {
  const landed = await makeLanded(root, taskId);
  const result = transition(validInput("L27"));
  assert.equal(result.edge, "L27");
  const published = await persistAttempt(landed.attemptDir, landed.status.revision, {
    kind: "attempt.transitioned",
    next: nextRevision(landed.status, {
      lifecycleState: "PUBLISHED",
      lastActivity: "candidate published",
    }),
  });
  return { ...landed, status: published };
}

function eventFrom(status: AttemptStatus, kind: AttemptEvent["kind"], lifecycleState: TaskState): AttemptEvent {
  return {
    kind,
    next: nextRevision(status, { lifecycleState }),
  };
}

test("a LANDED attempt accepts the L27 transition to PUBLISHED", async () => {
  await withRoot("l27", async (root) => {
    const published = await makePublished(root, "l27");
    assert.equal(published.status.lifecycleState, "PUBLISHED");
    assert.equal((await readAttempt(published.attemptDir)).lifecycleState, "PUBLISHED");
  });
});

test("a LANDED attempt refuses attempt.updated with no transition by error name", async () => {
  await withRoot("updated", async (root) => {
    const landed = await makeLanded(root, "updated");
    await assert.rejects(
      persistAttempt(
        landed.attemptDir,
        landed.status.revision,
        eventFrom(landed.status, "attempt.updated", "LANDED"),
      ),
      errorNamed("SealedAttempt"),
    );
  });
});

test("a LANDED attempt refuses a transition to every state except PUBLISHED by error name", async () => {
  await withRoot("other-state", async (root) => {
    const landed = await makeLanded(root, "other-state");
    for (const state of TASK_STATES.filter((candidate) => candidate !== "LANDED" && candidate !== "PUBLISHED")) {
      await assert.rejects(
        persistAttempt(
          landed.attemptDir,
          landed.status.revision,
          eventFrom(landed.status, "attempt.transitioned", state),
        ),
        errorNamed("SealedAttempt"),
        `LANDED -> ${state}`,
      );
    }
  });
});

test("a second L27 is refused once the attempt is PUBLISHED by error name", async () => {
  await withRoot("second-l27", async (root) => {
    const published = await makePublished(root, "second-l27");
    await assert.rejects(
      persistAttempt(
        published.attemptDir,
        published.status.revision,
        eventFrom(published.status, "attempt.transitioned", "PUBLISHED"),
      ),
      errorNamed("SealedAttempt"),
    );
  });
});

test("a PUBLISHED attempt refuses every attempt event with SealedAttempt", async () => {
  await withRoot("all-events", async (root) => {
    const published = await makePublished(root, "all-events");
    const kinds: readonly AttemptEvent["kind"][] = [
      "attempt.created",
      "attempt.updated",
      "attempt.transitioned",
      "attempt.retried",
    ];
    for (const kind of kinds) {
      await assert.rejects(
        persistAttempt(
          published.attemptDir,
          published.status.revision,
          eventFrom(published.status, kind, "DRAFT"),
        ),
        errorNamed("SealedAttempt"),
        kind,
      );
    }
  });
});

test("the PUBLISHED write seals its lock so a second withLock throws SealedAttempt", async () => {
  await withRoot("lock", async (root) => {
    const lock = new AttemptLock(join(root, "attempt.lock"));
    const journal = new Journal<{ kind: string }>(join(root, "journal.jsonl"));
    const statusPath = join(root, "status.json");
    try {
      await runWriteProtocol<{ kind: string }, { state: string; revision: number }>({
        lock,
        journal,
        statusPath,
        readCurrentStatus: () => tryReadStatus(statusPath),
        validate: () => ({
          event: { kind: "attempt.transitioned" },
          nextStatus: { state: "PUBLISHED", revision: 1 },
        }),
        sealWhenTerminal: (status) => status.state === "PUBLISHED" ? status.state : null,
      });
      assert.equal(lock.isSealed(), true);
      await assert.rejects(lock.withLock(async () => undefined), errorNamed("SealedAttempt"));
    } finally {
      await journal.close();
    }
  });
});

test("isTerminalStatus still classifies a LANDED attempt as terminal", async () => {
  await withRoot("terminal", async (root) => {
    const landed = await makeLanded(root, "terminal");
    assert.equal(isTerminalStatus(landed.status), true);
  });
});

test("retry still mints attempt n+1 from a LANDED attempt", async () => {
  await withRoot("retry", async (root) => {
    const landed = await makeLanded(root, "retry");
    const retried = await retryCommand({
      attemptDir: landed.attemptDir,
      stateRoot: landed.stateRoot,
      configSnapshotJson: "{}",
      allowance: { auto: 1, owner: 1 },
      now: () => AT,
      sessionId: () => "retry-session-2",
    });
    assert.equal(retried.status.attempt, 2);
    assert.equal(retried.status.lifecycleState, "DRAFT");
  });
});

test("raise refuses a LANDED attempt with CeilingRaiseAttemptNotLive", async () => {
  await withRoot("raise", async (root) => {
    const landed = await makeLanded(root, "raise");
    const terminal: OwnerTerminal = { interactive: true, write: () => {}, confirm: async () => true };
    await assert.rejects(
      raiseCommand({ attemptDir: landed.attemptDir, calls: 1, reason: "one more call", terminal }),
      errorNamed(CeilingRaiseAttemptNotLive.name),
    );
  });
});

test("raise rechecks and refuses when the attempt becomes LANDED after confirmation", async () => {
  await withRoot("raise-race", async (root) => {
    const created = await createAttempt(root, "raise-race");
    const terminal: OwnerTerminal = {
      interactive: true,
      write: () => {},
      confirm: async () => {
        await persistAttempt(created.attemptDir, created.status.revision, {
          kind: "attempt.transitioned",
          next: nextRevision(created.status, {
            lifecycleState: "LANDED",
            candidateSha: SHA,
            landingApproval: { candidateSha: SHA, summary: "landed during confirmation", approvedAt: AT },
          }),
        });
        return true;
      },
    };
    await assert.rejects(
      raiseCommand({ attemptDir: created.attemptDir, calls: 1, reason: "one more call", terminal }),
      errorNamed(CeilingRaiseAttemptNotLive.name),
    );
  });
});

test("watch returns immediately for a LANDED attempt", async () => {
  await withRoot("watch", async (root) => {
    const landed = await makeLanded(root, "watch");
    let sleeps = 0;
    await watchCommand({
      attemptDir: landed.attemptDir,
      write: () => {},
      sleep: async () => { sleeps += 1; },
    });
    assert.equal(sleeps, 0);
  });
});

test("the attempt projection still sets endedAt for LANDED", async () => {
  await withRoot("ended-at", async (root) => {
    const landed = await makeLanded(root, "ended-at");
    assert.equal(
      toAttemptStatusProjection(landed.stateRoot, landed.status).endedAt,
      landed.status.lastActivityAt,
    );
  });
});
