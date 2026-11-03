// B9-43, B9-48, B9-49, B9-51: Tier 4 Batch 9 gap sweep regression tests (part 1).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertDegradeReason } from "../../../src/cli/commands/degrade-review.ts";
import { assertGrantReason } from "../../../src/cli/commands/raise.ts";
import { assertProveReason } from "../../../src/cli/commands/prove.ts";
import { assertRelateReason } from "../../../src/cli/commands/relate.ts";
import { gcCommand } from "../../../src/cli/commands/operator.ts";
import { cancelCommand } from "../../../src/cli/commands/cancel.ts";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";

function fakeAttempt(overrides: Partial<AttemptStatus> = {}): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: "sess-1",
    project: "demo-project",
    taskId: "T01-task",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    repository: "/tmp/repo",
    worktree: "/tmp/repo/worktree",
    workflow: "build",
    tier: 1,
    request: "implement something",
    configSnapshotJson: "{}",
    lifecycleState: "RUNNING",
    baseSha: "base123",
    candidateSha: "cand456",
    phase: null,
    budget: {
      attempt: 1,
      ceiling: 10,
      callsSpent: 2,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: {
        auto: 3,
        owner: 3,
        ownerReentries: 3,
      },
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: null,
    lastActivityAt: "2026-11-03T12:00:00.000Z",
    lastActivity: "started",
    revision: 1,
    process: null,
    ...overrides,
  } as any as AttemptStatus;
}

test("B9-43: assertDegradeReason, assertProveReason, assertGrantReason, assertRelateReason reject credential before 2000 char boundary", () => {
  // A token placed right across the 2,000 char boundary
  const prefix = "a".repeat(1990);
  const token = "ghp_" + "A".repeat(20);
  const reasonWithStraddlingCredential = `${prefix} ${token}`;

  assert.throws(() => {
    assertDegradeReason(reasonWithStraddlingCredential);
  }, /credential/i, "assertDegradeReason must reject credential straddling boundary");

  assert.throws(() => {
    assertProveReason(reasonWithStraddlingCredential);
  }, /credential/i, "assertProveReason must reject credential straddling boundary");

  assert.throws(() => {
    assertGrantReason(reasonWithStraddlingCredential);
  }, /credential/i, "assertGrantReason must reject credential straddling boundary");

  assert.throws(() => {
    assertRelateReason(reasonWithStraddlingCredential);
  }, /credential/i, "assertRelateReason must reject credential straddling boundary");
});

test("B9-48: gcCommand includes PUBLISHED attempts in candidate list", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-b9-48-"));
  try {
    const taskDir = join(stateRoot, "projects", "demo-project", "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    const status = fakeAttempt({ lifecycleState: "PUBLISHED" });
    writeFileSync(join(taskDir, "status.json"), JSON.stringify(status), "utf8");
    writeFileSync(join(taskDir, "journal.jsonl"), "", "utf8");

    const candidates = await gcCommand(stateRoot);
    const expected = `attempt: ${taskDir}`;
    assert.ok(candidates.includes(expected), `gcCommand must include PUBLISHED attempt ${expected}`);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("B9-51: cancelCommand refuses when non-RUNNING state has live process survivors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-51-"));
  try {
    const taskDir = join(dir, "projects", "demo", "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    // State is REVIEWING (non-RUNNING) with a non-null recorded process
    const status = fakeAttempt({
      lifecycleState: "REVIEWING",
      process: { pid: 12345, phaseId: "worker", startedAt: "2026-11-03T12:00:00.000Z" } as any,
    });
    writeFileSync(join(taskDir, "status.json"), JSON.stringify(status), "utf8");

    const fakeTerminal = {
      interactive: true,
      async confirm() { return true; },
      write() {},
    } as any;

    await assert.rejects(
      cancelCommand({
        attemptDir: taskDir,
        cause: "owner",
        noTrap: { because: "owner", reason: "testing" },
        reason: "cancelling reviewing attempt with stubborn process",
        terminal: fakeTerminal,
        terminate: async () => ({
          termSent: true,
          killSent: true,
          survivors: [12345],
          terminated: false,
          skipped: null,
        }),
      }),
      /cancellation incomplete; survivors \[12345\]/,
      "cancelCommand must refuse when non-RUNNING attempt has unkillable survivor processes",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-49: previewCommand git diff argv passes --no-renames", async () => {
  const { readFileSync } = await import("node:fs");
  const previewSource = readFileSync(new URL("../../../src/cli/commands/preview.ts", import.meta.url), "utf8");
  assert.match(
    previewSource,
    /\["diff",\s*"--name-only",\s*"--no-renames",\s*"-z"/,
    "preview.ts must pass --no-renames to diff so renamed files are reported under both paths",
  );
});

