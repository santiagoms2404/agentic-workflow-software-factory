// W19 task 7 journey: a synthetic state root with five historical stops and
// the acts that followed them replays offline (numbers-only) into five pairs
// with the expected agreement. It writes only the state root's delegate/,
// never an attempt directory, and makes no network call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { delegateReplayCommand } from "../../src/cli/commands/delegate-replay.ts";
import { autonomyFor } from "../../src/delegate/autonomy.ts";
import { readReplayPairs } from "../../src/delegate/pairs.ts";
import { readDelegateReplays, replaysFilePath } from "../../src/persistence/delegate-replays.ts";
import { recordingTerminal, replayFixture } from "../unit/delegate/_replay-fixture.ts";

function snapshot(dirs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of dirs) {
    for (const root of [dir, dirname(dir)]) {
      for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (name.endsWith(".jsonl") || name.endsWith(".json")) out.set(path, readFileSync(path, "utf8"));
      }
    }
  }
  return out;
}

test("replay journey: five historical stops become five pairs with the expected agreement, offline", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("the offline replay made a network call"); });
  const { stateRoot, attemptDirs } = await replayFixture();
  try {
    const before = snapshot(attemptDirs);
    const { terminal, lines, prompts } = recordingTerminal(false, false);
    const result = await delegateReplayCommand({ stateRoot, live: false, terminal, now: () => "2026-09-30T00:00:00Z" });

    assert.equal(result.mode, "numbers-only");
    assert.equal(result.recorded.length, 5);
    assert.deepEqual(prompts, [], "the numbers-only replay asks the owner nothing");
    const byStop = result.pairs
      .map((pair) => [pair.taskId, pair.proposedAct, pair.observedAct, pair.outcome, pair.source])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    assert.deepEqual(byStop, [
      ["task-a", "raise", "raise", "match", "replay"],
      ["task-a", "wait-for-owner", "resume", "none", "replay"],
      ["task-a", "raise", "cancel", "mismatch", "replay"],
      ["task-b", "land-shadow", "land", "match", "replay"],
      ["task-c", "wait-for-owner", null, "none", "replay"],
    ]);
    assert.deepEqual(result.recorded.map((record) => record.proposal.rationale).sort(),
      ["blocked-needs-owner", "ceiling-short", "ceiling-short", "numbers-only", "review-accepted"]);
    assert.ok(lines.includes("raise: match 1, mismatch 1, none 0"));
    assert.ok(lines.includes("land-shadow: match 1, mismatch 0, none 0"));
    assert.ok(lines.includes("wait-for-owner: match 0, mismatch 0, none 2"));

    // Output lives in the state root only; no attempt or task file moved or appeared.
    assert.equal((await readDelegateReplays(stateRoot)).length, 5);
    assert.ok(existsSync(replaysFilePath(stateRoot)));
    assert.deepEqual(snapshot(attemptDirs), before);
    for (const dir of attemptDirs) {
      assert.equal(existsSync(join(dirname(dir), "decisions.jsonl")), false);
      assert.equal(existsSync(join(dirname(dir), "delegate.jsonl")), false);
    }
    // Each record is stamped with its stop's journal time, not the replay's.
    assert.ok(result.recorded.every((record) => record.at !== record.replayedAt));

    // Replay pairs reach autonomy with their source kept.
    const pairs = await readReplayPairs(stateRoot, "demo", dirname(attemptDirs[0]!));
    assert.equal(pairs.length, 3);
    assert.deepEqual(autonomyFor("raise", pairs, "earned").sources, { live: 0, replay: 2 });

    // A second offline replay records nothing new and reports the same agreement.
    const again = await delegateReplayCommand({ stateRoot, live: false, terminal: recordingTerminal(false, false).terminal });
    assert.deepEqual([again.recorded.length, again.skipped, again.pairs.length], [0, 5, 5]);
    assert.equal((await readDelegateReplays(stateRoot)).length, 5);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
