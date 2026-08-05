import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const ALLOWED = "core/src/execution/transport-broker.ts";
const PATTERN = /(['"])(node:)?child_process\1/;

test("node:child_process is imported nowhere except transport-broker.ts", () => {
  const files = walkFiles(join(repoRoot(), "core", "src"));
  const offenders = files
    .map(relRepo)
    .filter((f) => f !== ALLOWED)
    .filter((f) => PATTERN.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});
