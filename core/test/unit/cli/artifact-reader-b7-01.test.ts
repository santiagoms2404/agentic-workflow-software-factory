// H11 (B7-01 B7-02 B8-02): the one host artifact reader checks containment on
// the real path, so a symlink in the worktree cannot make a gate read a host file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artifactReader } from "../../../src/cli/commands/production-run.ts";

/** A worktree beside a host file it must never observe. */
function world(): { worktree: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-artifact-reader-"));
  const worktree = join(root, "worktree");
  mkdirSync(join(worktree, "artifacts/nested/deeper"), { recursive: true });
  const outside = join(root, "host-only.json");
  writeFileSync(outside, JSON.stringify({ host: "outside the worktree" }));
  return { worktree, outside };
}

const ABSENT = { exists: false, size: 0 };

test("RED B7-01: a symlink in the worktree that points outside it is refused", () => {
  const w = world();
  symlinkSync(w.outside, join(w.worktree, "artifacts/report.json"));
  assert.deepEqual(artifactReader(w.worktree)("artifacts/report.json"), ABSENT);
});

test("B7-02: a symlinked directory that leaves the worktree is refused for every file beneath it", () => {
  const w = world();
  symlinkSync(join(w.outside, ".."), join(w.worktree, "artifacts/escape"));
  assert.deepEqual(artifactReader(w.worktree)("artifacts/escape/host-only.json"), ABSENT);
});

test("B7-01: a relative symlink climbing out with ../ is refused", () => {
  const w = world();
  symlinkSync("../../host-only.json", join(w.worktree, "artifacts/climb.json"));
  assert.deepEqual(artifactReader(w.worktree)("artifacts/climb.json"), ABSENT);
});

test("B8-02: an in-tree symlink to an in-tree file is still read", () => {
  const w = world();
  const text = JSON.stringify({ inside: true });
  writeFileSync(join(w.worktree, "artifacts/real.json"), text);
  symlinkSync("real.json", join(w.worktree, "artifacts/alias.json"));
  assert.deepEqual(artifactReader(w.worktree)("artifacts/alias.json"), { exists: true, size: text.length, content: text });
});

test("B8-02: a file in a nested directory is read, and only .json content is captured", () => {
  const w = world();
  const text = JSON.stringify([1, 2, 3]);
  writeFileSync(join(w.worktree, "artifacts/nested/deeper/out.json"), text);
  writeFileSync(join(w.worktree, "artifacts/nested/notes.md"), "notes\n");
  const read = artifactReader(w.worktree);
  assert.deepEqual(read("artifacts/nested/deeper/out.json"), { exists: true, size: text.length, content: text });
  assert.deepEqual(read("artifacts/nested/notes.md"), { exists: true, size: 6 });
});

test("B7-01: a real file whose name starts with two dots is inside the worktree", () => {
  const w = world();
  writeFileSync(join(w.worktree, "..notes.json"), "{}");
  assert.deepEqual(artifactReader(w.worktree)("..notes.json"), { exists: true, size: 2, content: "{}" });
});

test("B7-01: lexical escapes, absolute paths and directories stay absent", () => {
  const w = world();
  const read = artifactReader(w.worktree);
  assert.deepEqual(read("../host-only.json"), ABSENT);
  assert.deepEqual(read(w.outside), ABSENT);
  assert.deepEqual(read("artifacts/nested"), ABSENT);
  assert.deepEqual(read("artifacts/missing.json"), ABSENT);
});

test("H11: rework.ts holds no copy of the reader; it imports the shared one", () => {
  const source = readFileSync(new URL("../../../src/cli/commands/rework.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function artifactReader\b/u);
  assert.match(source, /\bartifactReader\b[^;]*from "\.\/production-run\.ts"/u);
});
