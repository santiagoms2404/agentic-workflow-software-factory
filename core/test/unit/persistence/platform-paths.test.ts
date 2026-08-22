import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  attemptDir,
  continuityFilePath,
  journalFilePath,
  lockFilePath,
  placementFilePath,
  rawStreamFilePath,
  resolveStateRoot,
  statusFilePath,
} from "../../../src/persistence/platform-paths.ts";

test("XDG_STATE_HOME is honored when explicitly set, on every platform", () => {
  for (const platformName of ["linux", "darwin", "win32"] as const) {
    const root = resolveStateRoot({ XDG_STATE_HOME: "/custom/state" }, platformName);
    assert.equal(root, join("/custom/state", "awsf"));
  }
});

test("an empty XDG_STATE_HOME is not treated as explicitly set", () => {
  const root = resolveStateRoot({ XDG_STATE_HOME: "  " }, "linux");
  assert.equal(root, join(homedir(), ".local", "state", "awsf"));
});

test("macOS falls back to ~/Library/Application Support/awsf (Q6)", () => {
  const root = resolveStateRoot({}, "darwin");
  assert.equal(root, join(homedir(), "Library", "Application Support", "awsf"));
});

test("Windows falls back to %LOCALAPPDATA%/awsf", () => {
  const root = resolveStateRoot({ LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local" }, "win32");
  assert.equal(root, join("C:\\Users\\owner\\AppData\\Local", "awsf"));
});

test("Windows without LOCALAPPDATA refuses to guess", () => {
  assert.throws(() => resolveStateRoot({}, "win32"), /LOCALAPPDATA/);
});

test("other platforms fall back to the XDG default state dir", () => {
  const root = resolveStateRoot({}, "linux");
  assert.equal(root, join(homedir(), ".local", "state", "awsf"));
});

test("the attempt tree matches the Ownership section's layout", () => {
  const root = "/state-root";
  const attempt = attemptDir(root, "acme-app", "T6", "attempt-1");
  assert.equal(attempt, join(root, "projects", "acme-app", "tasks", "T6", "attempt-1"));
  assert.equal(placementFilePath(root, "acme-app"), join(root, "projects", "acme-app", "placement.yaml"));
  assert.equal(journalFilePath(attempt), join(attempt, "journal.jsonl"));
  assert.equal(statusFilePath(attempt), join(attempt, "status.json"));
  assert.equal(continuityFilePath(attempt), join(attempt, "private", "continuity.json"));
  assert.equal(rawStreamFilePath(attempt, "run-42"), join(attempt, "raw", "run-42.jsonl"));
  assert.equal(lockFilePath(attempt), join(attempt, "attempt.lock"));
});
