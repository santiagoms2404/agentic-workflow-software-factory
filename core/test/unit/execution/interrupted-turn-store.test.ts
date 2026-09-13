import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InterruptedTurnStore } from "../../../src/execution/continuity-store.ts";
import { assertTurnCheckpoint, reconcileToolCheckpoint } from "../../../src/contracts/interrupted-turn.ts";
import { sha256 } from "../../../src/contracts/owner-amendment.ts";
import { toolCheckpoint, turnCheckpoint } from "../../fixtures/interrupted-turn.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "awsf-turn-store-"));
  const privateRoot = join(root, "private", "turns");
  return { root, privateRoot, store: new InterruptedTurnStore(privateRoot) };
}

test("checkpoint bytes are private, immutable and read through an exact journal reference", async () => {
  const { privateRoot, store } = await fixture();
  const checkpoint = turnCheckpoint();
  const reference = await store.write(checkpoint, null);
  assert.deepEqual(await store.read(reference), checkpoint);
  const dir = join(privateRoot, sha256(checkpoint.binding.logicalTurnId));
  assert.equal((await stat(privateRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dir, "1.json"))).mode & 0o777, 0o600);
  const bytes = await readFile(join(dir, "1.json"));
  assert.deepEqual(await store.write(checkpoint, null), reference);
  assert.deepEqual(await readFile(join(dir, "1.json")), bytes);
  await assert.rejects(store.write({ ...checkpoint, indexDigest: sha256("different") }, null), /checkpoint-invalid/);
  assert.deepEqual(await readFile(join(dir, "1.json")), bytes);
});

test("a newer mirror or orphan generation never outranks the supplied journal reference", async () => {
  const { privateRoot, store } = await fixture();
  const first = turnCheckpoint();
  const ref1 = await store.write(first, null);
  const second = { ...first, generation: 2, priorDigest: ref1.digest, output: { ...first.output,
    text: "partial", digest: sha256("partial"), acceptedBytes: 7, nextSequence: 2 } };
  const ref2 = await store.write(second, ref1);
  assert.deepEqual(await store.read(ref1), first);
  assert.deepEqual(await store.read(ref2), second);
  const mirrorPath = join(privateRoot, sha256(first.binding.logicalTurnId), "latest.json");
  const mirror = await readFile(mirrorPath);
  await store.write(first, null);
  assert.deepEqual(await readFile(mirrorPath), mirror, "an old write retry cannot move the mirror back");
  await writeFile(mirrorPath, "torn mirror", { mode: 0o600 });
  assert.deepEqual(await store.read(ref1), first);
});

test("changed output prefix, original binding and generation gaps refuse", async () => {
  const { store } = await fixture();
  const first = turnCheckpoint();
  first.output = { ...first.output, text: "accepted", digest: sha256("accepted"), acceptedBytes: 8 };
  const reference = await store.write(first, null);
  const next = { ...first, generation: 2, priorDigest: reference.digest };
  await assert.rejects(store.write({ ...next, generation: 3 }, reference));
  await assert.rejects(store.write({ ...next, binding: { ...next.binding, originReservationId: "another-call" } }, reference));
  await assert.rejects(store.write({ ...next, output: { ...next.output, text: "replaced", digest: sha256("replaced"), acceptedBytes: 8 } }, reference));
  assert.deepEqual(await store.read(reference), first);
});

test("missing, torn, over-permissive and symlinked checkpoint bytes refuse", async () => {
  const { root, privateRoot, store } = await fixture();
  const ref = await store.write(turnCheckpoint(), null);
  const path = join(privateRoot, sha256(ref.logicalTurnId), "1.json");
  await assert.rejects(store.read({ ...ref, generation: 5 }));
  await assert.rejects(store.read({ ...ref, digest: sha256("forged") }));
  await chmod(path, 0o644);
  await assert.rejects(store.read(ref));
  await chmod(path, 0o600);
  await writeFile(path, "{");
  await assert.rejects(store.read(ref));
  const alias = join(root, "alias");
  await symlink(privateRoot, alias);
  await assert.rejects(new InterruptedTurnStore(alias).write(turnCheckpoint(), null));
});

test("a completed original turn cannot acquire another generation", async () => {
  const { store } = await fixture();
  const first = turnCheckpoint();
  first.providerIdentity = { conversationId: "fixture-conversation", requestId: "fixture-request", checkpointLineage: null, acceptance: "completed" };
  first.completed = true;
  first.terminalResultDigest = first.output.digest;
  const ref = await store.write(first, null);
  await assert.rejects(store.write({ ...first, generation: 2, priorDigest: ref.digest }, ref), /turn-already-completed/);
});

test("provider identity and acknowledged tool results cannot change between generations", async () => {
  const { store } = await fixture();
  const first = turnCheckpoint();
  first.providerIdentity = { conversationId: "fixture-conversation", requestId: "fixture-request", checkpointLineage: null, acceptance: "accepted" };
  first.tools = [{ ...toolCheckpoint(), state: "acknowledged", effect: "known", acknowledgement: "acknowledged", resultJson: '{"ok":true}', resultDigest: sha256('{"ok":true}') }];
  const ref = await store.write(first, null);
  const next = { ...first, generation: 2, priorDigest: ref.digest };
  await assert.rejects(store.write({ ...next, providerIdentity: { ...first.providerIdentity, requestId: "replacement" } }, ref));
  await assert.rejects(store.write({ ...next, tools: [] }, ref));
  await assert.rejects(store.write({ ...next, tools: [{ ...first.tools[0]!, resultJson: '{"ok":false}', resultDigest: sha256('{"ok":false}') }] }, ref));
});

test("checkpoint rejects inconsistent byte counts, result hashes and review identity", () => {
  const checkpoint = turnCheckpoint();
  assert.throws(() => assertTurnCheckpoint({ ...checkpoint, output: { ...checkpoint.output, acceptedBytes: 1 } }));
  assert.throws(() => assertTurnCheckpoint({ ...checkpoint, binding: { ...checkpoint.binding, lifecycle: "REVIEWING" } }));
  assert.throws(() => assertTurnCheckpoint({ ...checkpoint, tools: [{ ...toolCheckpoint(), state: "result-durable" }] }));
  assert.throws(() => assertTurnCheckpoint({ ...checkpoint, tools: [toolCheckpoint(), toolCheckpoint()] }));
});

test("unknown effects require original-outcome lookup and never authorize replay", () => {
  const unknown = { ...toolCheckpoint(), state: "dispatch-intent" as const, effect: "unknown" as const };
  assert.equal(reconcileToolCheckpoint(unknown, { neverDispatched: true, idempotentResultDelivery: true, transactionalOutcomeLookup: false }), "refuse");
  assert.equal(reconcileToolCheckpoint(unknown, { neverDispatched: false, idempotentResultDelivery: false, transactionalOutcomeLookup: true }), "query-original-outcome");
  assert.equal(reconcileToolCheckpoint(toolCheckpoint(), { neverDispatched: true, idempotentResultDelivery: false, transactionalOutcomeLookup: false }), "dispatch-original");
  assert.equal(reconcileToolCheckpoint(toolCheckpoint(), { neverDispatched: false, idempotentResultDelivery: false, transactionalOutcomeLookup: false }), "refuse");
});

test("failed generation admission creates no file and never changes the prior checkpoint", async () => {
  const { store, privateRoot } = await fixture();
  const first = turnCheckpoint();
  const ref = await store.write(first, null);
  const dir = join(privateRoot, sha256(ref.logicalTurnId));
  const before = await readdir(dir);
  await assert.rejects(store.write({ ...first, generation: 2, priorDigest: sha256("wrong prior") }, ref));
  assert.deepEqual(await readdir(dir), before);
  assert.deepEqual(await store.read(ref), first);
});
