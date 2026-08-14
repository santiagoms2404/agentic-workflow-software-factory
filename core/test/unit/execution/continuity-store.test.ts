// The private conversation ledger, and above all what it keeps OUT of the
// public half.
//
// The design the tests below pin: the host handle is public and names a
// conversation; the provider locator is private and is how you reach one. They
// are deliberately different strings, because `SessionIdentityBroken` and
// `CorrectionIdentityMismatch` embed the identity in their messages and a
// blocked attempt writes that message into `status.json`. Privacy that depends
// on nothing ever failing is not privacy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTINUITY_FILE_MODE,
  ContinuityStore,
  ContinuityUnavailable,
  continuityHandle,
} from "../../../src/execution/continuity-store.ts";
import { publicApiValue } from "../../../src/api/responses.ts";

const ROUTE = { adapter: "pi-codex", provider: "openai-codex", model: "gpt-5.6-sol" };
const LOCATOR = "11111111-2222-4333-8444-555555555555";

function world(): { dir: string; path: string; store: ContinuityStore; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "awsf-continuity-"));
  const path = join(dir, "private", "continuity.json");
  let tick = 0;
  const store = new ContinuityStore({
    path,
    newSessionId: () => `${LOCATOR.slice(0, -1)}${String(tick++)}`,
    now: () => "2026-08-13T00:00:00.000Z",
  });
  return { dir, path, store, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the public handle names a conversation and is not a way to reach one", () => {
  assert.equal(continuityHandle("builder"), "continuity:builder");
  // Deterministic, so a replayed journal produces the same string, and derived
  // from the phase alone because a phase has exactly one conversation.
  assert.equal(continuityHandle("builder"), continuityHandle("builder"));
  assert.notEqual(continuityHandle("builder"), continuityHandle("reviewer"));
});

test("opening mints a private locator, persists it 0600, and reloads it", async () => {
  const { path, store, close } = world();
  try {
    const record = await store.open({ phaseId: "builder", ...ROUTE, storeDir: "/tmp/sessions" });
    assert.equal(record.handle, "continuity:builder");
    assert.equal(record.turns, 0);
    assert.notEqual(record.providerSessionId, record.handle);

    assert.equal(statSync(path).mode & 0o777, CONTINUITY_FILE_MODE);
    const persisted = JSON.parse(readFileSync(path, "utf8")) as { schema: string; records: Record<string, unknown> };
    assert.equal(persisted.schema, "awsf.continuity/v1");

    const reopened = new ContinuityStore({ path });
    await reopened.load();
    assert.equal(reopened.ref("continuity:builder").providerSessionId, record.providerSessionId);
    assert.equal(reopened.ref("continuity:builder").storeDir, "/tmp/sessions");
  } finally { close(); }
});

test("a missing or unreadable file loads as an empty store rather than throwing", async () => {
  const { store, close } = world();
  try {
    await store.load();
    assert.equal(store.get("continuity:builder"), undefined);
    assert.throws(() => store.ref("continuity:builder"), ContinuityUnavailable);
  } finally { close(); }
});

test("a phase may not open two conversations under one handle", async () => {
  const { store, close } = world();
  try {
    await store.open({ phaseId: "builder", ...ROUTE, storeDir: null });
    // Two conversations and one handle would leave every later identity check
    // comparing against whichever won.
    await assert.rejects(
      () => store.open({ phaseId: "builder", ...ROUTE, storeDir: null }),
      /already open/,
    );
  } finally { close(); }
});

test("a conversation with no completed turn has nothing to correct", async () => {
  const { store, close } = world();
  try {
    await store.open({ phaseId: "builder", ...ROUTE, storeDir: null });
    assert.throws(() => store.assertCorrectable("continuity:builder", ROUTE), /no completed turn/);
    await store.recordTurn("continuity:builder");
    assert.equal(store.assertCorrectable("continuity:builder", ROUTE).turns, 1);
  } finally { close(); }
});

test("a correction on a changed adapter, provider, or model is refused", async () => {
  const { store, close } = world();
  try {
    await store.open({ phaseId: "builder", ...ROUTE, storeDir: null });
    await store.recordTurn("continuity:builder");
    for (const [field, value] of [["adapter", "claude-code"], ["provider", "anthropic"], ["model", "opus"]] as const) {
      assert.throws(
        () => store.assertCorrectable("continuity:builder", { ...ROUTE, [field]: value }),
        new RegExp(`route changed.*${field}`),
        `a changed ${field} must be terminal`,
      );
    }
  } finally { close(); }
});

test("a correction on a handle nobody opened is refused", () => {
  const { store, close } = world();
  try {
    assert.throws(() => store.assertCorrectable("continuity:reviewer", ROUTE), ContinuityUnavailable);
  } finally { close(); }
});

test("turn counts survive a reload, so a resumed host does not think a turn is unspent", async () => {
  const { path, store, close } = world();
  try {
    await store.open({ phaseId: "builder", ...ROUTE, storeDir: null });
    await store.recordTurn("continuity:builder");
    await store.recordTurn("continuity:builder");
    const reopened = new ContinuityStore({ path });
    await reopened.load();
    assert.equal(reopened.assertCorrectable("continuity:builder", ROUTE).turns, 2);
  } finally { close(); }
});

test("the provider locator is stripped by the public API projector", async () => {
  const { store, close } = world();
  try {
    const record = await store.open({ phaseId: "builder", ...ROUTE, storeDir: "/tmp/sessions" });
    // The projector removes reference-shaped fields by name. A record that ever
    // reached a response would be caught here rather than in a screenshot.
    const projected = publicApiValue({
      handle: record.handle,
      continuityRef: record.providerSessionId,
      hostContinuityRef: record.providerSessionId,
    }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(projected), ["handle"]);
    assert.equal(JSON.stringify(projected).includes(record.providerSessionId), false);
  } finally { close(); }
});
