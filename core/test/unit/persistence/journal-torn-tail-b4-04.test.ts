import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Journal,
  TornJournalTailError,
  lastSourceSeq,
  openRawStream,
  readJournalTail,
  type JournalRecord,
} from "../../../src/persistence/journal.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-journal-torn-"));
}

function recordLine(seq: number): string {
  return JSON.stringify({ source_seq: seq, recorded_at: "2026-10-06T00:00:00.000Z", event: { n: seq } });
}

test("an append after an unterminated record starts on a new line and both records stay parseable", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    // The crash kept record 2's JSON but not its newline.
    writeFileSync(path, `${recordLine(1)}\n${recordLine(2)}`);
    const journal = new Journal<{ n: number }>(path);
    const appended = await journal.append({ n: 3 });
    await journal.close();

    assert.equal(appended.source_seq, 3);
    const text = readFileSync(path, "utf8");
    assert.equal(text.startsWith(`${recordLine(1)}\n${recordLine(2)}`), true, "the prior bytes stay a byte prefix");
    assert.equal(text.startsWith(`${recordLine(1)}\n${recordLine(2)}\n`), true, "record 3 starts on its own line");
    const lines = text.split("\n");
    assert.equal(lines[lines.length - 1], "", "the journal ends terminated");
    const parsed = lines.slice(0, -1).map((line) => JSON.parse(line) as JournalRecord<{ n: number }>);
    assert.deepEqual(parsed.map((record) => record.source_seq), [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a raw stream chunk after an unterminated chunk starts on its own line", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "raw.jsonl");
    writeFileSync(path, '{"raw":1}\n{"raw":2');
    const stream = openRawStream(path);
    await stream.appendChunk('{"raw":3}');
    await stream.appendChunk('{"raw":4}');
    await stream.close();
    assert.equal(readFileSync(path, "utf8"), '{"raw":1}\n{"raw":2\n{"raw":3}\n{"raw":4}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unparsable final line is reported as the torn tail, not thrown, and the file is unchanged", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const durable = `${recordLine(1)}\n${recordLine(2)}\n`;
    const torn = '{"source_seq":3,"recorded_at":"2026-10-06T0';
    writeFileSync(path, `${durable}${torn}`);
    const before = readFileSync(path);

    for (const chunkBytes of [1, 7, 64, 64 * 1024]) {
      const tail = await readJournalTail(path, { chunkBytes });
      assert.deepEqual(
        tail,
        { lastSourceSeq: 2, tornTail: { text: torn, byteOffset: Buffer.byteLength(durable) } },
        `chunk ${String(chunkBytes)}`,
      );
      assert.equal(await lastSourceSeq(path, { chunkBytes }), 2);
    }
    assert.deepEqual(readFileSync(path), before, "the read leaves the bytes exactly as found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a torn first record reports no records before it", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    writeFileSync(path, '{"source_seq":1,"rec');
    assert.deepEqual(await readJournalTail(path, { chunkBytes: 4 }), {
      lastSourceSeq: 0,
      tornTail: { text: '{"source_seq":1,"rec', byteOffset: 0 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Journal refuses to bury a torn tail, naming it, and leaves every byte in place", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const durable = `${recordLine(1)}\n`;
    writeFileSync(path, `${durable}{"source_seq":2,"recor`);
    const before = readFileSync(path);
    const journal = new Journal<{ n: number }>(path);
    await assert.rejects(journal.append({ n: 2 }), (err: unknown) => {
      assert.ok(err instanceof TornJournalTailError);
      assert.equal(err.tornTail.byteOffset, Buffer.byteLength(durable));
      assert.equal(err.tornTail.text, '{"source_seq":2,"recor');
      return true;
    });
    // A second try refuses the same way rather than appending past the tail.
    await assert.rejects(journal.append({ n: 2 }), TornJournalTailError);
    await journal.close();
    assert.deepEqual(readFileSync(path), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unparsable line before the torn tail still fails loudly", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    writeFileSync(path, `${recordLine(1)}\n{"source_seq":2,"rec\n{"source_seq":3,"rec`);
    for (const chunkBytes of [1, 5, 64 * 1024]) {
      await assert.rejects(readJournalTail(path, { chunkBytes }), SyntaxError);
    }
    await assert.rejects(new Journal(path).append({ n: 4 }), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a terminated unparsable last line is corruption, not a torn tail, and still throws", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    writeFileSync(path, `${recordLine(1)}\n{"source_seq":2,"rec\n`);
    await assert.rejects(readJournalTail(path), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
