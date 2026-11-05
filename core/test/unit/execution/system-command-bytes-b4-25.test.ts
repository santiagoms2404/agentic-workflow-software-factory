// B4-25: a command's output reaches a byte reader exactly as the command wrote
// it. The text path decodes stdout as UTF-8, which replaces every byte that is
// not UTF-8 with U+FFFD, so a blob read that re-encodes that text hashes bytes
// the author never wrote. Tests may spawn; the child here is this test's own
// Node binary writing a fixed byte sequence.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runSystemCommand } from "../../../src/execution/transport-broker.ts";

// 0x93 is a Windows-1252 left double quotation mark: a lone continuation byte, not UTF-8.
const WRITTEN = [0x93, 0x41, 0x0a];

function writeBytes(bytes: readonly number[]): readonly string[] {
  return ["-e", `process.stdout.write(Buffer.from(${JSON.stringify(bytes)}))`];
}

test("the latin1 encoding returns the bytes a command wrote, including bytes that are not UTF-8", () => {
  const result = runSystemCommand(process.execPath, writeBytes(WRITTEN), { timeoutMs: 10_000, encoding: "latin1" });
  assert.equal(result.status, 0);
  assert.equal(result.error, null);
  assert.deepEqual([...Buffer.from(result.stdout, "latin1")], WRITTEN);
});

test("the latin1 encoding is lossless for every byte value", () => {
  const every = Array.from({ length: 256 }, (_, byte) => byte);
  const result = runSystemCommand(process.execPath, writeBytes(every), { timeoutMs: 10_000, encoding: "latin1" });
  assert.equal(result.status, 0);
  assert.deepEqual([...Buffer.from(result.stdout, "latin1")], every);
});

test("the text path keeps decoding stdout, and that decoding is the lossy step the byte path avoids", () => {
  const result = runSystemCommand(process.execPath, writeBytes(WRITTEN), { timeoutMs: 10_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "�A\n");
});

test("the latin1 encoding reports a command that cannot be run at all, with no output", () => {
  const result = runSystemCommand("/nonexistent/awsf-b4-25", [], { timeoutMs: 1_000, encoding: "latin1" });
  assert.equal(result.status, null);
  assert.equal(result.stdout, "");
  assert.match(result.error ?? "", /ENOENT/u);
});
