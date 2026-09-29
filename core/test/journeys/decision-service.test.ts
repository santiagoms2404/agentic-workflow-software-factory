// W19 M1 task 3: the decision service end to end, offline. A real JevTransport
// with global fetch stubbed (no live call: the live smoke was the owner's act,
// once, on 2026-09-28) answers decide() once for each outcome. Each call leaves
// exactly one record in the task's decisions.jsonl and one `decision` events
// row, `awsf db rebuild` from no database reproduces the rows, and `awsf doctor`
// reports the Jev row with the key as set or unset and nothing else about it.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/main.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { taskRoot } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { decide } from "../../src/decision/decide.ts";
import { JEV_DEFAULT_MODEL, JEV_ENDPOINT, JEV_KEY_ENV, JevTransport } from "../../src/decision/jev-transport.ts";
import { STOP_JUDGMENT, type StopJudgmentParams } from "../../src/decision/question-sets/stop-judgment.ts";
import { decisionsFilePath, readTaskDecisions } from "../../src/persistence/task-decisions.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";

const PROJECT = "sample";
const TASK = "decision-journey";
// Not a credential: a placeholder that only has to be present and nonblank.
const KEY = "journey-placeholder-key-never-printed";
const PARAMS: StopJudgmentParams = { allowedActs: ["raise", "cancel"] };
const STATE = { stop: "ceiling-pause", calls: { spent: 40, ceiling: 40 }, gates: "passing" };
const CATALOG = [
  "version: awsf.project/v1",
  "project:",
  `  slug: ${PROJECT}`,
  "repositories:",
  "  plans:",
  "    role: plan",
  "    default_branch: main",
  "plans:",
  "  root: specs",
  "  format: awsf-plan-html/v1",
].join("\n");

/** The smoke answer's shape on stop-judgment v1's own questions. */
function answerBody(choice = "raise"): string {
  const risk = STOP_JUDGMENT.questions(PARAMS).risk;
  assert.ok(risk?.type === "score");
  return JSON.stringify({
    model: "typesafe/jev-1.13-20260917",
    answers: {
      progressing: { type: "noul", noul: 0.81 },
      next_act: { type: "choice", choice, probabilities: { raise: 0.75, cancel: 0, wait_for_owner: 0.2, other: 0.05 }, confidence: 0.68 },
      risk: {
        type: "score", score: 0.97, legend: Object.fromEntries(risk.criteria.map((level, index) => [String(index), level])),
        probabilities: { "0": 0.3, "1": 0.43, "2": 0.27 }, confidence: 0.4,
      },
    },
    usage: { input_tokens: 670, output_tokens: 88, cost: 0.00002814 },
  });
}

/** Global fetch replaced by one scripted response per call; every call must be the endpoint. */
function stubFetch(t: TestContext, script: Array<() => Response>): { calls: number } {
  const seen = { calls: 0 };
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.equal(String(url), JEV_ENDPOINT);
    const step = script[seen.calls];
    seen.calls += 1;
    assert.ok(step, "fetch called more often than scripted");
    return step();
  });
  return seen;
}

test("decide() over a stubbed transport: one record per outcome, one row each, and an identical rebuild", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-decision-journey-"));
  const stateRoot = join(root, "state");
  const dbPath = join(stateRoot, "awsf.db");
  const projection = createDashboardProjection(stateRoot);
  const rows = (): Array<Record<string, unknown>> => {
    const db = openDatabase(dbPath, { readonly: true });
    try {
      return (db.prepare(`SELECT event_id, session_id, type, name, payload_json, started_at FROM events
        WHERE type = 'decision' ORDER BY event_row`).all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));
    } finally { db.close(); }
  };
  try {
    writeFileSync(join(root, "awsf.project.yaml"), CATALOG);
    await newCommand({
      stateRoot, project: PROJECT, taskId: TASK, repository: root, request: "open the decision journey",
      workflow: "build", tier: 1, sessionId: () => "decision-journey-session", projectRecord: projection.project,
    });
    const fetched = stubFetch(t, [
      () => new Response(answerBody(), { status: 200 }),
      () => new Response(answerBody("undeclared-act"), { status: 200 }),
      () => new Response("", { status: 401 }),
    ]);
    const on = new JevTransport({ projectSwitch: "on", env: { [JEV_KEY_ENV]: KEY }, retryBaseMs: 0 });
    const off = new JevTransport({ projectSwitch: "off", env: { [JEV_KEY_ENV]: KEY } });
    let clock = 0;
    const context = (transport: JevTransport) => ({
      transport, taskRoot: taskRoot(stateRoot, PROJECT, TASK), project: PROJECT, taskId: TASK, attempt: 1,
      caller: { kind: "stop" as const, name: "ceiling-pause" }, params: PARAMS,
      projectDecision: projection.projectDecision,
      now: () => `2026-09-29T12:00:0${String(clock++)}.000Z`,
    });

    const answered = await decide(STOP_JUDGMENT, STATE, context(on));
    const broken = await decide(STOP_JUDGMENT, STATE, context(on));
    const unavailable = await decide(STOP_JUDGMENT, STATE, context(on));
    const refused = await decide(STOP_JUDGMENT, STATE, context(off));
    assert.equal(fetched.calls, 3, "the switched-off call never reached fetch");

    assert.equal(answered.outcome, "answered");
    assert.deepEqual(answered.policyResult, { kind: "wait", reason: "low-confidence" }, "the smoke answer is a wait");
    assert.equal(answered.record.resolvedModel, "typesafe/jev-1.13-20260917");
    assert.deepEqual(answered.record.cost, { amount: 0.00002814, source: "reported" });
    assert.equal(broken.outcome, "contract-error");
    assert.match(broken.record.detail ?? "", /Undeclared choice returned: next_act/);
    assert.equal(unavailable.outcome, "unavailable");
    assert.deepEqual([unavailable.record.reason, unavailable.record.status], ["http-status", 401]);
    assert.equal(refused.outcome, "refused-by-switch");
    assert.equal(refused.record.requestedModel, JEV_DEFAULT_MODEL);
    for (const decision of [broken, unavailable, refused]) assert.equal(decision.policyResult, null);

    // One record per call, in call order, and nothing in any record that looks like the key.
    const file = decisionsFilePath(taskRoot(stateRoot, PROJECT, TASK));
    const records = await readTaskDecisions(taskRoot(stateRoot, PROJECT, TASK));
    assert.deepEqual(records.map((record) => record.outcome), ["answered", "contract-error", "unavailable", "refused-by-switch"]);
    assert.deepEqual(records.map((record) => record.id), [answered, broken, unavailable, refused].map((decision) => decision.recordId));
    assert.equal(readFileSync(file, "utf8").includes(KEY), false);
    projection.close();

    // One projected row per record, the record as its payload.
    const live = rows();
    assert.deepEqual(live.map((row) => row.name), [
      "stop-judgment@1 answered", "stop-judgment@1 contract-error", "stop-judgment@1 unavailable", "stop-judgment@1 refused-by-switch",
    ]);
    assert.deepEqual(live.map((row) => JSON.parse(row.payload_json as string)), records);
    assert.ok(live.every((row) => row.session_id === "decision-journey-session"));

    // `awsf db rebuild` from no database at all: the same rows in the same order.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    assert.equal(existsSync(dbPath), false);
    const out: string[] = [];
    const err: string[] = [];
    const code = await main({ argv: ["db", "rebuild", "--state-root", stateRoot], cwd: root, writeOut: (line) => out.push(line), writeError: (line) => err.push(line) });
    assert.equal(code, 0, err.join("\n"));
    assert.deepEqual(rows(), live);
  } finally { projection.close(); rmSync(root, { recursive: true, force: true }); }
});

test("awsf doctor shows the Jev row: the switch, the key as set or unset and nothing else about it, the model and the fence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-decision-doctor-"));
  t.mock.method(globalThis, "fetch", () => { throw new Error("doctor must make no network call"); });
  try {
    const doctor = async (env: NodeJS.ProcessEnv): Promise<{ code: number; jev: string[] }> => {
      const out: string[] = [];
      const code = await main({ argv: ["doctor", "--state-root", join(root, "state")], cwd: root, env, writeOut: (line) => out.push(line) });
      return { code, jev: out.filter((line) => line.includes("jev") || line.includes(JEV_KEY_ENV) || line.includes(KEY)) };
    };
    writeFileSync(join(root, "awsf.project.yaml"), `${CATALOG}\ndecision:\n  jev: off`);
    const set = await doctor({ [JEV_KEY_ENV]: KEY });
    assert.equal(set.code, 0);
    assert.equal(set.jev.length, 1, "one Jev row, and the key appears nowhere else");
    assert.match(set.jev[0]!, new RegExp(
      `^jev: switch off \\(catalog\\); ${JEV_KEY_ENV} set; requested model ${JEV_DEFAULT_MODEL.replace(/[~/.]/g, "\\$&")}; fence intact \\(.*\\); no network call made$`,
    ));
    // The length check runs in core/test/unit/decision/jev-doctor.test.ts, over a
    // one-file source tree where no file count can collide with it.
    assert.equal(set.jev[0]!.includes(KEY), false);

    writeFileSync(join(root, "awsf.project.yaml"), CATALOG);
    const unset = await doctor({});
    assert.equal(unset.code, 0, "an unset key is a fallback, not a finding");
    assert.match(unset.jev[0]!, new RegExp(`^jev: switch on \\(default\\); ${JEV_KEY_ENV} unset; `));
    assert.equal((globalThis.fetch as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
