import assert from "node:assert/strict";
import { test } from "node:test";
import { visualReferencesInspected, type PhaseVisualObservation } from "../../../src/gates/visual-inspection.ts";

const FRAMES = [{ id: "15a", sha256: "a".repeat(64) }, { id: "15b", sha256: "b".repeat(64) }];

function seen(phaseId: string, sha: string, outcome: "ok" | "error" = "ok", toolCallId = "t1"): PhaseVisualObservation {
  return { phaseId, toolCallId, toolName: "Read", outcome, mediaType: "image/png", bytes: 100, sha256: sha, frameId: null };
}

test("passes only when every bound frame came back from this phase's own image tool", () => {
  const report = visualReferencesInspected({ phaseId: "s:builder", frames: FRAMES,
    observations: [seen("s:builder", "a".repeat(64)), seen("s:builder", "b".repeat(64), "ok", "t2")] });
  assert.equal(report.passed, true);
  assert.equal(report.gateId, "visual_references_inspected");
  assert.match(report.checks.at(-1)!.note, /never the quality of the visual judgment/);
});

test("fails closed on each way inspection can be absent or wrong", () => {
  const cases: readonly [string, readonly PhaseVisualObservation[], RegExp][] = [
    ["no image at all", [], /frame 15a opened/],
    ["incomplete inspection", [seen("s:builder", "a".repeat(64))], /frame 15b opened/],
    ["the wrong image", [seen("s:builder", "a".repeat(64)), seen("s:builder", "c".repeat(64))], /frame 15b opened/],
    ["a failed tool call", [seen("s:builder", "a".repeat(64)), seen("s:builder", "b".repeat(64), "error")], /frame 15b opened/],
    ["evidence from the wrong phase", [seen("s:reviewer", "a".repeat(64)), seen("s:reviewer", "b".repeat(64))], /frame 15a opened/],
  ];
  for (const [name, observations, failing] of cases) {
    const report = visualReferencesInspected({ phaseId: "s:builder", frames: FRAMES, observations });
    assert.equal(report.passed, false, name);
    assert.ok(report.checks.some((check) => !check.ok && failing.test(check.item)), `${name}: ${JSON.stringify(report.checks)}`);
    assert.ok(report.checks.filter((check) => !check.ok).every((check) => /read tool|no successful image/.test(check.note)), `${name} names the remedy`);
  }
});
