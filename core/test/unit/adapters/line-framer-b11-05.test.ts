// B11-05: push() must not scan the accumulated pending buffer for newline
//
// When a long line arrives across multiple chunks without newlines, scanning the
// full pending buffer on every chunk results in quadratic O(n^2) scanning time.
// Checking only the incoming chunk avoids rescanning previously buffered text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LineFramer } from "../../../src/adapters/stream/line-framer.ts";

test("B11-05: push() checks incoming chunk for newline rather than scanning entire pending buffer", () => {
  const framer = new LineFramer();
  const chunk1 = "x".repeat(1000);
  const chunk2 = "y".repeat(1000);

  framer.push(chunk1);

  // Monitor string searches during second push
  const searchedLengths: number[] = [];
  const originalIncludes = String.prototype.includes;
  String.prototype.includes = function (this: string, searchString: string, position?: number) {
    if (searchString === "\n") {
      searchedLengths.push(this.length);
    }
    return originalIncludes.call(this, searchString, position);
  };

  try {
    framer.push(chunk2);
  } finally {
    String.prototype.includes = originalIncludes;
  }

  assert.equal(searchedLengths.length, 1, "exactly one newline search expected");
  // Before fix: searchedLengths[0] is 2000 (accumulated #pending).
  // After fix: searchedLengths[0] is 1000 (incoming chunk text).
  assert.equal(
    searchedLengths[0],
    chunk2.length,
    `expected newline check on incoming chunk (length ${chunk2.length}), got searched length ${searchedLengths[0]}`,
  );
});

test("B11-05: LineFramer correctly frames lines across multiple chunks without quadratic overhead", () => {
  const framer = new LineFramer();
  const part1 = "hello ";
  const part2 = "world\nnext line";

  const lines1 = framer.push(part1);
  assert.deepEqual(lines1, []);
  assert.equal(framer.hasPending, true);

  const lines2 = framer.push(part2);
  assert.deepEqual(lines2, ["hello world"]);
  assert.equal(framer.hasPending, true);

  const lines3 = framer.flush();
  assert.deepEqual(lines3, ["next line"]);
  assert.equal(framer.hasPending, false);
});

test("B11-05: LineFramer handles Uint8Array chunks and multiple newlines in chunk", () => {
  const framer = new LineFramer();
  const encoder = new TextEncoder();

  const lines1 = framer.push(encoder.encode("alpha"));
  assert.deepEqual(lines1, []);

  const lines2 = framer.push(encoder.encode("beta\ngamma\ndelta"));
  assert.deepEqual(lines2, ["alphabeta", "gamma"]);
  assert.equal(framer.hasPending, true);

  const lines3 = framer.flush();
  assert.deepEqual(lines3, ["delta"]);
});

test("B11-05: triangulation: empty chunks and multiple chunks without newlines", () => {
  const framer = new LineFramer();

  assert.deepEqual(framer.push(""), []);
  assert.deepEqual(framer.push(new Uint8Array(0)), []);
  assert.equal(framer.hasPending, false);

  for (let i = 0; i < 5; i++) {
    assert.deepEqual(framer.push(`chunk${i}`), []);
  }
  assert.equal(framer.hasPending, true);

  const closed = framer.push("\n");
  assert.deepEqual(closed, ["chunk0chunk1chunk2chunk3chunk4"]);
  assert.equal(framer.hasPending, false);
});

test("B11-05: triangulation: chunk starting with newline closes previous pending immediately", () => {
  const framer = new LineFramer();

  assert.deepEqual(framer.push("prefix"), []);
  const closed = framer.push("\nsuffix\nsecond-suffix");
  assert.deepEqual(closed, ["prefix", "suffix"]);
  assert.equal(framer.hasPending, true);
  assert.deepEqual(framer.flush(), ["second-suffix"]);
});
