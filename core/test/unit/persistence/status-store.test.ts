import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readContinuity,
  readStatus,
  tryReadStatus,
  writeContinuity,
  writeStatus,
} from "../../../src/persistence/status-store.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-status-"));
}

test("status round-trips through the atomic write", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "status.json");
    await writeStatus(path, { state: "RUNNING", revision: 3 });
    const status = await readStatus<{ state: string; revision: number }>(path);
    assert.deepEqual(status, { state: "RUNNING", revision: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status is scrubbed before it can feed a later API response", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "status.json");
    const shaped = `AK${"IA"}${"A".repeat(16)}`;
    await writeStatus(path, { state: "BLOCKED", detail: `provider echoed ${shaped}` });
    const status = await readStatus<{ state: string; detail: string }>(path);
    assert.deepEqual(status, { state: "BLOCKED", detail: "provider echoed [REDACTED]" });
    assert.equal(status.detail.includes(shaped), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tryReadStatus returns null before any status exists", async () => {
  const dir = tempDir();
  try {
    const missing = await tryReadStatus(join(dir, "status.json"));
    assert.equal(missing, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("continuity.json is written mode 0600", { skip: process.platform === "win32" }, async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "private", "continuity.json");
    await writeContinuity(path, { sessionId: "abc" });
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.deepEqual(await readContinuity(path), { sessionId: "abc" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serialization failure before temp creation preserves the existing status input", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "status.json");
    writeFileSync(path, "existing status\n");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await assert.rejects(() => writeStatus(path, cyclic), /circular/i);
    assert.equal(readFileSync(path, "utf8"), "existing status\n");
    assert.deepEqual(readdirSync(dir), ["status.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rename failure removes only this write's temporary and preserves the occupied directory", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "status.json");
    mkdirSync(path);
    writeFileSync(join(path, "keep"), "user data\n");
    await assert.rejects(() => writeStatus(path, { state: "RUNNING" }));
    assert.equal(readFileSync(join(path, "keep"), "utf8"), "user data\n");
    assert.deepEqual(readdirSync(dir), ["status.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("500 concurrent reads during 500 concurrent writes all parse — no partial status.json", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "status.json");
    await writeStatus(path, { state: "DRAFT", revision: 0 });

    const writers = Array.from({ length: 500 }, (_, i) => writeStatus(path, { state: "RUNNING", revision: i + 1 }));
    const readers = Array.from({ length: 500 }, () => readStatus<{ state: string; revision: number }>(path));

    const [, results] = await Promise.all([Promise.all(writers), Promise.all(readers)]);
    assert.equal(results.length, 500);
    for (const status of results) {
      assert.ok(status !== null && typeof status === "object");
      assert.ok(status.state === "DRAFT" || status.state === "RUNNING");
      assert.equal(typeof status.revision, "number");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
