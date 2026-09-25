import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../src/contracts/registry.ts";
import {
  emitShiftManifestJsonSchema,
  sealShiftManifest,
  SHIFT_MANIFEST_SCHEMA_ID,
  ShiftManifestSchema,
  type ShiftManifest,
} from "../../src/contracts/shift-selection-record.ts";
import { readPlanTicketFile } from "../../src/persistence/plan-ticket-body.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PLAN = "awsf-v2-w17-shift";
const IDS = ["T01", "T02", "T03"] as const;

/** Copies three real tickets so a byte can be moved without touching the repository. */
async function ticketCopies(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "awsf-shift-manifest-"));
  for (const id of IDS) await copyFile(join(ROOT, "specs", "tickets", PLAN, `${id}.md`), join(directory, `${id}.md`));
  return directory;
}

async function manifestOver(directory: string): Promise<ShiftManifest> {
  const tickets = [];
  for (const id of IDS) {
    const file = await readPlanTicketFile(join(directory, `${id}.md`));
    tickets.push({ id, path: `specs/tickets/${PLAN}/${id}.md`, digest: file.digest });
  }
  return sealShiftManifest({ plan: PLAN, milestones: ["M1"], tickets });
}

const CHILD_SCRIPT = join(import.meta.dirname, "_shift-manifest-child.ts");

/** Seals the same manifest in a FRESH node process, over the same directory's bytes. */
function manifestDigestInChildProcess(directory: string): string {
  return execFileSync(process.execPath, ["--experimental-strip-types", CHILD_SCRIPT, directory, PLAN], {
    encoding: "utf8",
  });
}

test("the manifest is registered as a host record and never as a wire envelope", () => {
  assert.equal(RECORD_SCHEMAS[SHIFT_MANIFEST_SCHEMA_ID], ShiftManifestSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, SHIFT_MANIFEST_SCHEMA_ID), false);
  assert.equal(ShiftManifestSchema.$id, "awsf.shift-manifest/v1");
  const emitted = emitShiftManifestJsonSchema();
  assert.equal(emitted["$id"], "awsf.shift-manifest/v1");
  assert.deepEqual(emitted.required, ["plan", "milestones", "tickets", "manifestDigest"]);
});

test("the manifest round-trips through TypeBox validation", async () => {
  const directory = await ticketCopies();
  try {
    const manifest = await manifestOver(directory);
    const reread = JSON.parse(JSON.stringify(manifest)) as unknown;
    assert.equal(Value.Check(ShiftManifestSchema, reread), true);
    assert.deepEqual(reread, manifest);
    assert.equal(sealShiftManifest(reread as ShiftManifest).manifestDigest, manifest.manifestDigest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a one-byte change to any ticket file changes manifestDigest", async () => {
  const directory = await ticketCopies();
  try {
    const before = await manifestOver(directory);
    for (const id of IDS) {
      const path = join(directory, `${id}.md`);
      const original = await readFile(path);
      const moved = Buffer.from(original);
      // One byte of the title, so the file still parses and only the digest can notice.
      const at = moved.indexOf('title: "') + 'title: "'.length;
      moved[at] = moved[at]! ^ 1;
      await writeFile(path, moved);
      const after = await manifestOver(directory);
      assert.notEqual(after.manifestDigest, before.manifestDigest, `${id}: a moved byte left manifestDigest unchanged`);
      await writeFile(path, original);
    }
    assert.equal((await manifestOver(directory)).manifestDigest, before.manifestDigest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("identical bytes give an identical manifestDigest across two processes, and one changed byte does not", async () => {
  const directory = await ticketCopies();
  try {
    const before = await manifestOver(directory);
    assert.equal(
      manifestDigestInChildProcess(directory),
      before.manifestDigest,
      "a fresh process sealed a different digest over the identical bytes",
    );

    const path = join(directory, `${IDS[0]}.md`);
    const original = await readFile(path);
    const moved = Buffer.from(original);
    const at = moved.indexOf('title: "') + 'title: "'.length;
    moved[at] = moved[at]! ^ 1;
    await writeFile(path, moved);
    assert.notEqual(
      manifestDigestInChildProcess(directory),
      before.manifestDigest,
      "a moved byte left the child process's manifestDigest unchanged",
    );
    await writeFile(path, original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the selection's milestone order is part of the digest", () => {
  const tickets = [{ id: "T01", path: `specs/tickets/${PLAN}/T01.md`, digest: "a".repeat(64) }];
  const forward = sealShiftManifest({ plan: PLAN, milestones: ["M1", "M3"], tickets });
  const reversed = sealShiftManifest({ plan: PLAN, milestones: ["M3", "M1"], tickets });
  assert.notEqual(forward.manifestDigest, reversed.manifestDigest);
});

test("milestones is always a non-empty list of distinct ids", () => {
  const tickets = [{ id: "T01", path: `specs/tickets/${PLAN}/T01.md`, digest: "a".repeat(64), tier: 1 as const, workflow: "build" as const }];
  const valid = sealShiftManifest({ plan: PLAN, milestones: ["M1"], tickets });
  assert.equal(Value.Check(ShiftManifestSchema, valid), true);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, milestones: "M1" }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, milestones: [] }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, milestones: ["M1", "M1"] }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, milestone: "M1" }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, tickets: [] }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, tickets: [{ ...tickets[0], workflow: "shift" }] }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, tickets: [{ ...tickets[0], path: "../T01.md" }] }), false);
  assert.equal(Value.Check(ShiftManifestSchema, { ...valid, tickets: [{ ...tickets[0], path: "/abs/T01.md" }] }), false);
});
