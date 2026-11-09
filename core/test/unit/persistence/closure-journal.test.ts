import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closureJournalRecords } from "../../../src/persistence/closure-journal.ts";

test("closure refuses an interior blank journal line", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-closure-journal-"));
  mkdirSync(join(root, "attempt"));
  const first = JSON.stringify({ source_seq: 1, recorded_at: "2026-10-01T00:00:00.000Z", event: { next: { revision: 1 } } });
  const second = JSON.stringify({ source_seq: 2, recorded_at: "2026-10-01T00:00:01.000Z", event: { next: { revision: 2 } } });
  writeFileSync(join(root, "attempt", "journal.jsonl"), `${first}\n\n${second}\n`);
  try {
    await assert.rejects(closureJournalRecords(join(root, "attempt")), /corrupt attempt journal at journal\.jsonl#line:2/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
