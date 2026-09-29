// decide() and the awsf.decision/v1 record (W19 task 2, DD3, Q18). The
// transport is a stub port (T01 C3); no test reaches the network. Every
// outcome leaves exactly one record in the task's decisions.jsonl, the record
// round-trips, the bodies follow the 16 KiB rule, and the projector writes one
// `decision` events row per record that a rebuild from nothing reproduces.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { taskRoot } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import {
  DECISION_BODY_LIMIT_BYTES,
  DECISION_RECORD_SCHEMA_ID,
  DecisionRecordSchema,
  assertDecisionRecord,
  decisionBodies,
  type DecisionRecord,
} from "../../../src/contracts/decision-record.ts";
import { decide, type DecideContext } from "../../../src/decision/decide.ts";
import {
  ContractError,
  JEV_DEFAULT_MODEL,
  QuestionValidationError,
  type JevOutcome,
  type JevQuestions,
  type JevState,
} from "../../../src/decision/jev-transport.ts";
import { STOP_JUDGMENT, type StopJudgmentParams } from "../../../src/decision/question-sets/stop-judgment.ts";
import { decisionsFilePath, readTaskDecisions } from "../../../src/persistence/task-decisions.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { REDACTED_VALUE } from "../../../src/policy/redaction.ts";

const PROJECT = "agentic-workflow-software-factory";
const AT = "2026-09-29T10:00:00.000Z";
const CEILING_STOP: StopJudgmentParams = { allowedActs: ["raise", "cancel"] };
const REQUEST_TEXT = JSON.stringify({ model: JEV_DEFAULT_MODEL, state: { stop: "ceiling" }, questions: {} });

/** The 2026-09-28 smoke answer, as the transport returns it answered. */
function answered(overrides: Partial<Extract<JevOutcome, { outcome: "answered" }>> = {}): JevOutcome {
  const answers = {
    progressing: { type: "noul", noul: 0.81 },
    next_act: { type: "choice", choice: "raise", probabilities: { raise: 0.75, cancel: 0, wait_for_owner: 0.2, other: 0.05 }, confidence: 0.68 },
    risk: {
      type: "score", score: 0.97, legend: { "0": "a", "1": "b", "2": "c" },
      probabilities: { "0": 0.3, "1": 0.43, "2": 0.27 }, confidence: 0.4,
    },
  } as const;
  return {
    outcome: "answered",
    answers,
    usage: { input_tokens: 670, output_tokens: 88, cost: 0.00002814 },
    resolvedModel: "typesafe/jev-1.13-20260917",
    cost: { amount: 0.00002814, source: "reported" },
    responseText: JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers }),
    requestedModel: JEV_DEFAULT_MODEL,
    elapsedMs: 1172,
    attempts: 1,
    redacted: false,
    requestText: REQUEST_TEXT,
    ...overrides,
  };
}

interface Stub {
  readonly ask: (state: JevState, questions: JevQuestions) => Promise<JevOutcome>;
  readonly calls: Array<{ state: JevState; questions: JevQuestions }>;
}

function stub(outcome: JevOutcome | (() => never)): Stub {
  const calls: Stub["calls"] = [];
  return {
    calls,
    ask: async (state, questions) => {
      calls.push({ state, questions });
      return typeof outcome === "function" ? outcome() : outcome;
    },
  };
}

function sandbox(label: string): { root: string; stateRoot: string; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), `awsf-decide-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

let ids = 0;
function context(
  box: { stateRoot: string },
  transport: Stub,
  overrides: Partial<DecideContext<StopJudgmentParams>> = {},
): DecideContext<StopJudgmentParams> {
  const taskId = overrides.taskId ?? "decide-task";
  return {
    transport, taskRoot: taskRoot(box.stateRoot, PROJECT, taskId), project: PROJECT, taskId, attempt: 1,
    caller: { kind: "stop", name: "ceiling-pause" }, params: CEILING_STOP,
    now: () => AT, newId: () => `decision-${String(++ids)}`, ...overrides,
  };
}

test("awsf.decision/v1 is a registered host record, never a wire envelope", () => {
  assert.equal(RECORD_SCHEMAS[DECISION_RECORD_SCHEMA_ID], DecisionRecordSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, DECISION_RECORD_SCHEMA_ID), false);
});

test("an answered call: the policy's result is returned, and one record round-trips through decisions.jsonl", async () => {
  const box = sandbox("answered");
  try {
    const transport = stub(answered());
    const decision = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, transport));
    assert.equal(decision.outcome, "answered");
    assert.deepEqual(decision.policyResult, { kind: "wait", reason: "low-confidence" }, "the smoke answer is a wait");
    assert.equal(transport.calls.length, 1);
    assert.deepEqual(Object.keys(transport.calls[0]!.questions), ["progressing", "next_act", "risk"]);

    const root = taskRoot(box.stateRoot, PROJECT, "decide-task");
    assert.equal(decisionsFilePath(root), join(root, "decisions.jsonl"));
    const [record, ...rest] = await readTaskDecisions(root);
    assert.deepEqual(rest, []);
    assert.deepEqual(record, decision.record, "the record round-trips unchanged");
    assert.equal(record!.id, decision.recordId);
    assert.ok(Value.Check(DecisionRecordSchema, record));
    assert.deepEqual(record!.questionSet, { id: "stop-judgment", version: 1 });
    assert.equal(record!.requestedModel, JEV_DEFAULT_MODEL);
    assert.equal(record!.resolvedModel, "typesafe/jev-1.13-20260917");
    assert.deepEqual(record!.usage, { input_tokens: 670, output_tokens: 88 });
    assert.deepEqual(record!.cost, { amount: 0.00002814, source: "reported" });
    assert.equal(record!.elapsedMs, 1172);
    assert.equal(record!.attempts, 1);
    assert.equal(record!.redacted, false);
    assert.deepEqual(record!.caller, { kind: "stop", name: "ceiling-pause" });
    assert.equal(record!.bodies.kind, "inline");
    assert.equal(record!.bodies.kind === "inline" ? record!.bodies.request : null, REQUEST_TEXT);
    // The record holds no policy result: that reproduces from the answers, in code (INV-2).
    assert.equal(Object.hasOwn(record!, "policyResult"), false);
  } finally { box.close(); }
});

test("unavailable, refused and contract-error calls return their outcome with no policy result, and each is journaled", async () => {
  const box = sandbox("fallbacks");
  try {
    const unavailable = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, stub({
      outcome: "unavailable", reason: "missing-key", detail: "OPENROUTER_API_KEY is not set.",
      requestedModel: JEV_DEFAULT_MODEL, attempts: 0, elapsedMs: 0, redacted: false, requestText: REQUEST_TEXT,
    })));
    assert.deepEqual([unavailable.outcome, unavailable.answers, unavailable.policyResult], ["unavailable", null, null]);
    assert.equal(unavailable.record.reason, "missing-key");
    assert.deepEqual(unavailable.record.cost, { amount: null, source: "unknown" }, "an unknown cost is null, never 0");
    assert.equal(Object.hasOwn(unavailable.record, "resolvedModel"), false, "no resolved model unless answered");

    const refused = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, stub({
      outcome: "refused-by-switch", detail: "Jev is switched off for this project (decision.jev: off).",
    }), { model: "typesafe/jev-1.13-20260917" }));
    assert.deepEqual([refused.outcome, refused.policyResult], ["refused-by-switch", null]);
    assert.equal(refused.record.requestedModel, "typesafe/jev-1.13-20260917", "taken from the context (T01 C1)");
    assert.equal(refused.record.redacted, false);
    assert.deepEqual(refused.record.bodies, { kind: "inline", request: null, response: null });

    const refusedDefault = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, stub({
      outcome: "refused-by-switch", detail: "off",
    })));
    assert.equal(refusedDefault.record.requestedModel, JEV_DEFAULT_MODEL);

    const broken = await decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, stub({
      outcome: "contract-error", error: new ContractError("Undeclared choice returned: next_act"),
      responseText: `{"model":"m","token":"sk-or-v1-${"a".repeat(64)}"}`,
      requestedModel: JEV_DEFAULT_MODEL, attempts: 1, elapsedMs: 40, redacted: false, requestText: REQUEST_TEXT,
    })));
    assert.deepEqual([broken.outcome, broken.policyResult], ["contract-error", null]);
    assert.equal(broken.record.detail, "Undeclared choice returned: next_act");
    const response = broken.record.bodies.kind === "inline" ? broken.record.bodies.response : null;
    assert.ok(response !== null && !response.includes("sk-or-v1-"), "the raw response is scrubbed before it is recorded (T01 C4)");
    assert.ok(response.includes(REDACTED_VALUE));

    const records = await readTaskDecisions(taskRoot(box.stateRoot, PROJECT, "decide-task"));
    assert.deepEqual(records.map((record) => record.outcome), ["unavailable", "refused-by-switch", "refused-by-switch", "contract-error"]);
  } finally { box.close(); }
});

test("a request that could never be valid throws before anything is journaled (T01 C2)", async () => {
  const box = sandbox("invalid");
  try {
    const transport = stub(() => { throw new QuestionValidationError("Choice \"next_act\" has no options."); });
    await assert.rejects(decide(STOP_JUDGMENT, { stop: "ceiling" }, context(box, transport)), QuestionValidationError);
    assert.equal(existsSync(decisionsFilePath(taskRoot(box.stateRoot, PROJECT, "decide-task"))), false);
  } finally { box.close(); }
});

test("provider fields beyond the contract are not recorded as answers, and the record still validates", async () => {
  const box = sandbox("extra");
  try {
    const base = answered() as Extract<JevOutcome, { outcome: "answered" }>;
    const answers = { ...base.answers, progressing: { type: "noul", noul: 0.81, rationale: "extra" } as never };
    const decision = await decide(STOP_JUDGMENT, "state", context(box, stub(answered({ answers }))));
    assert.deepEqual(decision.record.answers?.progressing, { type: "noul", noul: 0.81 });
  } finally { box.close(); }
});

test("bodies: whole when together under 16 KiB, else both as sha256 digests", () => {
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  assert.deepEqual(decisionBodies("req", "res"), { kind: "inline", request: "req", response: "res" });
  const half = "x".repeat(DECISION_BODY_LIMIT_BYTES / 2);
  assert.deepEqual(decisionBodies(half, half), {
    kind: "digest", requestSha256: sha(half), responseSha256: sha(half), bytes: DECISION_BODY_LIMIT_BYTES,
  }, "exactly 16 KiB is not under the limit");
  assert.equal(decisionBodies(half, half.slice(1)).kind, "inline");
  // Bytes, not characters: 'é' is two UTF-8 bytes.
  assert.equal(decisionBodies("é".repeat(DECISION_BODY_LIMIT_BYTES / 2), null).kind, "digest");
  assert.deepEqual(decisionBodies("r".repeat(DECISION_BODY_LIMIT_BYTES), null), {
    kind: "digest", requestSha256: sha("r".repeat(DECISION_BODY_LIMIT_BYTES)), responseSha256: null, bytes: DECISION_BODY_LIMIT_BYTES,
  });
});

test("a record that breaks the contract is refused before it is written", () => {
  const good: DecisionRecord = {
    schema: DECISION_RECORD_SCHEMA_ID, id: "d-1", project: PROJECT, taskId: "t", attempt: 1,
    caller: { kind: "tool", name: "ask_jev" }, questionSet: { id: "stop-judgment", version: 1 },
    requestedModel: JEV_DEFAULT_MODEL, outcome: "refused-by-switch", answers: null, usage: null,
    cost: { amount: null, source: "unknown" }, elapsedMs: 0, attempts: 0, redacted: false,
    bodies: { kind: "inline", request: null, response: null }, at: AT,
  };
  assertDecisionRecord(good);
  assert.throws(() => assertDecisionRecord({ ...good, cost: { amount: 0, source: "unknown" } }), /awsf\.decision\/v1/);
  assert.throws(() => assertDecisionRecord({ ...good, questionSet: { id: "Stop_Judgment", version: 1 } }), /awsf\.decision\/v1/);
  assert.throws(() => assertDecisionRecord({ ...good, caller: { kind: "agent", name: "x" } }), /awsf\.decision\/v1/);
  assert.throws(() => assertDecisionRecord({ ...good, policyResult: "wait" }), /awsf\.decision\/v1/);
});

test("three decision records project three decision rows, and a rebuild from nothing yields the same rows", async () => {
  const box = sandbox("rebuild");
  const projection = createDashboardProjection(box.stateRoot);
  const dbPath = join(box.stateRoot, "awsf.db");
  const rows = (): Array<Record<string, unknown>> => {
    const db = openDatabase(dbPath, { readonly: true });
    try {
      return (db.prepare(`SELECT event_id, session_id, phase_id, type, name, payload_json, started_at FROM events
        WHERE type = 'decision' ORDER BY event_row`).all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));
    } finally { db.close(); }
  };
  try {
    await newCommand({
      stateRoot: box.stateRoot, project: PROJECT, taskId: "rebuild-task", repository: box.root,
      request: "open rebuild-task", workflow: "build", tier: 1, sessionId: () => "rebuild-task-session",
      projectRecord: projection.project,
    });
    const ctx = (overrides: Partial<DecideContext<StopJudgmentParams>>, outcome: JevOutcome) =>
      context(box, stub(outcome), { taskId: "rebuild-task", projectDecision: projection.projectDecision, ...overrides });
    await decide(STOP_JUDGMENT, "s", ctx({}, answered()));
    await decide(STOP_JUDGMENT, "s", ctx({ caller: { kind: "phase-hook", name: "build:after-gates" } }, {
      outcome: "unavailable", reason: "timeout", detail: "Jev did not answer inside the deadline.",
      requestedModel: JEV_DEFAULT_MODEL, attempts: 2, elapsedMs: 30_000, redacted: true, requestText: REQUEST_TEXT,
    }));
    // A task-level call (attempt null) lands on the task's newest attempt.
    await decide(STOP_JUDGMENT, "s", ctx({ attempt: null, caller: { kind: "replay", name: "delegate-replay" } }, {
      outcome: "refused-by-switch", detail: "off",
    }));
    const records = await readTaskDecisions(taskRoot(box.stateRoot, PROJECT, "rebuild-task"));
    assert.equal(records.length, 3);
    // Projecting the same record again is a no-op: the row id is the record's id.
    projection.projectDecision(records[0]!);
    projection.close();

    const live = rows();
    assert.equal(live.length, 3);
    assert.deepEqual(live.map((row) => row.event_id), records.map((record) => `rebuild-task-session:decision:${record.id}`));
    assert.deepEqual(live.map((row) => row.name), [
      "stop-judgment@1 answered", "stop-judgment@1 unavailable", "stop-judgment@1 refused-by-switch",
    ]);
    assert.deepEqual(live.map((row) => JSON.parse(row.payload_json as string)), records, "the payload is the record");
    assert.ok(live.every((row) => row.phase_id === null && row.started_at === AT));

    // From nothing: no database at all, only the journals.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    assert.equal(existsSync(dbPath), false);
    const report = await rebuildCommand(box.stateRoot);
    assert.equal(report.ok, true, report.ok ? undefined : report.reason);
    assert.deepEqual(rows(), live, "the rebuilt database holds the same decision rows in the same order");
    assert.ok(readFileSync(decisionsFilePath(taskRoot(box.stateRoot, PROJECT, "rebuild-task")), "utf8").split("\n").filter(Boolean).length === 3);
  } finally { projection.close(); box.close(); }
});
