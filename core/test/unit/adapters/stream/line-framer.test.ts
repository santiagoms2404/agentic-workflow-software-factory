// The framer: bytes a child chose the boundaries of become lines.
//
// Everything here is a boundary condition, because that is all this class is.
// A child hands over whatever the pipe had ready, which means every one of these
// cases happens in production and none of them happens on a good day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LineFramer, frameLines } from "../../../../src/adapters/stream/line-framer.ts";

const encoder = new TextEncoder();

/** Delivers `text` the way a child does: in fixed-size byte chunks, not lines. */
function inChunks(text: string, size: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.subarray(at, at + size));
  return chunks;
}

function drain(framer: LineFramer, chunks: readonly (Uint8Array | string)[]): string[] {
  const lines: string[] = [];
  for (const chunk of chunks) lines.push(...framer.push(chunk));
  lines.push(...framer.flush());
  return lines;
}

test("a chunk with no newline releases nothing and carries the bytes forward", () => {
  const framer = new LineFramer();
  assert.deepEqual([...framer.push("half a li")], []);
  assert.equal(framer.hasPending, true);
  assert.deepEqual([...framer.push("ne\n")], ["half a line"]);
  assert.equal(framer.hasPending, false);
});

test("a chunk boundary inside a multi-byte code point is carried, not corrupted", () => {
  // Four bytes, one code point, split down the middle of it.
  const bytes = encoder.encode("a🙂b\n");
  const framer = new LineFramer();
  assert.deepEqual([...framer.push(bytes.subarray(0, 3))], []);
  assert.deepEqual([...framer.push(bytes.subarray(3))], ["a🙂b"]);
});

test("every byte-level delivery of the same stream frames identically", () => {
  // The property the class exists for: the lines a run produces must not depend
  // on where the kernel happened to cut the pipe.
  const stream = "héllo wörld\n{\"emoji\":\"🙂🚀\"}\nplain\n";
  const expected = ["héllo wörld", '{"emoji":"🙂🚀"}', "plain"];
  for (let size = 1; size <= encoder.encode(stream).length; size += 1) {
    assert.deepEqual(drain(new LineFramer(), inChunks(stream, size)), expected, `chunk size ${size}`);
  }
});

test("the decoder is PER INSTANCE — two concurrent runs never share a half-read code point", () => {
  // The failure this prevents: one module-level decoder, two runs, and run B's
  // first chunk completing the code point run A was in the middle of. Both
  // framers here are mid-code-point at the same time, interleaved.
  const first = encoder.encode("A🙂\n");
  const second = encoder.encode("B🚀\n");
  const a = new LineFramer();
  const b = new LineFramer();

  assert.deepEqual([...a.push(first.subarray(0, 3))], []);
  assert.deepEqual([...b.push(second.subarray(0, 3))], []);
  assert.deepEqual([...a.push(first.subarray(3))], ["A🙂"]);
  assert.deepEqual([...b.push(second.subarray(3))], ["B🚀"]);
});

test("an abrupt EOF releases the unterminated tail as a line, visibly", () => {
  // A provider killed mid-write leaves a half-written line. Dropping it would
  // erase the only evidence of what it was doing when it died.
  const framer = new LineFramer();
  assert.deepEqual([...framer.push('{"type":"text","text":"half a re')], []);
  assert.deepEqual([...framer.flush()], ['{"type":"text","text":"half a re']);
  // Flushing again releases nothing: the tail was handed over, not copied.
  assert.deepEqual([...framer.flush()], []);
});

test("a flush with nothing pending releases nothing at all", () => {
  const framer = new LineFramer();
  assert.deepEqual([...framer.push("done\n")], ["done"]);
  assert.deepEqual([...framer.flush()], []);
});

test("a dangling partial code point survives EOF as a visible replacement character", () => {
  // Half a code point cannot be decoded, and the alternative to U+FFFD is
  // silence. A visible malformed line is the whole point.
  const framer = new LineFramer();
  const bytes = encoder.encode("tail🙂");
  assert.deepEqual([...framer.push(bytes.subarray(0, bytes.length - 2))], []);
  const tail = [...framer.flush()];
  assert.equal(tail.length, 1);
  assert.ok(tail[0]?.startsWith("tail"), `the readable part survives: ${JSON.stringify(tail[0])}`);
  assert.ok(tail[0]?.includes("�"), "and the unreadable part is visible rather than dropped");
});

test("empty lines are preserved, not collapsed", () => {
  // A provider writing a blank line said something; the decoder above decides
  // what to do about it, and it cannot decide about a line it never saw.
  assert.deepEqual([...new LineFramer().push("a\n\nb\n")], ["a", "", "b"]);
});

test("string and byte pushes interleave without disturbing the decoder", () => {
  const framer = new LineFramer();
  const bytes = encoder.encode("wörld\n");
  assert.deepEqual([...framer.push("hello ")], []);
  assert.deepEqual([...framer.push(bytes.subarray(0, 2))], []);
  assert.deepEqual([...framer.push(bytes.subarray(2))], ["hello wörld"]);
});

test("bytes are counted for the liveness monitor, which is never shown content", () => {
  // `noteOutput` takes a COUNT and refuses to see bytes; the framer is the one
  // stage already touching all of them. It counts UTF-8 bytes for a string push
  // too, so a caller that already decoded does not silently report fewer.
  const framer = new LineFramer();
  framer.push(encoder.encode("héllo\n")); // 6 code points, 7 bytes
  framer.push("wörld"); // 5 code points, 6 bytes
  assert.equal(framer.bytes, 13);
});

test("frameLines is the whole-string entry point and agrees with the incremental one", () => {
  const stream = "one\ntwo\nthree";
  assert.deepEqual([...frameLines(stream)], ["one", "two", "three"]);
  assert.deepEqual(drain(new LineFramer(), inChunks(stream, 2)), [...frameLines(stream)]);
});

test("the framer bounds nothing — it takes no budget and refuses no line", () => {
  // Framing reads PAST the output budget on purpose, so a run that overruns it
  // can still observe its own terminal. A framer that could be constructed with
  // a limit would be a framer somebody could later teach to stop early.
  assert.equal(LineFramer.length, 0, "LineFramer's constructor takes no options");

  const lines = drain(new LineFramer(), [`${"x".repeat(200_000)}\n`, "terminal\n"]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.length, 200_000);
  assert.equal(lines[1], "terminal", "the terminal line is still readable behind an enormous one");
});
