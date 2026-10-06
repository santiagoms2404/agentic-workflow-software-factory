import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Journal,
  lastSourceSeq,
  openRawStream,
  type JournalRecord,
  type TailHandle,
} from "../../../src/persistence/journal.ts";

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
    assert.equal(record.event.detail, "provider said [REDACTED]");
    assert.equal(record.event.detail.includes(shaped), false);
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

/** The whole-file reading `lastSourceSeq` replaced, kept as the oracle it must agree with. */
function wholeFileLastSourceSeq(text: string): number {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return 0;
  return (JSON.parse(lastLine) as JournalRecord<unknown>).source_seq;
}

/** Opens through node, counting every byte a read returns. */
function countingOpen(): { open: (path: string) => Promise<TailHandle>; bytesRead: () => number } {
  let total = 0;
  return {
    open: async (path: string): Promise<TailHandle> => {
      const handle = await open(path, "r");
      return {
        stat: () => handle.stat(),
        close: () => handle.close(),
        read: async (buffer, offset, length, position) => {
          const result = await handle.read(buffer, offset, length, position);
          total += result.bytesRead;
          return result;
        },
      };
    },
    bytesRead: () => total,
  };
}

function recordLine(seq: number, padding = 0): string {
  return JSON.stringify({ source_seq: seq, recorded_at: "2026-10-06T00:00:00.000Z", event: { pad: "x".repeat(padding) } });
}

test("lastSourceSeq reads only the tail of a journal far larger than one chunk", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const chunkBytes = 4 * 1024;
    const lines: string[] = [];
    for (let seq = 1; seq <= 20_000; seq += 1) lines.push(recordLine(seq, 40));
    const text = `${lines.join("\n")}\n`;
    writeFileSync(path, text);
    assert.ok(text.length > 200 * chunkBytes, "the journal must dwarf the chunk size");

    const counter = countingOpen();
    const seq = await lastSourceSeq(path, { chunkBytes, open: counter.open });
    assert.equal(seq, wholeFileLastSourceSeq(readFileSync(path, "utf8")));
    assert.equal(seq, 20_000);
    // The last line plus at most one chunk. A whole-file read is hundreds of chunks.
    assert.ok(counter.bytesRead() > 0, "the tail was read through the injected opener");
    assert.ok(counter.bytesRead() <= chunkBytes * 2, `read ${String(counter.bytesRead())} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lastSourceSeq agrees with the whole-file reading on every edge", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    assert.equal(await lastSourceSeq(path), 0, "missing file");
    const cases: readonly string[] = [
      "",
      "\n",
      "\n\n\n",
      `${recordLine(1)}\n`,
      recordLine(1),
      `${recordLine(1)}\n${recordLine(2)}`,
      `${recordLine(1)}\n${recordLine(2)}\n\n\n`,
      `\n\n${recordLine(7)}\n`,
      `${recordLine(1)}\n${recordLine(2, 100)}\n`,
      `${recordLine(1)}\n${recordLine(3, 1000)}\n${"\n".repeat(50)}`,
    ];
    for (const text of cases) {
      writeFileSync(path, text);
      for (const chunkBytes of [1, 3, 16, 64, 64 * 1024]) {
        assert.equal(
          await lastSourceSeq(path, { chunkBytes }),
          wholeFileLastSourceSeq(text),
          `${JSON.stringify(text.slice(0, 40))} at chunk ${String(chunkBytes)}`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lastSourceSeq parses a last line longer than one chunk, reading only that line", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const chunkBytes = 64;
    const long = recordLine(42, 10_000);
    const prefix = Array.from({ length: 500 }, (_, i) => recordLine(i + 1, 200)).join("\n");
    writeFileSync(path, `${prefix}\n${long}\n`);
    const counter = countingOpen();
    assert.equal(await lastSourceSeq(path, { chunkBytes, open: counter.open }), 42);
    assert.ok(counter.bytesRead() <= long.length + 1 + chunkBytes, `read ${String(counter.bytesRead())} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lastSourceSeq still throws on a malformed last line", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    writeFileSync(path, `${recordLine(1)}\n{"source_seq":2,"recorded_at"\n`);
    await assert.rejects(lastSourceSeq(path, { chunkBytes: 8 }), SyntaxError);
    await assert.rejects(lastSourceSeq(path), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Journal resumes source_seq from a large journal's tail", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "journal.jsonl");
    const lines = Array.from({ length: 5_000 }, (_, i) => recordLine(i + 1, 100));
    writeFileSync(path, `${lines.join("\n")}\n`);
    const journal = new Journal<{ n: number }>(path);
    const record = await journal.append({ n: 1 });
    await journal.close();
    assert.equal(record.source_seq, 5_001);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
