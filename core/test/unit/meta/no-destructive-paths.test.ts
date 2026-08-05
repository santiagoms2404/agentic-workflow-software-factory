import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const FORBIDDEN = [
  /git\s+push/,
  /--force\b/,
  /-f\b.*push/,
  /rm\s+-rf/,
  /rmSync\s*\(/,
  /rmdirSync\s*\(/,
  /unlinkSync\s*\(/,
  /\bauto[-_]?delete\b/i,
];

test("no push/force/auto-delete strings in core/src", () => {
  const files = walkFiles(join(repoRoot(), "core", "src"));
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (FORBIDDEN.some((p) => p.test(src))) offenders.push(relRepo(f));
  }
  assert.deepEqual(offenders, []);
});
