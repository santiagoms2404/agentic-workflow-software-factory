// B10-01: gate output must be scrubbed before it is clipped.
//
// The bounded evidence used to clip each window first and scrub it second. A
// credential that straddled a clip edge was cut into a fragment no credential
// pattern recognises — `ghp_` plus eleven characters at the head edge, or the
// bare body with no prefix at the tail edge — and that fragment reached
// `TestOutput.outputTail` and the reviewer prompt. Every case below places a
// token across a clip edge and asserts that no piece of it survives.
//
// Inv 9: no credential-shaped literal appears in this file. The token is built
// at run time from parts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boundCommandOutput, renderCommandEvidence } from "../../../src/gates/command-evidence.ts";

const BODY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

/** A 40-character GitHub-shaped token whose body never occurs in the lowercase filler. */
function runtimeToken(): string {
  const body = Array.from({ length: 36 }, (_, index) => BODY_ALPHABET[(index * 7 + 3) % BODY_ALPHABET.length]).join("");
  return "gh" + "p_" + body;
}

/** Lowercase, marker-free filler, so any uppercase-or-digit run in the evidence came from the token. */
function filler(length: number): string {
  return "ok - pass\n".repeat(Math.ceil(length / 10)).slice(0, length);
}

/** Overwrites `length(token)` characters at `at`, so the total length and every other offset stay put. */
function plant(output: string, token: string, at: number): string {
  return output.slice(0, at) + token + output.slice(at + token.length);
}

/** Every eight-character piece of the token, prefix and clipped tail alike. */
function fragments(token: string): string[] {
  const pieces: string[] = [];
  for (let start = 0; start + 8 <= token.length; start += 1) pieces.push(token.slice(start, start + 8));
  return pieces;
}

function outputTail(output: string): string {
  // The exact composition production-run.ts uses to build TestOutput.outputTail.
  return renderCommandEvidence(boundCommandOutput(output));
}

function assertNoFragment(rendered: string, token: string): void {
  assert.equal(rendered.includes(token), false, "the whole token reached outputTail");
  const leaked = fragments(token).filter((piece) => rendered.includes(piece));
  assert.deepEqual(leaked, [], "a clipped piece of the token reached outputTail");
}

/** A TAP-ish output with one failure marker in the middle, far from both clip edges. */
function markedOutput(): string {
  const before = filler(4_000);
  const failure = "\nnot ok 7 - the pane keeps its scrollback\n  error: expected pane-1\n";
  return before + failure + filler(6_000 - failure.length);
}

test("no-marker path: a token straddling the head clip edge never appears in outputTail", () => {
  const token = runtimeToken();
  // The finding's scenario: 9999 characters, token at 1985, head clipped at 2000.
  const output = plant(filler(9_999), token, 1_985);
  assertNoFragment(outputTail(output), token);
});

test("no-marker path: a token whose prefix sits just before the tail window never leaks its body", () => {
  const token = runtimeToken();
  const total = 9_999;
  const tailStart = total - (4_000 - Math.floor(4_000 / 2));
  const output = plant(filler(total), token, tailStart - 4);
  assertNoFragment(outputTail(output), token);
});

test("marker path (:190-192): a token straddling the head clip edge never appears in outputTail", () => {
  const token = runtimeToken();
  const clean = markedOutput();
  // Where the head window ends for an output of this shape and length.
  const headEdge = boundCommandOutput(clean).head.length;
  assert.ok(headEdge > 100 && headEdge < 3_900, "the head edge lies away from the failure marker");
  const output = plant(clean, token, headEdge - 15);
  const bounded = boundCommandOutput(output);
  assert.notEqual(bounded.failureLine, null, "the output took the failure-marker path");
  assertNoFragment(renderCommandEvidence(bounded), token);
});

test("marker path (:190-192): a token straddling the tail clip edge never leaks its body", () => {
  const token = runtimeToken();
  const clean = markedOutput();
  const tailStart = clean.length - boundCommandOutput(clean).tail.length;
  assert.ok(tailStart > 4_100, "the tail edge lies away from the failure marker");
  const output = plant(clean, token, tailStart - 4);
  const bounded = boundCommandOutput(output);
  assert.notEqual(bounded.failureLine, null, "the output took the failure-marker path");
  assertNoFragment(renderCommandEvidence(bounded), token);
});

test("windows and counts describe the scrubbed output the reader is shown", () => {
  const token = runtimeToken();
  const output = plant(filler(9_999), token, 1_985);
  const bounded = boundCommandOutput(output);
  assert.equal(bounded.head.includes("[REDACTED]"), true, "the redaction lands inside the head window");
  assert.equal(
    bounded.totalChars - bounded.omittedChars,
    bounded.head.length + bounded.failure.length + bounded.tail.length,
    "omitted plus kept accounts for every character of the scrubbed output",
  );
});
