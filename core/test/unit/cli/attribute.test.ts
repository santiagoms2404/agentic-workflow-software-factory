// `awsf attribute` — the owner's cause record for a BLOCKED or CANCELLED attempt.
//
// Under test: it is the owner's (an interactive terminal and a written,
// credential-free reason, both before anything is written), it only attributes
// a BLOCKED or CANCELLED attempt, it never reopens that sealed attempt, its record is
// append-only with the latest winning, and `awsf db rebuild` replays it.
// Every refusal is a named class, and each is shown to write nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributeAttemptMissing,
  AttributeAttemptNotAttributable,
  AttributeCredentialRejected,
  AttributeNotInteractive,
  AttributeReasonRequired,
  AttributeUnknownCause,
  attributeCommand,
  type AttributeCommandOptions,
} from "../../../src/cli/commands/attribute.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import {
  ATTRIBUTION_RECORD_SCHEMA_ID,
  AttributionRecordSchema,
  assertAttributionRecord,
} from "../../../src/contracts/attribution-record.ts";
import { SealedAttempt } from "../../../src/persistence/attempt-lock.ts";
import {
  attemptAttribution,
  attributionsFilePath,
  readTaskAttributions,
} from "../../../src/persistence/task-attributions.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";

const PROJECT = "agentic-workflow-software-factory";
const REASON = "the ticket's own wording asked for the protected path";

function terminal(answer: boolean, interactive = true, lines: string[] = []): OwnerTerminal {
  return { interactive, write: (line) => { lines.push(line); }, confirm: async () => answer };
}

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-attribute-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

/** One attempt of `taskId`, BLOCKED by default. */
async function attempt(
  box: { root: string; stateRoot: string },
  taskId: string,
  options: { state?: AttemptStatus["lifecycleState"]; projectRecord?: AttemptProjector } = {},
): Promise<string> {
  const created = await newCommand({
    stateRoot: box.stateRoot, project: PROJECT, taskId, repository: box.root,
    request: `open ${taskId}`, workflow: "build", tier: 1, sessionId: () => `${taskId}-session`,
    ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }),
  });
  const state = options.state ?? "BLOCKED";
  if (state !== "DRAFT") {
    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.updated",
      next: nextRevision(created.status, { lifecycleState: state, lastActivity: `${state} by the test harness` }),
    }, options.projectRecord);
  }
  return created.attemptDir;
}

function options(
  box: { stateRoot: string },
  taskId: string,
  overrides: Partial<AttributeCommandOptions> = {},
): AttributeCommandOptions {
  return {
    stateRoot: box.stateRoot, project: PROJECT, taskId, attempt: 1, cause: "factory", reason: REASON,
    terminal: terminal(true), now: () => "2026-09-28T10:00:00.000Z", ...overrides,
  };
}

function nothingWritten(box: { stateRoot: string }, taskId: string): void {
  assert.equal(existsSync(attributionsFilePath(taskRoot(box.stateRoot, PROJECT, taskId))), false, "nothing was written");
}

test("the record is registered as a host record and never as a wire envelope", () => {
  assert.equal(RECORD_SCHEMAS[ATTRIBUTION_RECORD_SCHEMA_ID], AttributionRecordSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, ATTRIBUTION_RECORD_SCHEMA_ID), false);
  assert.equal(AttributionRecordSchema.$id, "awsf.attribution/v1");
  const base = { schema: ATTRIBUTION_RECORD_SCHEMA_ID, project: PROJECT, taskId: "legacy", attempt: 1,
    reason: REASON, at: "2026-09-28T10:00:00.000Z" };
  assert.doesNotThrow(() => assertAttributionRecord({ ...base, cause: "model" }), "old records remain valid");
  assert.doesNotThrow(() => assertAttributionRecord({ ...base, cause: "driver" }));
});

test("a piped stdin cannot take the act, and the terminal is checked before anything else", async () => {
  const box = sandbox("piped");
  try {
    await attempt(box, "piped-task");
    await assert.rejects(attributeCommand(options(box, "piped-task", { terminal: terminal(true, false) })), AttributeNotInteractive);
    // Before the cause and the reason: a pipe learns nothing about which of its inputs were wrong.
    await assert.rejects(
      attributeCommand(options(box, "piped-task", { terminal: terminal(true, false), cause: "nobody", reason: " " })),
      AttributeNotInteractive,
    );
    nothingWritten(box, "piped-task");
  } finally { box.close(); }
});

test("an unknown cause is refused by name", async () => {
  const box = sandbox("cause");
  try {
    await attempt(box, "cause-task");
    await assert.rejects(
      attributeCommand(options(box, "cause-task", { cause: "provider" })),
      (error: unknown) => error instanceof AttributeUnknownCause &&
        /--cause read "provider"; an attempt is attributed to one of model, factory, environment, driver, owner, unknown/u.test(error.message),
    );
    nothingWritten(box, "cause-task");
  } finally { box.close(); }
});

test("the reason is required and never credential-shaped", async () => {
  const box = sandbox("reason");
  try {
    await attempt(box, "reason-task");
    await assert.rejects(attributeCommand(options(box, "reason-task", { reason: "   " })), AttributeReasonRequired);
    await assert.rejects(
      attributeCommand(options(box, "reason-task", { reason: `blocked on ghp_${"a".repeat(36)}` })),
      AttributeCredentialRejected,
    );
    nothingWritten(box, "reason-task");
  } finally { box.close(); }
});

test("an attempt that does not exist is refused by name", async () => {
  const box = sandbox("missing");
  try {
    await attempt(box, "missing-task");
    await assert.rejects(attributeCommand(options(box, "missing-task", { attempt: 2 })), AttributeAttemptMissing);
    await assert.rejects(attributeCommand(options(box, "missing-task", { attempt: 0 })), AttributeAttemptMissing);
    await assert.rejects(attributeCommand(options(box, "never-created")), AttributeAttemptMissing);
    nothingWritten(box, "missing-task");
  } finally { box.close(); }
});

for (const state of ["DRAFT", "RUNNING", "LANDED"] as const) {
  test(`a ${state} attempt is refused with no record or projected event`, async () => {
    const box = sandbox(`refuse-${state}`);
    const projection = createDashboardProjection(box.stateRoot);
    try {
      const dir = await attempt(box, "live-task", { state, projectRecord: projection.project });
      const before = await readAttempt(dir);
      await assert.rejects(
        attributeCommand(options(box, "live-task", { projectAttribution: projection.projectAttribution })),
        (error: unknown) => error instanceof AttributeAttemptNotAttributable &&
          error.message.includes(`attempt 1 is ${state}: only BLOCKED or CANCELLED attempts can be attributed`),
      );
      nothingWritten(box, "live-task");
      assert.deepEqual(await readAttempt(dir), before);
      const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
      try {
        assert.equal((db.prepare("SELECT count(*) AS count FROM events WHERE type = 'attribution'").get() as { count: number }).count, 0);
      } finally { db.close(); }
    } finally { projection.close(); box.close(); }
  });
}

test("an owner who declines writes nothing", async () => {
  const box = sandbox("declined");
  try {
    await attempt(box, "declined-task");
    const result = await attributeCommand(options(box, "declined-task", { terminal: terminal(false) }));
    assert.equal(result.confirmed, false);
    assert.equal(result.record, null);
    nothingWritten(box, "declined-task");
  } finally { box.close(); }
});

test("the record goes beside the attempt directories and the sealed attempt stays sealed", async () => {
  const box = sandbox("sealed");
  try {
    const dir = await attempt(box, "sealed-task");
    const before = await readAttempt(dir);
    const filesBefore = readdirSync(dir).sort();
    const lines: string[] = [];

    const result = await attributeCommand(options(box, "sealed-task", { terminal: terminal(true, true, lines) }));
    assert.equal(result.confirmed, true);
    assert.deepEqual(result.record, {
      schema: "awsf.attribution/v1", project: PROJECT, taskId: "sealed-task", attempt: 1,
      cause: "factory", reason: REASON, at: "2026-09-28T10:00:00.000Z",
    });
    assert.ok(lines.some((line) => line.includes("No owner attribution is on record")));

    const root = taskRoot(box.stateRoot, PROJECT, "sealed-task");
    assert.equal(attributionsFilePath(root), join(root, "attributions.jsonl"));
    assert.deepEqual(await readTaskAttributions(root), [result.record]);

    const after = await readAttempt(dir);
    assert.equal(after.revision, before.revision, "no attempt revision was spent");
    assert.deepEqual(readdirSync(dir).sort(), filesBefore, "no file was added to the attempt directory");
    await assert.rejects(
      persistAttempt(dir, after.revision, { kind: "attempt.updated", next: nextRevision(after, { lastActivity: "illegal" }) }),
      SealedAttempt,
    );
  } finally { box.close(); }
});

test("a later attribution wins, the earlier one stays, and the terminal shows the one on record", async () => {
  const box = sandbox("latest");
  try {
    await attempt(box, "latest-task");
    await attributeCommand(options(box, "latest-task", { cause: "model", reason: "first read" }));
    const lines: string[] = [];
    const second = await attributeCommand(options(box, "latest-task", {
      cause: "environment", reason: "second read", terminal: terminal(true, true, lines), now: () => "2026-09-28T11:00:00.000Z",
    }));
    assert.equal(second.previous?.cause, "model");
    assert.ok(lines.includes("On record: model (2026-09-28T10:00:00.000Z): first read"));

    const root = taskRoot(box.stateRoot, PROJECT, "latest-task");
    assert.deepEqual((await readTaskAttributions(root)).map((record) => record.cause), ["model", "environment"]);
    assert.equal((await attemptAttribution(root, 1))?.cause, "environment");
    assert.equal(await attemptAttribution(root, 2), null);
  } finally { box.close(); }
});

test("a torn tail refuses rather than dropping the last record, and nothing is appended after it", async () => {
  const box = sandbox("torn");
  try {
    await attempt(box, "torn-task");
    await attributeCommand(options(box, "torn-task"));
    const path = attributionsFilePath(taskRoot(box.stateRoot, PROJECT, "torn-task"));
    appendFileSync(path, '{"source_seq":2,"recorded_at":"2026');
    await assert.rejects(readTaskAttributions(taskRoot(box.stateRoot, PROJECT, "torn-task")), /interrupted task attribution append/u);
    await assert.rejects(attributeCommand(options(box, "torn-task", { cause: "model" })), /interrupted task attribution append/u);
  } finally { box.close(); }
});

test("a driver attribution of a CANCELLED attempt writes one record and event, and db rebuild replays it", async () => {
  const box = sandbox("cancelled");
  const projection = createDashboardProjection(box.stateRoot);
  const rows = (): Array<{ session_id: string; name: string; payload_json: string }> => {
    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      return db.prepare("SELECT session_id, name, payload_json FROM events WHERE type = 'attribution' ORDER BY event_row")
        .all() as Array<{ session_id: string; name: string; payload_json: string }>;
    } finally { db.close(); }
  };
  try {
    const dir = await attempt(box, "cancelled-task", { state: "CANCELLED", projectRecord: projection.project });
    const before = await readAttempt(dir);
    const filesBefore = readdirSync(dir).sort();
    const lines: string[] = [];
    let question = "";
    const ownerTerminal: OwnerTerminal = {
      interactive: true,
      write: (line) => { lines.push(line); },
      confirm: async (prompt) => { question = prompt; return true; },
    };
    const result = await attributeCommand(options(box, "cancelled-task", {
      cause: "driver", terminal: ownerTerminal, projectAttribution: projection.projectAttribution,
    }));
    assert.match(question, /CANCELLED/u);
    assert.equal(result.record?.cause, "driver");
    assert.ok(lines.some((line) => line.includes("CANCELLED")));
    assert.ok(lines.some((line) => line.includes("no heuristic cause")));
    assert.deepEqual(await readTaskAttributions(taskRoot(box.stateRoot, PROJECT, "cancelled-task")), [result.record]);
    assert.deepEqual(await readAttempt(dir), before);
    assert.deepEqual(readdirSync(dir).sort(), filesBefore);
    const live = rows();
    assert.equal(live.length, 1);
    assert.equal(live[0]!.session_id, "cancelled-task-session");
    assert.equal(JSON.parse(live[0]!.payload_json).cause, "driver");
    const report = await rebuildCommand(box.stateRoot);
    assert.equal(report.ok, true, report.ok ? undefined : report.reason);
    assert.deepEqual(rows(), live);
  } finally { projection.close(); box.close(); }
});

test("the live projection writes one attribution events row, and awsf db rebuild replays it", async () => {
  const box = sandbox("projected");
  const projection = createDashboardProjection(box.stateRoot);
  const rows = (): Array<{ session_id: string; name: string; payload_json: string }> => {
    const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
    try {
      return (db.prepare(`SELECT session_id, name, payload_json FROM events
        WHERE type = 'attribution' ORDER BY event_row`).all() as Array<{ session_id: string; name: string; payload_json: string }>)
        .map((row) => ({ ...row }));
    } finally { db.close(); }
  };
  try {
    await attempt(box, "projected-task", { projectRecord: projection.project });
    await attributeCommand(options(box, "projected-task", {
      cause: "model", reason: "first read", projectAttribution: projection.projectAttribution,
    }));
    await attributeCommand(options(box, "projected-task", {
      cause: "owner", reason: "second read", projectAttribution: projection.projectAttribution,
      now: () => "2026-09-28T11:00:00.000Z",
    }));
    // Projecting the same record again is a no-op: the row id is derived from the record.
    const again = await readTaskAttributions(taskRoot(box.stateRoot, PROJECT, "projected-task"));
    projection.projectAttribution(again[1]!);
    projection.close();

    const live = rows();
    assert.equal(live.length, 2);
    assert.deepEqual(live.map((row) => JSON.parse(row.payload_json).cause), ["model", "owner"]);
    assert.equal(live[0]!.session_id, "projected-task-session");
    assert.equal(live[0]!.name, "owner attribution recorded");

    const report = await rebuildCommand(box.stateRoot);
    assert.equal(report.ok, true, report.ok ? undefined : report.reason);
    assert.deepEqual(rows(), live, "the rebuilt database holds the same rows in the same order");
  } finally { projection.close(); box.close(); }
});
