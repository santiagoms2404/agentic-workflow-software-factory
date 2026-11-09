// B9-42, B9-44, B9-45, B9-46, B9-47, B9-50: Tier 4 Batch 9 gap sweep regression tests (part 2).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doctorCommand } from "../../../src/cli/commands/doctor.ts";
import { nextCommand } from "../../../src/cli/commands/next.ts";
import { statusCommand } from "../../../src/cli/commands/status.ts";
import { readClosureSnapshot } from "../../../src/git/closure.ts";
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
    lifecycleState: "PREPARED",
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
    blocker: null,
    process: null,
    ...overrides,
  } as any as AttemptStatus;
}

test("B9-44: doctorCommand does not read lock holder when lock file does not exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-44-"));
  try {
    const taskDir = join(dir, "projects", "demo", "tasks", "T01-task", "1");
    mkdirSync(taskDir, { recursive: true });

    const status = fakeAttempt({ lifecycleState: "RUNNING" });
    writeFileSync(join(taskDir, "status.json"), JSON.stringify(status), "utf8");
    writeFileSync(join(taskDir, "journal.jsonl"), "", "utf8");

    // Run doctorCommand on state root without any .lock files
    const report = await doctorCommand(dir);
    assert.equal(report.healthy, true);
    // Lock lines should not appear since no lock exists
    assert.equal(report.lines.some((l) => l.startsWith("lock:")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-46 & B9-47: nextCommand derives owed grant for compiled workflow in single evidence pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-46-"));
  try {
    const status = fakeAttempt({
      workflow: "shift",
      lifecycleState: "PREPARED",
    });
    writeFileSync(join(dir, "status.json"), JSON.stringify(status), "utf8");

    // Mock driver-preflight evidence
    const journalLines = [
      JSON.stringify({
        schema: "awsf/journal-record/v1",
        seq: 1,
        source_seq: 1,
        at: "2026-11-03T12:00:00.000Z",
        recorded_at: "2026-11-03T12:00:00.000Z",
        event: {
          kind: "attempt.created",
          next: status,
          evidence: {
            type: "driver-preflight",
            record: {
              protectedPlan: {
                plans: [],
              },
            },
          },
        },
      }),
    ].join("\n") + "\n";
    writeFileSync(join(dir, "journal.jsonl"), journalLines, "utf8");

    const result = await nextCommand(dir, {
      config: {
        agents: [],
      } as any,
    } as any);

    assert.ok(result.model);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-50: statusCommand on non-shift attempt without --evidence avoids parsing journal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b9-50-"));
  try {
    const status = fakeAttempt({
      workflow: "build",
      lifecycleState: "RUNNING",
      model: {
        resolved: "claude-3-5-sonnet",
        provenance: "route-attributed",
      },
    });
    writeFileSync(join(dir, "status.json"), JSON.stringify(status), "utf8");
    // Leave journal unparseable
    writeFileSync(join(dir, "journal.jsonl"), "INVALID_JSON_CORRUPT\n", "utf8");

    // Reading status with default options should read status without failing on corrupt journal
    const lines = await statusCommand(dir);
    assert.ok(lines.length > 0);
    assert.ok(lines.some((l) => l.includes("State: RUNNING")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B9-42: readClosureSnapshot memoizes repeated reads of the same commit", () => {
  let callCount = 0;
  const fakeGit = (argv: readonly string[]) => {
    callCount += 1;
    if (argv[0] === "show" && argv[1]?.endsWith(":awsf.project.yaml")) {
      return {
        status: 0,
        stdout: "version: awsf.project/v1\nproject:\n  slug: demo\nrepositories:\n  r:\n    role: plan\n    default_branch: main\nplans:\n  root: specs\n  format: awsf-plan-html/v1\n",
        stderr: "",
      };
    }
    if (argv[0] === "ls-tree") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  const sha = "a".repeat(40);
  const snap1 = readClosureSnapshot(fakeGit as any, sha);
  const callsAfterFirst = callCount;
  const snap2 = readClosureSnapshot(fakeGit as any, sha);
  assert.equal(callCount, callsAfterFirst, "second readClosureSnapshot should make zero additional git calls");
  assert.equal(snap1, snap2, "repeated readClosureSnapshot on same commit SHA should return cached snapshot");
});
