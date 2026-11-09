import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGit, systemGitByteRunner, systemGitRunner } from "../../../src/git/changes.ts";

// B4-25: `git cat-file blob` writes the stored bytes. A byte runner hands them
// to the caller unchanged; the text runner decodes them first. Real Git, because
// the replacement happens between Git's output and the caller.

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

// 0x93 is a Windows-1252 quotation mark and 0xff never appears in UTF-8. No CR,
// so a host autocrlf setting cannot rewrite the blob on add.
const STORED = Buffer.from([0x54, 0x93, 0xe9, 0x0a, 0xef, 0xbb, 0xbf, 0xff, 0x0a]);

test("systemGitByteRunner returns a committed blob's bytes unchanged, including bytes that are not UTF-8", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-byte-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "T01.md"), STORED);
  const git = systemGitRunner(root);
  runGit(git, ["init", "--quiet", "-b", "main"]);
  runGit(git, ["add", "--", "T01.md"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "base"]);
  const head = runGit(git, ["rev-parse", "HEAD"]).trim();

  const blob = systemGitByteRunner(root)(["cat-file", "blob", `${head}:T01.md`]);
  assert.equal(blob.status, 0);
  assert.equal(blob.error, null);
  assert.deepEqual(Buffer.from(blob.stdout), STORED);

  // The text runner is the lossy path: decoding then re-encoding changes these bytes.
  const text = git(["cat-file", "blob", `${head}:T01.md`]);
  assert.notDeepEqual(Buffer.from(text.stdout, "utf8"), STORED);
});

test("systemGitByteRunner reports a missing blob as a failed command with no output", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-byte-runner-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = systemGitRunner(root);
  runGit(git, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(root, "T01.md"), STORED);
  runGit(git, ["add", "--", "T01.md"]);
  runGit(git, [...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "base"]);
  const head = runGit(git, ["rev-parse", "HEAD"]).trim();

  const blob = systemGitByteRunner(root)(["cat-file", "blob", `${head}:absent.md`]);
  assert.notEqual(blob.status, 0);
  assert.equal(blob.stdout.length, 0);
});
