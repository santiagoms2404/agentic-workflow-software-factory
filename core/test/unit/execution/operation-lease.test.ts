import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withExecutionLease } from "../../../src/execution/operation-lease.ts";

test("execution lease excludes a second controller and releases only its own identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awsf-controller-"));
  try {
    await withExecutionLease(directory, async () => {}, async id => {
      const original = await readFile(join(directory, "execution-lease.json"), "utf8");
      assert.equal(JSON.parse(original).id, id);
      await assert.rejects(withExecutionLease(directory, async () => {}, async () => assert.fail("duplicate controller")), /live or unknown execution controller/);
      assert.equal(await readFile(join(directory, "execution-lease.json"), "utf8"), original);
    });
    await assert.rejects(readFile(join(directory, "execution-lease.json")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed takeover validation preserves the old lease; insecure or malformed leases refuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awsf-controller-"));
  const path = join(directory, "execution-lease.json");
  try {
    const original = JSON.stringify({ id: "previous-controller", pid: process.pid, startIdentity: "different-birth-identity" });
    await writeFile(path, original, { mode: 0o600 });
    await assert.rejects(withExecutionLease(directory, async () => { throw new Error("checkpoint changed"); }, async () => assert.fail("must not execute")), /checkpoint changed/);
    assert.equal(await readFile(path, "utf8"), original);
    await chmod(path, 0o644);
    await assert.rejects(withExecutionLease(directory, async () => {}, async () => assert.fail("must not execute")), /unsafe execution lease/);
    await chmod(path, 0o600);
    await writeFile(path, JSON.stringify({ id: "bad", pid: process.pid, startIdentity: {} }));
    await assert.rejects(withExecutionLease(directory, async () => {}, async () => assert.fail("must not execute")), /ambiguous execution lease/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
