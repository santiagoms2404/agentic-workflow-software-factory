import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { sealTicketSelection } from "../../../src/contracts/ticket-selection-record.ts";
import type { ClosureRecord } from "../../../src/contracts/closure-record.ts";
import { gatherLandingClosures } from "../../../src/closure/readout.ts";
import { unclosedLandings, type LandingClosureFact } from "../../../src/closure/model.ts";
import { AttemptLock, runWriteProtocol } from "../../../src/persistence/attempt-lock.ts";
import { Journal, type JournalRecord } from "../../../src/persistence/journal.ts";
import { writeStatus } from "../../../src/persistence/status-store.ts";
import { syntheticClosure } from "../../fixtures/closure-readers.ts";

// B4-01: the journal is the truth and status.json a projection written after the append, so the
// closure inventory reads "landed" from the journal and degrades one entry when its status lags or is gone.
// B4-03: the write protocol refuses to append behind a status the journal has already passed.

const PROJECT = "synthetic";
const CANDIDATE = "c".repeat(40);
const CREATED_AT = "2026-10-09T22:00:00Z";
const LANDED_AT = "2026-10-09T22:02:57Z";

function status(root: string, taskId: string, revision: number, lifecycleState: "DRAFT" | "LANDED", lastActivityAt: string): AttemptStatus {
  return {
    project: PROJECT, taskId, attempt: 1, repository: join(root, "repository"), lifecycleState, revision, lastSourceSeq: revision,
    lastActivity: lifecycleState === "LANDED" ? "landed" : "created", lastActivityAt,
    candidateSha: lifecycleState === "LANDED" ? CANDIDATE : null, shift: null,
    ticketSelection: sealTicketSelection({ plan: "synthetic", tickets: [{ id: "T01", path: "specs/tickets/synthetic/T01.md", digest: "1".repeat(64) }] }),
    budget: { ownerReentries: 0, allowance: { auto: 1, owner: 1, ownerReentries: 1 } },
    ceilingGrants: [], continuesTask: null, groupId: null, planRef: null, routeOverrides: {}, reviewDegradation: null,
  } as unknown as AttemptStatus;
}

function row(seq: number, kind: AttemptEvent["kind"], next: AttemptStatus, record?: ClosureRecord): JournalRecord<AttemptEvent> {
  return { source_seq: seq, recorded_at: next.lastActivityAt, event: { kind, next, ...(record ? { evidence: { type: "closure-record" as const, record } } : {}) } };
}

/** created (DRAFT, revision 1) then the LANDED transition (revision 2), optionally a closure record (revision 3). */
function landedRows(root: string, taskId: string, closed = false): JournalRecord<AttemptEvent>[] {
  const rows = [row(1, "attempt.created", status(root, taskId, 1, "DRAFT", CREATED_AT)),
    row(2, "attempt.transitioned", status(root, taskId, 2, "LANDED", LANDED_AT))];
  if (closed) rows.push(row(3, "attempt.updated", status(root, taskId, 3, "LANDED", "2026-10-09T22:03:00Z"), syntheticClosure(CANDIDATE)));
  return rows;
}

/** Writes one attempt directory; `statusText` null leaves status.json absent. */
async function attempt(root: string, taskId: string, rows: readonly JournalRecord<AttemptEvent>[], statusText: string | null, torn = ""): Promise<string> {
  const dir = join(root, "state", "projects", PROJECT, "tasks", taskId, "1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "journal.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n" + torn);
  if (statusText !== null) await writeFile(join(dir, "status.json"), statusText);
  return dir;
}

function withRoot(fn: (root: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-b4-01-"));
    try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

const unchanged = (taskId: string, closure: LandingClosureFact["closure"]): LandingClosureFact =>
  ({ project: PROJECT, taskId, attempt: 1, landedAt: LANDED_AT, hasSelection: true, closure });

test("a journal one record ahead of status.json, with LANDED journaled, reads as landed", withRoot(async root => {
  const rows = landedRows(root, "lagging");
  // The crash landed between the LANDED append and its status write: status.json is still revision 1.
  const dir = await attempt(root, "lagging", rows, JSON.stringify(rows[0]!.event.next));
  const journalBefore = await readFile(join(dir, "journal.jsonl"), "utf8");
  const facts = await gatherLandingClosures(join(root, "state"), PROJECT);
  assert.equal(facts.length, 1, "the journaled landing must be in the closure inventory");
  assert.equal(facts[0]!.landedAt, LANDED_AT);
  assert.equal(unclosedLandings(facts).length, 1, "an unclosed journaled landing must still block");
  assert.deepEqual(facts[0]!.degraded, ["status.json is at revision 1 and the journal proves revision 2; read from the journal"]);
  assert.equal(await readFile(join(dir, "journal.jsonl"), "utf8"), journalBefore, "the readout never writes");
}));

test("one missing or unreadable status.json degrades only that entry, and the others are still read", withRoot(async root => {
  await attempt(root, "a-missing", landedRows(root, "a-missing"), null);
  await attempt(root, "b-empty", landedRows(root, "b-empty"), "");
  const intact = landedRows(root, "c-intact", true);
  await attempt(root, "c-intact", intact, JSON.stringify(intact.at(-1)!.event.next));
  const facts = await gatherLandingClosures(join(root, "state"), PROJECT);
  assert.deepEqual(facts.map(fact => fact.taskId), ["a-missing", "b-empty", "c-intact"]);
  assert.deepEqual(facts[0]!.degraded, ["status.json is missing; read from the journal"]);
  assert.equal(facts[0]!.landedAt, LANDED_AT);
  assert.match(facts[1]!.degraded?.[0] ?? "", /^status\.json is unreadable \(.+\); read from the journal$/u);
  assert.equal(facts[2]!.closure.state, "closed");
  assert.equal(facts[2]!.degraded, undefined);
  assert.deepEqual(unclosedLandings(facts).map(fact => fact.taskId), ["a-missing", "b-empty"]);
}));

test("when journal and status agree the fact is exactly what it was before", withRoot(async root => {
  const open = landedRows(root, "open");
  await attempt(root, "open", open, JSON.stringify(open.at(-1)!.event.next));
  const closed = landedRows(root, "shut", true);
  await attempt(root, "shut", closed, JSON.stringify(closed.at(-1)!.event.next));
  const facts = await gatherLandingClosures(join(root, "state"), PROJECT);
  assert.deepEqual(facts, [unchanged("open", { state: "not closed", record: null }),
    unchanged("shut", { state: "closed", record: syntheticClosure(CANDIDATE) })]);
}));

test("a torn tail stays visible without crashing the inventory", withRoot(async root => {
  // Landed durable prefix, then an append the crash cut short: the landing stands, the tail is reported.
  const rows = landedRows(root, "landed-torn");
  const torn = "{\"source_seq\":3,\"recor";
  await attempt(root, "landed-torn", rows, JSON.stringify(rows.at(-1)!.event.next), torn);
  // Pre-landing durable prefix with a cut-short append: never acknowledged, so nothing landed.
  const draft = landedRows(root, "draft-torn").slice(0, 1);
  await attempt(root, "draft-torn", draft, JSON.stringify(draft[0]!.event.next), "{\"source_seq\":2,\"ev");
  const facts = await gatherLandingClosures(join(root, "state"), PROJECT);
  assert.deepEqual(facts.map(fact => fact.taskId), ["landed-torn"]);
  assert.equal(facts[0]!.landedAt, LANDED_AT);
  assert.deepEqual(facts[0]!.degraded, [`journal.jsonl ends in ${Buffer.byteLength(torn)} unterminated byte(s) at offset ` +
    `${Buffer.byteLength(rows.map(r => JSON.stringify(r)).join("\n") + "\n")}; read from the durable prefix`]);
}));

test("a corrupt journal is passed by only when a readable projection has not landed", withRoot(async root => {
  const draftDir = await attempt(root, "a-draft", [], JSON.stringify(status(root, "a-draft", 1, "DRAFT", CREATED_AT)));
  await writeFile(join(draftDir, "journal.jsonl"), "{not json\n");
  const rows = landedRows(root, "b-landed");
  await attempt(root, "b-landed", rows, JSON.stringify(rows.at(-1)!.event.next));
  assert.deepEqual((await gatherLandingClosures(join(root, "state"), PROJECT)).map(fact => fact.taskId), ["b-landed"]);
  const landedDir = await attempt(root, "c-landed", [], JSON.stringify(rows.at(-1)!.event.next));
  await writeFile(join(landedDir, "journal.jsonl"), "{not json\n");
  await assert.rejects(gatherLandingClosures(join(root, "state"), PROJECT), /refuses a corrupt attempt journal at journal\.jsonl#line:1/u);
}));

interface SeqStatus { revision: number; lastSourceSeq: number }

async function write(dir: string, current: SeqStatus | null): Promise<SeqStatus> {
  const journal = new Journal<{ next: SeqStatus }>(join(dir, "journal.jsonl"));
  try {
    return await runWriteProtocol<{ next: SeqStatus }, SeqStatus>({
      lock: new AttemptLock(join(dir, "attempt.lock")), journal, statusPath: join(dir, "status.json"),
      readCurrentStatus: async () => current,
      validate: status => {
        const revision = (status?.revision ?? 0) + 1;
        return { event: { next: { revision, lastSourceSeq: revision } }, nextStatus: { revision, lastSourceSeq: revision } };
      },
    });
  } finally { await journal.close(); }
}

test("B4-03: a write behind a status the journal already passed is refused instead of forking the journal", withRoot(async root => {
  const dir = join(root, "attempt");
  const first = await write(dir, null);
  const second = await write(dir, first);
  assert.deepEqual(second, { revision: 2, lastSourceSeq: 2 });
  // Status write lost after the append of revision 2: the next writer still sees revision 1.
  await writeStatus(join(dir, "status.json"), first);
  const before = await readFile(join(dir, "journal.jsonl"), "utf8");
  await assert.rejects(write(dir, first), /journal\.jsonl is at source_seq 2 but the status was written from source_seq 1/u);
  assert.equal(await readFile(join(dir, "journal.jsonl"), "utf8"), before, "the refused write appends nothing");
  // A journal with records but no status at all is the same lag from zero.
  const fresh = join(root, "fresh");
  await write(fresh, null);
  await assert.rejects(write(fresh, null), /source_seq 1 but the status was written from source_seq 0/u);
  // In step, the write proceeds and the journal stays contiguous with the status.
  assert.deepEqual(await write(dir, second), { revision: 3, lastSourceSeq: 3 });
  const seqs = (await readFile(join(dir, "journal.jsonl"), "utf8")).trim().split("\n")
    .map(line => [JSON.parse(line).source_seq, JSON.parse(line).event.next.revision]);
  assert.deepEqual(seqs, [[1, 1], [2, 2], [3, 3]]);
}));
