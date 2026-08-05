import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

test("no shell:true anywhere in core/src or dashboard/src", () => {
  const files = [
    ...walkFiles(join(repoRoot(), "core", "src")),
    ...walkFiles(join(repoRoot(), "dashboard", "src")),
  ];
  const offenders = files.filter((f) => /shell\s*:\s*true/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map(relRepo), []);
});
