import assert from "node:assert/strict";
import { test } from "node:test";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readAttempt, type AttemptEvent } from "../../../src/cli/commands/attempt.ts";
import { gatherLandingClosures, readClosure } from "../../../src/closure/readout.ts";
import { CLOSURE_CUT, closureReadout } from "../../../src/closure/model.ts";
import { closureJournalRecords } from "../../../src/persistence/closure-journal.ts";
import { landingJournalTail } from "../../../src/persistence/closure-tail.ts";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import { box, draft } from "../../fixtures/trap-world.ts";
import { selectedLanding, syntheticClosure } from "../../fixtures/closure-readers.ts";

test("projections rule out journal opens before landing, at/before the cut, or without selection", async () => {
  const world = box();
  try {
    const created = await draft(world);
    let opens = 0;
    const never = async (): Promise<never> => { opens++; throw new Error("journal must not open"); };
    for (const lifecycleState of ["DRAFT", "PREPARED", "RUNNING", "AWAITING_OWNER", "BLOCKED", "CANCELLED"] as const) {
      assert.deepEqual(await readClosure(created.attemptDir, { ...created.status, lifecycleState }, never), { state: "not closed", record: null });
    }
    await selectedLanding(world, { taskId: "at-cut", at: CLOSURE_CUT });
    await selectedLanding(world, { taskId: "pre-cut", at: "2026-10-09T22:02:55Z" });
    const unselected = await selectedLanding(world, { taskId: "no-selection", selected: false });
    for (const lifecycleState of ["LANDED", "PUBLISHED"] as const) {
      assert.deepEqual(await readClosure(unselected.attemptDir, { ...unselected.status, lifecycleState }, never), { state: "not closed", record: null });
    }
    // Another project's corrupt projection must not even be discovered.
    const other = await selectedLanding(world, { project: "other-project" });
    await writeFile(join(other.attemptDir, "status.json"), "invalid");
    assert.deepEqual(await gatherLandingClosures(world.stateRoot, world.config.project.slug, never), []);
    assert.equal(opens, 0);
  } finally { world.close(); }
});

test("reverse closure reader matches full evidence with a large pre-landing prefix and reads only the tail", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const count = 3000;
    const record = syntheticClosure(landed.status.candidateSha!);
    const makeRow = (seq: number, kind: AttemptEvent["kind"], state: "RUNNING" | "LANDED" | "PUBLISHED", closure = false): JournalRecord<AttemptEvent> => ({
      source_seq: seq, recorded_at: record.at,
      event: { kind, next: { ...landed.status, revision: seq, lastSourceSeq: seq, lifecycleState: state,
        lastActivity: "prefix".repeat(state === "RUNNING" ? 500 : 1),
        lastActivityAt: seq === count + 1 ? landed.status.lastActivityAt : record.at },
        ...(closure ? { evidence: { type: "closure-record" as const, record } } : {}) },
    });
    const rows = Array.from({ length: count }, (_, index) => makeRow(index + 1, "attempt.updated", "RUNNING"));
    rows.push(makeRow(count + 1, "attempt.transitioned", "LANDED"), makeRow(count + 2, "attempt.updated", "LANDED", true),
      makeRow(count + 3, "attempt.transitioned", "PUBLISHED"));
    const path = join(landed.attemptDir, "journal.jsonl");
    const text = rows.map(row => JSON.stringify(row)).join("\n") + "\n";
    await writeFile(path, text);
    await writeFile(join(landed.attemptDir, "status.json"), JSON.stringify(rows.at(-1)!.event.next));
    const status = await readAttempt(landed.attemptDir);
    let bytes = 0, closed = 0;
    const bounded = await landingJournalTail(landed.attemptDir, status, { chunkBytes: 1024, open: async target => {
      const handle = await open(target, "r");
      return { stat: () => handle.stat(), close: async () => { closed++; await handle.close(); },
        read: async (buffer, offset, length, position) => { const result = await handle.read(buffer, offset, length, position); bytes += result.bytesRead; return result; } };
    } });
    const full = await closureJournalRecords(landed.attemptDir);
    assert.deepEqual(bounded, full.slice(count));
    assert.equal(bounded[0]!.event.next.lastActivityAt, full.find(row => row.event.next.lifecycleState === "LANDED")!.event.next.lastActivityAt);
    const closureRecords = (input: readonly JournalRecord<AttemptEvent>[]) => input.flatMap(row => row.event.evidence?.type === "closure-record" ? [row.event.evidence.record] : []);
    assert.deepEqual(closureReadout(status, closureRecords(bounded)), closureReadout(status, closureRecords(full)));
    assert.equal((await readClosure(landed.attemptDir, status)).record?.id, record.id);
    assert.ok(bytes < Buffer.byteLength(text) / 100, `${bytes} bytes read of ${Buffer.byteLength(text)}`);
    assert.equal(closed, 1);
    for (const mutation of ["torn", "gap", "revision"] as const) {
      const broken = structuredClone(rows);
      if (mutation === "gap") broken[count + 1]!.source_seq--;
      if (mutation === "revision") broken[count + 1]!.event = { ...broken[count + 1]!.event,
        next: { ...broken[count + 1]!.event.next, revision: count + 1 } };
      await writeFile(path, mutation === "torn" ? text.slice(0, -1) : broken.map(row => JSON.stringify(row)).join("\n") + "\n");
      await assert.rejects(landingJournalTail(landed.attemptDir, status), /torn|non-contiguous/u);
    }
    await writeFile(path, text);
    await assert.rejects(landingJournalTail(landed.attemptDir, { ...status, revision: status.revision - 1 }), /stale projection revision/u);
    assert.equal(await readFile(path, "utf8"), text);
  } finally { world.close(); }
});
