import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./_walk.ts";

test("no committed runtime artifacts or *receipt*/*manifest* files", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot() })
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  const offenders = tracked.filter((f) => {
    const base = f.split("/").pop() ?? "";
    if (/receipt/i.test(base) || /manifest/i.test(base)) return true;
    if (/\.(log|pid|sqlite|sqlite3|db)$/i.test(base)) return true;
    return false;
  });
  assert.deepEqual(offenders, []);
});
