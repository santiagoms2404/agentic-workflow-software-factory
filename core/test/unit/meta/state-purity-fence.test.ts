import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const IMPURE_IMPORT = /from\s+(['"])(node:)?(fs|child_process|http|https|net|dgram|dns|sqlite)(\/[^'"]*)?\1/;

test("core/src/state imports nothing impure", () => {
  const files = walkFiles(join(repoRoot(), "core", "src", "state"), [".ts"]);
  const offenders = files
    .map(relRepo)
    .filter((f) => IMPURE_IMPORT.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});
