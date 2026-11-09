import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { storageMode } from "../../../src/preflight/storage-mode.ts";

test("storageMode preserves strict and nearest-existing-parent measurements", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "awsf-storage-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "present");
  await writeFile(file, "measured");
  const existing = await storageMode(file);
  assert.equal(existing.path, file);
  assert.equal(existing.mode, (await stat(file)).mode);

  const missing = join(root, "not-created", "child");
  assert.deepEqual(await storageMode(missing), { path: missing, mode: null });
  assert.deepEqual(await storageMode(missing, true), { path: root, mode: (await stat(root)).mode });
});
