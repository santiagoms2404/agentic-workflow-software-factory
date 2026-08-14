// The evidence a failed configured command is allowed to carry.
//
// The first test in the "the pilot's exact shape" section is the reason this
// file exists. Pilot 2 retained `output.slice(-4000)` of a `node --test` run
// that reported 240 total / 239 pass / 1 fail. The tail truthfully carried the
// totals and began in the middle of test 223, so the failing test's identity —
// the only thing needed to correct it — had already been discarded before
// anything asked for it. Every assertion below about the failure window exists
// to make that specific loss impossible to reintroduce.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EVIDENCE_BUDGET,
  boundCommandOutput,
  renderBoundedEvidence,
  renderCommandEvidence,
} from "../../../src/gates/command-evidence.ts";

/** A TAP run of `count` tests where exactly one fails, at `failAt` (one-based). */
function tapRun(count: number, failAt: number): string {
  const lines = ["TAP version 13"];
  for (let index = 1; index <= count; index += 1) {
    if (index === failAt) {
      lines.push(
        `not ok ${index} - the fusion pane keeps its scrollback across a resume`,
        "  ---",
        "  error: |-",
        "    Expected values to be strictly equal:",
        "    + actual - expected",
        "    + 'pane-2'",
        "    - 'pane-1'",
        "  code: 'ERR_ASSERTION'",
        "  ...",
      );
      continue;
    }
    lines.push(`ok ${index} - a passing assertion with a reasonably long descriptive name`);
  }
  lines.push(`1..${count}`, `# tests ${count}`, `# pass ${count - 1}`, `# fail 1`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The pilot's exact shape: a failure near the beginning, a long green tail.
// ---------------------------------------------------------------------------

test("a failure near the BEGINNING survives a long green tail — the pilot's exact loss", () => {
  const output = tapRun(240, 6);
  assert.ok(output.length > DEFAULT_EVIDENCE_BUDGET * 4, "the fixture must actually overflow the budget");

  // What the old shape did. Kept as a live assertion rather than a comment,
  // because "a trailing window loses this" is the claim the fix rests on.
  const trailingOnly = output.slice(-DEFAULT_EVIDENCE_BUDGET);
  assert.equal(trailingOnly.includes("not ok 6"), false);
  assert.ok(trailingOnly.includes("# fail 1"));

  const rendered = renderCommandEvidence(boundCommandOutput(output));
  assert.ok(rendered.includes("not ok 6"), "the failing test's identity must survive");
  assert.ok(rendered.includes("keeps its scrollback across a resume"), "so must its name");
  assert.ok(rendered.includes("+ 'pane-2'"), "and its diagnostic");
  // The totals still arrive, because the tail is kept as well as the failure.
  assert.ok(rendered.includes("# tests 240"));
  assert.ok(rendered.includes("# fail 1"));
});

test("the failure line is reported by number, so a reader can find the rest", () => {
  const evidence = boundCommandOutput(tapRun(240, 6));
  assert.equal(evidence.failureLine, 7, "line 1 is `TAP version 13`, then five passes, then the failure");
  assert.equal(evidence.complete, false);
  assert.ok(evidence.omittedChars > 0);
  assert.ok(renderCommandEvidence(evidence).includes("characters omitted"));
});

test("a failure at the END is kept too — the shape a trailing window happened to handle", () => {
  const rendered = renderCommandEvidence(boundCommandOutput(tapRun(240, 239)));
  assert.ok(rendered.includes("not ok 239"));
  assert.ok(rendered.includes("# fail 1"));
});

test("a failure in the MIDDLE is kept, which neither a head nor a tail alone would do", () => {
  const output = tapRun(400, 200);
  assert.equal(output.slice(0, DEFAULT_EVIDENCE_BUDGET).includes("not ok 200"), false);
  assert.equal(output.slice(-DEFAULT_EVIDENCE_BUDGET).includes("not ok 200"), false);
  assert.ok(renderCommandEvidence(boundCommandOutput(output)).includes("not ok 200"));
});

// ---------------------------------------------------------------------------
// Bounds.
// ---------------------------------------------------------------------------

test("output that fits is kept whole and says so", () => {
  const output = tapRun(3, 2);
  const evidence = boundCommandOutput(output);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.head, output);
  assert.equal(evidence.omittedChars, 0);
  // A complete rendering is the output itself — no labels a reader would have
  // to mentally strip back out.
  assert.equal(renderCommandEvidence(evidence), output);
});

test("the three windows never exceed the budget, and the render never exceeds its ceiling", () => {
  for (const budget of [200, 1_000, DEFAULT_EVIDENCE_BUDGET]) {
    const evidence = boundCommandOutput(tapRun(400, 12), { budget });
    const kept = evidence.head.length + evidence.failure.length + evidence.tail.length;
    assert.ok(kept <= budget, `windows totalled ${kept} against a budget of ${budget}`);
    const rendered = renderBoundedEvidence(tapRun(400, 12), budget);
    assert.ok(rendered.length <= budget, `render was ${rendered.length} against a ceiling of ${budget}`);
  }
});

test("the failure window is taken FIRST, so a tight budget squeezes the ends and not the cause", () => {
  const evidence = boundCommandOutput(tapRun(400, 12), { budget: 600 });
  assert.ok(evidence.failure.includes("not ok 12"));
  assert.ok(evidence.failure.length >= evidence.head.length);
});

test("output with no failure shape is split between the two ends", () => {
  const output = Array.from({ length: 2_000 }, (_, index) => `line ${String(index)} of quiet progress`).join("\n");
  const evidence = boundCommandOutput(output);
  assert.equal(evidence.failureLine, null);
  assert.equal(evidence.failure, "");
  assert.ok(evidence.head.startsWith("line 0 "));
  assert.ok(evidence.tail.endsWith("of quiet progress"));
  assert.ok(evidence.head.length > 0 && evidence.tail.length > 0);
});

// ---------------------------------------------------------------------------
// What may not leave the host.
// ---------------------------------------------------------------------------

test("credential-shaped bytes are scrubbed out of every window", () => {
  const secret = `sk-${"a".repeat(40)}`;
  const noisy = [
    `starting with ${secret}`,
    ...Array.from({ length: 500 }, (_, index) => `ok ${String(index)} - filler`),
    `not ok 501 - the request carried ${secret}`,
    ...Array.from({ length: 500 }, (_, index) => `ok ${String(index + 502)} - filler`),
    `done with ${secret}`,
  ].join("\n");
  const rendered = renderCommandEvidence(boundCommandOutput(noisy));
  assert.equal(rendered.includes(secret), false, "a credential reached the model's prompt");
  assert.ok(rendered.includes("[REDACTED]"));
});

test("markers recognize the runners this harness actually gates on", () => {
  // Deliberately a list of shapes, not a parser: finding WHERE to cut is a much
  // weaker claim than understanding what was cut, and it is the only claim this
  // module makes.
  const shapes = [
    "not ok 12 - a node:test failure",
    "FAIL src/thing.test.ts",
    "  ✗ a mocha-style failure",
    "  1) a numbered failure",
    "AssertionError [ERR_ASSERTION]: mismatch",
    "Error: something threw",
  ];
  for (const shape of shapes) {
    const output = [
      ...Array.from({ length: 400 }, (_, index) => `ok ${String(index)} - filler filler filler filler`),
      shape,
      ...Array.from({ length: 400 }, (_, index) => `ok ${String(index + 401)} - filler filler filler filler`),
    ].join("\n");
    const evidence = boundCommandOutput(output);
    assert.notEqual(evidence.failureLine, null, `unrecognized failure shape: ${shape}`);
    assert.ok(evidence.failure.includes(shape.trim()), `failure window missed: ${shape}`);
  }
});

test("the same bytes always produce the same evidence", () => {
  const output = tapRun(300, 44);
  assert.deepEqual(boundCommandOutput(output), boundCommandOutput(output));
});
