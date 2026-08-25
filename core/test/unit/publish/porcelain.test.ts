import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePorcelain } from "../../../src/publish/argv.ts";

test("parsePorcelain maps all six flags and drops transport framing", () => {
  const stdout = [
    "To https://example.invalid/repository.git",
    "*\tdeadbeef:refs/heads/new\t[new branch]",
    "=\tdeadbeef:refs/heads/current\t[up to date]",
    " \tdeadbeef:refs/heads/main\t0123456789012345678901234567890123456789..abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "!\tdeadbeef:refs/heads/rejected\t[rejected] (non-fast-forward)",
    "+\tdeadbeef:refs/heads/forced\t(forced update)",
    "-\t:refs/heads/deleted\t[deleted]",
    "Done",
    "",
  ].join("\n");

  assert.deepEqual(parsePorcelain(stdout), [
    "created",
    "already-current",
    "fast-forwarded",
    "rejected",
    "fault",
    "fault",
  ]);
});

test("parsePorcelain does not parse the To URL line as a ref outcome", () => {
  assert.deepEqual(parsePorcelain("To https://example.invalid/repository.git\nDone\n"), []);
});
