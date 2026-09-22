import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertControllerSettled, ownExecutionLease, withExecutionLease } from "../../../src/execution/operation-lease.ts";
import { commitProtectedAsHost } from "../../../src/git/protected-commit.ts";
import type { ProtectedFilesCapability } from "../../../src/contracts/protected-capability.ts";

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

test("the protected commit transport refuses outright when this process does not hold the lease", async () => {
  // Leg 3 of the lock-adoption argument — "the writer ran under this attempt's
  // execution lease" — is the premise a recovery relies on to conclude the
  // writer is gone. It is asserted before ANY other work here, so a caller
  // outside a lease changes nothing: no state is read, no index is staged, no
  // object is created and no evidence is written.
  const directory = await mkdtemp(join(tmpdir(), "awsf-protected-lease-"));
  try {
    await assert.rejects(() => commitProtectedAsHost({
      attemptDir: directory, capability: {} as ProtectedFilesCapability, message: "never reached",
      paths: ["core/src/generated.ts"], writes: [], protectedPaths: [],
      persistIntent: async () => assert.fail("no intent may be written without the lease"),
      persistWitness: async () => assert.fail("no witness may be written without the lease"),
      persistBinding: async () => assert.fail("no binding may be written without the lease"),
    }), /this process does not hold the attempt's execution lease/);
    assert.deepEqual(await readdir(directory), []);

    // And it is satisfied by the real thing, from inside the real wrapper.
    await withExecutionLease(directory, async () => {}, async id => {
      assert.equal((await ownExecutionLease(directory)).id, id);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a witnessed controller that is still running is never treated as settled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awsf-controller-"));
  try {
    // The identity a witness would have recorded for THIS process, taken from
    // the same lease the transport writes. It is unambiguously alive, so the
    // census must say so rather than letting an adoption proceed on a record
    // whose writer never died.
    let recorded = { pid: process.pid, startIdentity: "" };
    await withExecutionLease(directory, async () => {}, async () => {
      const lease = await ownExecutionLease(directory);
      recorded = { pid: lease.pid, startIdentity: lease.startIdentity };
    });
    assert.notEqual(recorded.startIdentity, "");
    assert.throws(() => assertControllerSettled(recorded, "the fixture artefact"), /which is still running/);
    // A pid no live process can be holding settles, which is the ordinary
    // post-crash case.
    assertControllerSettled({ pid: 0x7ffffffe, startIdentity: "long-gone" }, "the fixture artefact");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
