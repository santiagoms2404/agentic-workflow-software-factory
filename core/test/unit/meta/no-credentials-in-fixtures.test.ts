import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const CREDENTIAL_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

test("no credential-shaped values in test fixtures", () => {
  const files = walkFiles(join(repoRoot(), "core", "test", "fixtures"), [
    ".ts",
    ".json",
    ".txt",
    ".yaml",
    ".yml",
  ]);
  const offenders = files
    .map(relRepo)
    .filter((f) => CREDENTIAL_PATTERNS.some((p) => p.test(readFileSync(join(repoRoot(), f), "utf8"))));
  assert.deepEqual(offenders, []);
});
