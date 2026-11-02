import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, syncDirectory } from "../../../src/persistence/journal.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-b4-20-"));
}

test("AppendOnlyLog syncs directory on initial creation of journal.jsonl", async () => {
  const dir = tempDir();
  try {
    const journalPath = join(dir, "attempt", "journal.jsonl");
    const syncedDirs: string[] = [];
    const journal = new Journal<{ msg: string }>(journalPath, {
      syncDir: async (target: string) => {
        syncedDirs.push(target);
      },
    });

    await journal.append({ msg: "first" });
    assert.equal(syncedDirs.length, 1, "directory must be synced on initial creation");
    assert.equal(syncedDirs[0], join(dir, "attempt"));

    // Second append to existing journal should not sync the directory again
    await journal.append({ msg: "second" });
    assert.equal(syncedDirs.length, 1, "subsequent append must not re-sync directory");

    await journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AppendOnlyLog does not sync directory if journal.jsonl already exists", async () => {
  const dir = tempDir();
  try {
    const attemptDir = join(dir, "attempt");
    const journalPath = join(attemptDir, "journal.jsonl");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(attemptDir, { recursive: true });
    writeFileSync(journalPath, "");

    const syncedDirs: string[] = [];
    const journal = new Journal<{ msg: string }>(journalPath, {
      syncDir: async (target: string) => {
        syncedDirs.push(target);
      },
    });

    await journal.append({ msg: "first" });
    assert.equal(syncedDirs.length, 0, "pre-existing journal must not trigger directory sync");

    await journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncDirectory successfully syncs an existing directory", async () => {
  const dir = tempDir();
  try {
    await syncDirectory(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
