import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newCommand } from "../../../src/cli/commands/new.ts";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { journalFilePath } from "../../../src/persistence/platform-paths.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { buildTrapsReadout, readTrapsReadout, transitionAt } from "../../../src/traps/readout.ts";

const PRE = "2026-10-07T12:00:00.000Z";
const POST = "2026-10-08T12:00:00.000Z";
const LATER = "2026-10-09T12:00:00.000Z";
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

function writeEvents(path: string, events: readonly AttemptEvent[]) {
  writeFileSync(path, events.map((event, index) => JSON.stringify({ source_seq: index + 1, recorded_at: POST, event })).join("\n") + "\n");
}

function gate(status: AttemptStatus, candidateSha: string, ok: boolean, item = "traps:synthetic"): AttemptEvent {
  return { kind: "attempt.updated", next: status, evidence: { type: "gate", id: "synthetic-gate", phaseId: "gate",
    round: 1, gateId: "commands_pass", kind: "subprocess", candidateSha, passed: !ok, exitCode: 0,
    checks: [{ item, ok, note: "synthetic" }], violations: [], outputPath: null, startedAt: PRE, endedAt: PRE } };
}

function transition(status: AttemptStatus, at: string): AttemptEvent {
  return { kind: "attempt.transitioned", next: status, evidence: { type: "transition", id: "synthetic-transition",
    seq: 1, from: "DRAFT", to: status.lifecycleState, actor: "host", edgeId: "synthetic", reasonSource: "human",
    reasonCode: null, reasonDetail: "synthetic", spawnSite: false, at } };
}

async function syntheticRoot() {
  const root = mkdtempSync(join(tmpdir(), "awsf-traps-facts-"));
  const stateRoot = join(root, "state");
  try {
    await writePlacement(stateRoot, "awsf", { version: "awsf.placement/v1", project: "awsf", repositories: { main: { path: root } } });
    const created = await newCommand({ stateRoot, project: "awsf", taskId: "synthetic", repository: root,
      request: "synthetic readout facts", workflow: "build", tier: 1, now: () => PRE, sessionId: () => "synthetic-session" });
    return { root, stateRoot, status: created.status, taskRoot: join(stateRoot, "projects", "awsf", "tasks", "synthetic"),
      close: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("readTrapsReadout hands only reduced facts to its builder across synthetic journals", async () => {
  const box = await syntheticRoot();
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const dir = join(box.taskRoot, String(attempt));
      mkdirSync(dir, { recursive: true });
      const lifecycleState = (["BLOCKED", "CANCELLED", "LANDED", "PUBLISHED"] as const)[attempt - 1]!;
      const status = { ...box.status, attempt, lifecycleState, candidateSha: SHA, lastActivityAt: LATER };
      const landed = { ...status, lifecycleState: "LANDED" as const };
      const events: AttemptEvent[] = [transition(attempt === 4 ? landed : status, attempt === 3 ? LATER : PRE)];
      // A legacy CANCELLED transition must use its own stamp, not its status activity.
      if (attempt === 2) events.push({ kind: "attempt.transitioned", next: status });
      if (attempt === 4) events.push(transition(status, LATER));
      // Irrelevant history is deliberately large, but never survives into AttemptFacts.
      for (let index = 0; index < 100; index++) events.push({ kind: "attempt.updated", next: { ...status,
        lastActivity: `discarded-history-${index}-${"x".repeat(4096)}` } });
      events.push(gate(status, SHA, false), gate(status, SHA, true), gate(status, OTHER, false));
      if (attempt === 4) events.push(gate(status, SHA, true, "unit:synthetic"));
      // Final SHA is learned only after all the gate rows, and need not match the newest gate.
      events.push({ kind: "attempt.updated", next: status });
      writeEvents(journalFilePath(dir), events);
    }
    let builderCalls = 0;
    const model = await readTrapsReadout(box.stateRoot, (projects, attempts) => {
      builderCalls++;
      assert.deepEqual(projects, ["awsf"]);
      assert.equal(attempts.length, 4);
      for (const facts of attempts) {
        assert.deepEqual(Object.keys(facts).sort(), ["attribution", "landedAt", "status", "terminalAt", "traps"]);
        assert.equal(Object.hasOwn(facts, "events"), false);
        assert.equal(Object.hasOwn(facts, "records"), false);
        assert.equal(JSON.stringify(facts).includes("discarded-history-"), false);
        assert.deepEqual(Object.keys(facts.traps).sort(), ["passed", "sha"]);
      }
      assert.deepEqual(attempts.map(facts => facts.terminalAt), [PRE, POST, null, null]);
      assert.deepEqual(attempts.map(facts => facts.landedAt), [null, null, LATER, PRE]);
      assert.deepEqual(attempts.map(facts => facts.traps), [
        { passed: true, sha: SHA }, { passed: true, sha: SHA }, { passed: true, sha: SHA }, { passed: null, sha: null },
      ]);
      return buildTrapsReadout(projects, attempts);
    });
    assert.equal(builderCalls, 1);
    assert.equal(model.stops.total, 1);
    assert.equal(model.stops.unlinked[0]?.terminalAt, POST);
    assert.equal(model.projects[0]?.newestLanded?.attempt, 3);
    assert.deepEqual(model.projects[0]?.newestLanded?.traps, { passed: true, sha: SHA });
  } finally { box.close(); }
});

test("transitionAt keeps last-transition evidence, matching journal stamp fallback and no activity fallback", async () => {
  const box = await syntheticRoot();
  try {
    const status = { ...box.status, lifecycleState: "BLOCKED" as const, lastActivityAt: LATER };
    assert.equal(transitionAt([transition(status, PRE)], "BLOCKED"), PRE);
    assert.equal(transitionAt([transition(status, PRE), { kind: "attempt.transitioned", next: status, recordedAt: POST }], "BLOCKED"), POST);
    const mismatched = transition(status, PRE);
    assert.equal(mismatched.evidence?.type, "transition");
    if (mismatched.evidence?.type !== "transition") assert.fail("synthetic transition evidence");
    assert.equal(transitionAt([{ ...mismatched, evidence: { ...mismatched.evidence, to: "CANCELLED" }, recordedAt: POST }], "BLOCKED"), POST);
    assert.equal(transitionAt([{ kind: "attempt.transitioned", next: status }], "BLOCKED"), null);
    assert.equal(transitionAt([{ kind: "attempt.updated", next: status, recordedAt: POST }], "BLOCKED"), null);
  } finally { box.close(); }
});

test("a corrupt journal still fails before building and leaves its bytes unchanged", async () => {
  const box = await syntheticRoot();
  try {
    const path = journalFilePath(join(box.taskRoot, "1"));
    writeFileSync(path, JSON.stringify({ source_seq: 2, recorded_at: POST, event: { kind: "attempt.updated", next: box.status } }) + "\n");
    const before = readFileSync(path);
    await assert.rejects(readTrapsReadout(box.stateRoot, () => assert.fail("corrupt journals must not reach the builder")), /attempt journal corrupt at .*source_seq/);
    assert.deepEqual(readFileSync(path), before);
  } finally { box.close(); }
});
