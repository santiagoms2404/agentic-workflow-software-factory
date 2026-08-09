import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";

const bytes = (path: string): string => readFileSync(path, "utf8");

test("doctor reports an injected orphan by PID with exit 1 and changes no durable bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-sim-"));
  try {
    const stateRoot = join(root, "state");
    const output: string[] = [];
    assert.equal(await main({ argv: ["doctor", "--state-root", stateRoot], writeOut: (line) => output.push(line) }), 0);
    const created = await newCommand({
      stateRoot, project: "project", taskId: "T22", repository: root, request: "doctor simulation",
      workflow: "simple-sdlc", tier: 1, sessionId: () => "doctor-simulation", now: () => "2026-08-08T00:00:00.000Z",
    });
    const terminal = nextRevision(created.status, {
      lifecycleState: "CANCELLED",
      process: { pid: process.pid, pgid: process.pid, startIdentity: null, startIdentitySource: "test" },
    });
    await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.updated", next: terminal });
    const journal = join(created.attemptDir, "journal.jsonl");
    const status = join(created.attemptDir, "status.json");
    const before = [bytes(journal), bytes(status)];
    output.length = 0;
    assert.equal(await main({ argv: ["doctor", "--state-root", stateRoot], writeOut: (line) => output.push(line) }), 1);
    assert.ok(output.some((line) => line.includes(`orphan pid ${process.pid}`)));
    assert.deepEqual([bytes(journal), bytes(status)], before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
