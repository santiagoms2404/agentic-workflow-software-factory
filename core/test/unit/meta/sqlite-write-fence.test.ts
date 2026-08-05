import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const ALLOWED_PREFIXES = [
  "core/src/observability/sqlite.ts",
  "core/src/observability/projector.ts",
  "core/src/observability/migrations/",
];
const WRITE_PATTERN = /\.(exec|run|prepare)\s*\(/;
const NODE_SQLITE_IMPORT = /(['"])node:sqlite\1/;

test("SQLite is written only by the observability driver, projector, and migrations", () => {
  const files = walkFiles(join(repoRoot(), "core", "src"), [".ts"]);
  const offenders = files
    .map(relRepo)
    .filter((f) => !ALLOWED_PREFIXES.some((p) => f === p || f.startsWith(p)))
    .filter((f) => {
      const src = readFileSync(join(repoRoot(), f), "utf8");
      return NODE_SQLITE_IMPORT.test(src) && WRITE_PATTERN.test(src);
    });
  assert.deepEqual(offenders, []);
});
