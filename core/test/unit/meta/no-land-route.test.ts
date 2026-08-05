import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const FORBIDDEN_ROUTES = [
  /\bland\b/i,
  /\bapprove\b/i,
  /\bretry\b/i,
  /\bcancel\b/i,
  /config[-_]?mutation/i,
];

test("no dashboard write path to the lifecycle exists in the api layer", () => {
  const apiFiles = walkFiles(join(repoRoot(), "core", "src", "api"), [".ts"]);
  const offenders = apiFiles
    .map(relRepo)
    .filter((f) => {
      const src = readFileSync(join(repoRoot(), f), "utf8");
      return FORBIDDEN_ROUTES.some((p) => p.test(src));
    });
  assert.deepEqual(offenders, []);
});
