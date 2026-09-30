// W19 task 7: the replay's pieces and its live mode, driven through an
// injected terminal and a stubbed transport. No test reaches the network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DelegateReplayNotInteractive, delegateReplayCommand } from "../../../src/cli/commands/delegate-replay.ts";
import type { JevOutcome } from "../../../src/decision/jev-transport.ts";
import { effectiveReplays, historicalStopIndices, journalPhases, UNRECORDED_ROUTE, type DelegateReplayRecord } from "../../../src/delegate/replay.ts";
import { readDelegateReplays } from "../../../src/persistence/delegate-replays.ts";
import { readTaskDecisions } from "../../../src/persistence/task-decisions.ts";
import { scanJournal } from "../../../src/persistence/replay.ts";
import type { AttemptEvent } from "../../../src/cli/commands/attempt.ts";
import { recordingTerminal, replayFixture } from "./_replay-fixture.ts";

const UNAVAILABLE = { outcome: "unavailable", reason: "missing-key", detail: "no key" } as unknown as JevOutcome;

test("replay: stops are the parked checkpoints and the transitions into AWAITING_OWNER or BLOCKED", async () => {
  const { stateRoot, attemptDirs } = await replayFixture();
  try {
    const scanned = await scanJournal<AttemptEvent>(join(attemptDirs[0]!, "journal.jsonl"));
    assert.ok(scanned.ok);
    assert.equal(historicalStopIndices(scanned.records).length, 3);
    const { config, roles } = journalPhases(scanned.records);
    assert.deepEqual(config.phases.map((phase) => [phase.id, phase.route]), [
      ["plan", "claude-code"], ["T01-build", "pi-codex"], ["T01-gates", null], ["T02-build", UNRECORDED_ROUTE], ["review", UNRECORDED_ROUTE],
    ]);
    assert.equal(roles.review, "reviewer");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("replay --live: refuses without an interactive owner, and a declined prompt writes nothing", async () => {
  const { stateRoot } = await replayFixture();
  try {
    await assert.rejects(delegateReplayCommand({ stateRoot, live: true, terminal: recordingTerminal(false, true).terminal }), DelegateReplayNotInteractive);
    const declined = recordingTerminal(true, false);
    const result = await delegateReplayCommand({ stateRoot, live: true, terminal: declined.terminal,
      transport: { ask: async () => { throw new Error("asked after a declined prompt"); } } });
    assert.equal(result.confirmed, false);
    assert.match(declined.prompts[0]!, /once for each of 5 historical stop/);
    assert.equal(existsSync(join(stateRoot, "delegate")), false);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("replay --live: one stop-judgment call per stop, decisions kept in the state root, and live wins over numbers-only", async () => {
  const { stateRoot, attemptDirs } = await replayFixture();
  try {
    await delegateReplayCommand({ stateRoot, live: false, terminal: recordingTerminal(false, false).terminal });
    let asked = 0;
    const live = await delegateReplayCommand({ stateRoot, live: true, terminal: recordingTerminal(true, true).terminal,
      transport: { ask: async () => { asked += 1; return UNAVAILABLE; } } });
    assert.equal(asked, 5);
    assert.equal(live.recorded.length, 5);
    assert.ok(live.recorded.every((record) => record.mode === "live" && record.decision.outcome === "unavailable"));
    // Live and unanswered: a ceiling raise waits for the owner, unlike numbers-only.
    assert.ok(live.recorded.some((record) => record.stopKind === "ceiling-pause" && record.proposal.rationale === "jev-unavailable"));
    const decisions = await readTaskDecisions(join(stateRoot, "delegate"));
    assert.equal(decisions.length, 5);
    assert.ok(decisions.every((decision) => decision.caller.kind === "replay"));
    for (const dir of attemptDirs) assert.equal(existsSync(join(dirname(dir), "decisions.jsonl")), false);
    const all = await readDelegateReplays(stateRoot);
    assert.equal(all.length, 10);
    assert.ok(effectiveReplays(all).every((record) => record.mode === "live"));
    assert.equal(effectiveReplays(all).length, 5);
    // A numbers-only rerun does not add over the live replays.
    const rerun = await delegateReplayCommand({ stateRoot, live: false, terminal: recordingTerminal(false, false).terminal });
    assert.equal(rerun.recorded.length, 0);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("replay: a stop that already has a live proposal is not replayed", async () => {
  const { stateRoot, attemptDirs } = await replayFixture();
  try {
    const first = await delegateReplayCommand({ stateRoot, live: false, terminal: recordingTerminal(false, false).terminal, project: "demo" });
    const sample = first.recorded.find((record) => record.taskId === "task-c")! as DelegateReplayRecord;
    rmSync(join(stateRoot, "delegate"), { recursive: true, force: true });
    const { appendTaskDelegateProposal } = await import("../../../src/persistence/task-delegate.ts");
    await appendTaskDelegateProposal(dirname(attemptDirs[2]!), {
      schema: "awsf.delegate-proposal/v1", type: "delegate.proposal", id: "p", project: "demo", taskId: "task-c", attempt: 1,
      sessionId: sample.sessionId, statusRevision: sample.statusRevision, at: sample.at, stopKind: sample.stopKind, edge: sample.edge,
      checkpointId: null, leased: false, decision: { recordId: null, outcome: "unavailable" }, proposal: sample.proposal,
      allowedActs: [], facts: sample.facts,
    });
    const second = await delegateReplayCommand({ stateRoot, live: false, terminal: recordingTerminal(false, false).terminal });
    assert.deepEqual([second.recorded.length, second.skipped], [4, 1]);
    assert.equal(readFileSync(join(dirname(attemptDirs[2]!), "delegate.jsonl"), "utf8").split("\n").filter(Boolean).length, 1);
    // --project filters by the state root's project directory.
    const other = await delegateReplayCommand({ stateRoot, live: false, project: "elsewhere", terminal: recordingTerminal(false, false).terminal });
    assert.deepEqual([other.recorded.length, other.pairs.length], [0, 0]);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
