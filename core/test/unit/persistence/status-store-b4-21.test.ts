import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tryReadStatus,
  tryReadContinuity,
  writeStatus,
  readStatus,
} from "../../../src/persistence/status-store.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-b4-21-"));
}

test("tryReadStatus returns null for a 0-byte empty status.json file", async () => {
  const dir = tempDir();
  try {
    const statusPath = join(dir, "status.json");
    writeFileSync(statusPath, "");

    const result = await tryReadStatus<{ state: string }>(statusPath);
    assert.equal(result, null, "empty status.json must return null instead of throwing SyntaxError");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tryReadContinuity returns null for an empty 0-byte continuity.json file", async () => {
  const dir = tempDir();
  try {
    const continuityPath = join(dir, "continuity.json");
    writeFileSync(continuityPath, "   \n");

    const result = await tryReadContinuity<{ token: string }>(continuityPath);
    assert.equal(result, null, "empty continuity.json must return null instead of throwing SyntaxError");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tryReadStatus still throws SyntaxError on non-empty corrupt JSON", async () => {
  const dir = tempDir();
  try {
    const statusPath = join(dir, "status.json");
    writeFileSync(statusPath, '{"broken": ');

    await assert.rejects(
      () => tryReadStatus(statusPath),
      (err: unknown) => err instanceof SyntaxError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeStatus syncs data before rename and preserves round-trip content", async () => {
  const dir = tempDir();
  try {
    const statusPath = join(dir, "status.json");
    const payload = { revision: 1, state: "RUNNING" };
    await writeStatus(statusPath, payload);

    const read = await readStatus<{ revision: number; state: string }>(statusPath);
    assert.deepEqual(read, payload);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
