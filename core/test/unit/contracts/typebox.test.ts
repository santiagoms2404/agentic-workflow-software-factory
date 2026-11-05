import assert from "node:assert/strict";
import { test } from "node:test";
import { utf8ByteLength } from "../../../src/contracts/typebox.ts";

test("UTF-8 byte length matches the host byte buffer for boundary strings", () => {
  for (const value of [
    "",
    "plain ASCII",
    "é",
    "漢字",
    "🙂",
    "\ud800",
    "\udc00",
    "a\ud800b\udc00",
    "\ud83d\ude42",
  ]) {
    assert.equal(utf8ByteLength(value), Buffer.byteLength(value, "utf8"));
  }
});
