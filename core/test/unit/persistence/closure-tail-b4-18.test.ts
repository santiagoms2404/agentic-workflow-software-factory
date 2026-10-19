import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { gatherLandingClosures } from "../../../src/closure/readout.ts";
import { landingJournalTail } from "../../../src/persistence/closure-tail.ts";
import { box } from "../../fixtures/trap-world.ts";
import { recordSyntheticClosure, selectedLanding, syntheticClosure } from "../../fixtures/closure-readers.ts";

// M5 repairs inventory authority, not the bounded reader's intentional stale-status refusal.
for (const successor of ["closure", "publication"] as const) {
  test(`B4-18: ${successor} journal ahead of status keeps both landings in the inventory`, async () => {
    const world = box();
    try {
      const lagging = await selectedLanding(world, { taskId: "a-lagging" });
      const healthy = await selectedLanding(world, { taskId: "b-healthy" });
      const statusPath = join(lagging.attemptDir, "status.json");
      const oldStatus = await readFile(statusPath, "utf8");
      if (successor === "closure") {
        await recordSyntheticClosure(lagging.attemptDir, syntheticClosure(lagging.status.candidateSha!));
      } else {
        await persistAttempt(lagging.attemptDir, lagging.status.revision, { kind: "attempt.transitioned",
          next: nextRevision(lagging.status, { lifecycleState: "PUBLISHED", lastActivityAt: "2026-10-09T22:04:00Z" }) });
      }
      const authoritative = await readAttempt(lagging.attemptDir);
      await writeFile(statusPath, oldStatus);
      const journalPath = join(lagging.attemptDir, "journal.jsonl");
      const journal = await readFile(journalPath, "utf8");
      await assert.rejects(landingJournalTail(lagging.attemptDir, lagging.status), /stale projection revision/u);
      assert.equal((await landingJournalTail(lagging.attemptDir, authoritative)).at(-1)!.source_seq, authoritative.revision);
      const facts = await gatherLandingClosures(world.stateRoot, lagging.status.project);
      assert.deepEqual(facts.map(fact => fact.taskId), [lagging.status.taskId, healthy.status.taskId]);
      assert.equal(facts[0]!.closure.state, successor === "closure" ? "closed" : "not closed");
      assert.equal(facts[0]!.landedAt, lagging.status.lastActivityAt);
      assert.deepEqual(facts[0]!.degraded, [`status.json is at revision ${lagging.status.revision} and the journal proves revision ${authoritative.revision}; read from the journal`]);
      assert.equal(facts[1]!.degraded, undefined);
      assert.equal(await readFile(statusPath, "utf8"), oldStatus);
      assert.equal(await readFile(journalPath, "utf8"), journal);
    } finally { world.close(); }
  });
}

test("B4-18: a torn successor uses the durable prefix without weakening the tail refusal", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const path = join(landed.attemptDir, "journal.jsonl");
    await appendFile(path, '{"source_seq":3,"event":');
    const before = await readFile(path, "utf8");
    await assert.rejects(landingJournalTail(landed.attemptDir, landed.status), /torn attempt journal/u);
    const facts = await gatherLandingClosures(world.stateRoot, landed.status.project);
    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.landedAt, landed.status.lastActivityAt);
    assert.equal(facts[0]!.closure.state, "not closed");
    assert.match(facts[0]!.degraded![0]!, /read from the durable prefix/u);
    assert.equal(await readFile(path, "utf8"), before);
  } finally { world.close(); }
});

test("B4-18: an acknowledged corrupt successor is still refused, not hidden as projection lag", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    await appendFile(join(landed.attemptDir, "journal.jsonl"), '{broken}\n');
    await assert.rejects(gatherLandingClosures(world.stateRoot, landed.status.project), /corrupt attempt journal/u);
  } finally { world.close(); }
});
