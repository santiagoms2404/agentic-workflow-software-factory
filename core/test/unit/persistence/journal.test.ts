import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, openRawStream, type JournalRecord } from "../../../src/persistence/journal.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-journal-"));
}

test("append stamps a contiguous source_seq starting at 1", async () => {
  const dir = tempDir();
  try {
    const journal = new Journal<{ kind: string }>(join(dir, "journal.jsonl"));
    const first = await journal.append({ kind: "run.started" });
    const second = await journal.append({ kind: "text.delta" });
    const third = await journal.append({ kind: "run.completed" });
    await journal.close();
    assert.deepEqual(
      [first.source_seq, second.source_seq, third.source_seq],
      [1, 2, 3],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("byte-prefix immutability: the prior prefix is untouched by further appends", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const journal = new Journal<{ n: number }>(path);
    for (let i = 0; i < 10; i += 1) {
      await journal.append({ n: i });
    }
    const prefixBytes = readFileSync(path);

    for (let i = 10; i < 20; i += 1) {
      await journal.append({ n: i });
    }
    await journal.close();
    const fullBytes = readFileSync(path);

    assert.ok(fullBytes.length > prefixBytes.length);
    assert.deepEqual(fullBytes.subarray(0, prefixBytes.length), prefixBytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source_seq recovers from the file itself across a fresh Journal instance", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const first = new Journal<{ n: number }>(path);
    await first.append({ n: 1 });
    await first.append({ n: 2 });
    await first.close();

    const restarted = new Journal<{ n: number }>(path);
    const record = await restarted.append({ n: 3 });
    await restarted.close();
    assert.equal(record.source_seq, 3);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    const parsed = lines.map((line: string) => JSON.parse(line) as JournalRecord<{ n: number }>);
    assert.deepEqual(
      parsed.map((r: JournalRecord<{ n: number }>) => r.source_seq),
      [1, 2, 3],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credential-shaped values are scrubbed before the canonical journal write", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const journal = new Journal<{ detail: string }>(path);
    const shaped = `AK${"IA"}${"A".repeat(16)}`;
    const record = await journal.append({ detail: `provider said ${shaped}` });
    await journal.close();
    assert.equal(record.event.detail, "[REDACTED]");
    assert.equal(readFileSync(path, "utf8").includes(shaped), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("raw stream capture appends chunks verbatim and fsyncs", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "raw", "run-1.jsonl");
    const stream = openRawStream(path);
    await stream.appendChunk('{"raw":1}');
    await stream.appendChunk('{"raw":2}');
    await stream.close();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.deepEqual(lines, ['{"raw":1}', '{"raw":2}']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
