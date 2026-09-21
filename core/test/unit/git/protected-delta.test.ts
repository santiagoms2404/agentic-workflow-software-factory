import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseProtectedRawDiff, protectedContentDeltas, protectedTreeDelta } from "../../../src/git/protected-delta.ts";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";
import type { ProtectedFileBaseline } from "../../../src/contracts/protected-grant.ts";

const before = "1".repeat(40);
const after = "2".repeat(40);
const zero = "0".repeat(40);
const raw = (status = "M", oldMode = "100644", newMode = "100644", oldBlob = before, newBlob = after, path = "source.ts") =>
  `:${oldMode} ${newMode} ${oldBlob} ${newBlob} ${status}\0${path}\0`;
const baseline: ProtectedFileBaseline = { path: "source.ts", blob: before, mode: "100644", parents: [], file: null };

test("protected raw diff preserves modes and blob identities, including binary content", () => {
  const rows = parseProtectedRawDiff(raw());
  assert.deepEqual(protectedContentDeltas(rows, [baseline]), [{ path: "source.ts", beforeBlob: before, beforeMode: "100644", afterBlob: after, afterMode: "100644" }]);
  assert.deepEqual(parseProtectedRawDiff(""), []);
});

for (const value of [raw().slice(0, -1), "1\t1\tsource.ts\n", raw("R100"), raw("M", "100644", "100644", "1234"), raw() + raw(), raw() + ":broken\0"]) {
  test("protected raw parser refuses truncated, abbreviated, duplicate or non-raw evidence", () => assert.throws(() => parseProtectedRawDiff(value)));
}
for (const value of [raw("D", "100644", "000000", before, zero), raw("T", "100644", "120000"), raw("M", "100644", "100755"),
  raw("M", "100644", "100644", before, zero), raw("M", "100644", "100644", before, before), raw("M", "100644", "100644", after, before),
  raw("M", "100644", "100644", before, after, "Source.ts"), raw("M", "100644", "100644", before, after, "other.ts")]) {
  test("protected content comparison refuses deletion, type/mode changes, unknown blobs and ungranted paths", () => {
    assert.throws(() => protectedContentDeltas(parseProtectedRawDiff(value), [baseline]), /content-only baseline/);
  });
}

test("new protected content requires an absent baseline and non-executable regular mode", () => {
  const created = { ...baseline, blob: null, mode: null };
  assert.equal(protectedContentDeltas(parseProtectedRawDiff(raw("A", "000000", "100644", zero)), [created]).length, 1);
  assert.throws(() => protectedContentDeltas(parseProtectedRawDiff(raw("A", "000000", "100755", zero)), [created]));
});

test("real Git staged binary content is identified by immutable tree and blob, not numstat", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-protected-delta-"));
  const git = systemGitRunner(root);
  try {
    runGit(git, ["init", "-b", "main"]);
    writeFileSync(join(root, "source.ts"), Buffer.from([0, 1, 2]));
    runGit(git, ["add", "source.ts"]);
    runGit(git, ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: initialize protected delta"]);
    const parent = runGit(git, ["rev-parse", "HEAD"]).trim();
    const original = runGit(git, ["rev-parse", "HEAD:source.ts"]).trim();
    writeFileSync(join(root, "source.ts"), Buffer.from([0, 3, 4]));
    runGit(git, ["add", "source.ts"]);
    const tree = runGit(git, ["write-tree"]).trim();
    const rows = protectedTreeDelta(git, parent, tree);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.beforeBlob, original);
    assert.equal(protectedContentDeltas(rows, [{ ...baseline, blob: original }]).length, 1);
    writeFileSync(join(root, "source.ts"), "a later working-tree change");
    assert.deepEqual(protectedTreeDelta(git, parent, tree), rows, "a mutable worktree cannot replace the observed tree object");
    assert.throws(() => protectedTreeDelta(git, "HEAD", tree), /exact Git object/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
