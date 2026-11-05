import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./_walk.ts";

/**
 * A basename that marks a runtime artifact or a receipt/manifest file. SQLite
 * and journal sidecars (`awsf.db-wal`, `state.sqlite3-journal`) are artifacts too.
 */
export function isJunkBasename(base: string): boolean {
  if (/receipt/i.test(base) || /manifest/i.test(base)) return true;
  return /\.(?:log|pid|sqlite|sqlite3|db)(?:-wal|-shm|-journal)?$/i.test(base);
}

test("no committed runtime artifacts or *receipt*/*manifest* files", () => {
  // -z keeps names raw. Without it git double-quotes a name with non-ASCII bytes, the basename
  // ends in a quote character, and a suffix anchor stops matching.
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot() })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const offenders = tracked.filter((f) => isJunkBasename(f.split("/").pop() ?? ""));
  assert.deepEqual(offenders, []);
});

test("the junk-drawer rule reads sidecar suffixes and non-ASCII names", () => {
  for (const name of ["awsf.db-wal", "awsf.db-shm", "state.sqlite3-journal", "café.db", "ønly.log", "plain.db", "run.pid", "receipt-x.md", "manifest.json"]) {
    assert.equal(isJunkBasename(name), true, name);
  }
  for (const name of ["README.md", "database.ts", "logger.ts", "awsf.dbx"]) {
    assert.equal(isJunkBasename(name), false, name);
  }
});
