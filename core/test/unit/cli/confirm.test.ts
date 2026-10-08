// `awsf confirm` — the owner's confirmation of a DRAFT attempt's request and
// paths (specs/awsf-v3-w01-driver-checks.html, task 10), driven through
// confirmCommand with a fake owner terminal, and through its main.ts arm,
// which gate G01-C wired.
//
// Under test: a non-interactive terminal is refused before anything is read; a
// decline writes nothing; a yes writes exactly one record bound to the request
// digest and the digest of the latest preflight's --where and --read, which the
// projector writes as one events row and `awsf db rebuild` reproduces; the
// owner is shown the request, the paths, each consulted attempt's blocker and
// cause, and each field's result; and an edit to the request or paths after the
// confirmation leaves it stale under T08's freshness rule.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
} from "../../../src/cli/commands/attempt.ts";
import {
  ConfirmAttemptNotDraft,
  ConfirmNotInteractive,
  ConfirmPreflightMissing,
  confirmCommand,
  type ConfirmCommandOptions,
} from "../../../src/cli/commands/confirm.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { ATTRIBUTION_RECORD_SCHEMA_ID } from "../../../src/contracts/attribution-record.ts";
import {
  DRIVER_PREFLIGHT_SCHEMA_ID,
  K1_FIELD_IDS,
  assertRequestConfirmationRecord,
  k1FieldKind,
  requestPathsDigest,
  requestTextDigest,
  type DriverPreflightRecord,
  type RequestConfirmationRecord,
} from "../../../src/contracts/driver-preflight.ts";
import { main } from "../../../src/cli/main.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { appendTaskAttribution } from "../../../src/persistence/task-attributions.ts";
import { evaluateFreshness, type FreshnessFacts } from "../../../src/preflight/fields.ts";

const PROJECT = "agentic-workflow-software-factory";
const REQUEST = [
  "Ask: add an example module",
  "Where: core/src/example.ts",
  "Done means: the module exists and its test passes",
  "Out of scope: everything else",
].join("\n");
const BASE = "a".repeat(40);
const CONFIG = "c".repeat(64);
const AT = "2026-10-06T12:00:00.000Z";

interface Box { readonly root: string; readonly stateRoot: string; close(): void }

function sandbox(label: string): Box {
  const root = mkdtempSync(join(tmpdir(), `awsf-confirm-${label}-`));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

function terminal(answer: boolean | (() => Promise<boolean>), interactive = true, lines: string[] = [], prompts: string[] = []): OwnerTerminal {
  return {
    interactive,
    write: (line) => { lines.push(line); },
    confirm: async (prompt) => { prompts.push(prompt); return typeof answer === "boolean" ? answer : answer(); },
  };
}

/** A terminal that fails the test if the command so much as writes to it. */
function untouchable(): OwnerTerminal {
  return {
    interactive: false,
    write: () => { throw new Error("a non-interactive terminal was written to"); },
    confirm: () => { throw new Error("a non-interactive terminal was asked"); },
  };
}

async function draft(box: Box, taskId: string, extra: { continuesTask?: string; request?: string; projectRecord?: AttemptProjector } = {}) {
  return newCommand({
    stateRoot: box.stateRoot, project: PROJECT, taskId, repository: box.root, request: extra.request ?? REQUEST,
    workflow: "build-review", tier: 2, sessionId: () => `${taskId}-session`,
    ...(extra.continuesTask === undefined ? {} : { continuesTask: extra.continuesTask }),
    ...(extra.projectRecord === undefined ? {} : { projectRecord: extra.projectRecord }),
  });
}

/** Appends a preflight record as `awsf preflight` would, every measured field passing unless overridden. */
async function preflight(attemptDir: string, overrides: Partial<DriverPreflightRecord> = {}, projectRecord?: AttemptProjector): Promise<DriverPreflightRecord> {
  const status = await readAttempt(attemptDir);
  const record: DriverPreflightRecord = {
    schema: DRIVER_PREFLIGHT_SCHEMA_ID, project: status.project, taskId: status.taskId, attempt: status.attempt,
    sessionId: status.sessionId, baseSha: BASE, configDigest: CONFIG, requestDigest: requestTextDigest(status.request),
    where: ["core/src/example.ts"], read: [], consulted: [],
    fields: K1_FIELD_IDS.map((id) => id === "confirmation"
      ? { id, kind: k1FieldKind(id), passed: false, reason: "no owner confirmation of this request is recorded for this attempt" }
      : { id, kind: k1FieldKind(id), passed: true, reason: null }),
    suite: { source: "preflight-run", rows: [{ gateId: "test", sha: BASE, gatesConfigDigest: CONFIG, passed: true, exitCode: 0 }] },
    protectedPlan: [], at: "2026-10-06T11:00:00.000Z", ...overrides,
  };
  await persistAttempt(attemptDir, status.revision, {
    kind: "attempt.updated", next: nextRevision(status, {}), evidence: { type: "driver-preflight", record },
  }, projectRecord);
  return record;
}

async function confirmations(attemptDir: string): Promise<RequestConfirmationRecord[]> {
  return (await readAttemptEvidence(attemptDir)).flatMap((evidence) => evidence.type === "request-confirmation" ? [evidence.record] : []);
}

async function latestPreflight(attemptDir: string): Promise<DriverPreflightRecord> {
  const record = (await readAttemptEvidence(attemptDir)).flatMap((evidence) => evidence.type === "driver-preflight" ? [evidence.record] : []).at(-1);
  assert.ok(record !== undefined);
  return record;
}

function journal(attemptDir: string): string {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8");
}

function options(box: Box, taskId: string, overrides: Partial<ConfirmCommandOptions> = {}): ConfirmCommandOptions {
  return { stateRoot: box.stateRoot, project: PROJECT, taskId, terminal: terminal(true), now: () => AT, ...overrides };
}

/** The start-time facts with git-storage and duplicate passing, so only the record and confirmations decide. */
async function freshness(attemptDir: string): Promise<FreshnessFacts> {
  const status = await readAttempt(attemptDir);
  return {
    record: await latestPreflight(attemptDir),
    current: {
      project: status.project, taskId: status.taskId, attempt: status.attempt, baseSha: BASE, configDigest: CONFIG,
      requestDigest: requestTextDigest(status.request),
    },
    gitStorage: { entries: [{ path: "/git/HEAD", mode: 0o100644 }] },
    duplicate: { taskId: status.taskId, chain: [], requestDigest: "d".repeat(64), planRef: null, others: [] },
    confirmations: await confirmations(attemptDir),
  };
}

test("a non-interactive terminal is refused before anything is read", async () => {
  const box = sandbox("piped");
  try {
    // No state root exists at all: any read before the medium check would fail differently.
    await assert.rejects(confirmCommand(options(box, "no-such-task", { terminal: untouchable() })), ConfirmNotInteractive);
    assert.equal(existsSync(box.stateRoot), false, "nothing was read or created");

    const created = await draft(box, "piped");
    await preflight(created.attemptDir);
    const before = journal(created.attemptDir);
    await assert.rejects(
      confirmCommand(options(box, "piped", { terminal: untouchable() })),
      (error: unknown) => error instanceof ConfirmNotInteractive && /requires an interactive owner terminal/u.test(error.message),
    );
    assert.equal(journal(created.attemptDir), before);
  } finally { box.close(); }
});

test("a decline writes nothing, after the owner is shown the request, paths and fields in order", async () => {
  const box = sandbox("declined");
  try {
    const created = await draft(box, "declined");
    await preflight(created.attemptDir, { where: ["core/src/example.ts"], read: ["AGENTS.md"] });
    const before = journal(created.attemptDir);
    const lines: string[] = [];
    const prompts: string[] = [];
    const result = await confirmCommand(options(box, "declined", { terminal: terminal(false, true, lines, prompts) }));
    assert.equal(result.confirmed, false);
    assert.equal(result.record, null);
    assert.equal(journal(created.attemptDir), before, "a decline writes nothing");
    assert.deepEqual(await confirmations(created.attemptDir), []);
    assert.deepEqual(prompts, ["Confirm the request and paths of declined attempt 1?"]);
    assert.deepEqual(lines.slice(0, 9), [
      `Task: ${PROJECT}/declined attempt 1, T2, build-review, DRAFT`,
      "Ask: add an example module",
      "Where: core/src/example.ts",
      "Done means: the module exists and its test passes",
      "Out of scope: everything else",
      "--where (from the preflight at 2026-10-06T11:00:00.000Z): core/src/example.ts",
      "--read: AGENTS.md",
      "Consulted prior attempts: none",
      `Preflight fields at ${BASE}:`,
    ]);
    assert.deepEqual(lines.slice(9, 9 + K1_FIELD_IDS.length), K1_FIELD_IDS.map((id) => id === "confirmation"
      ? "  confirmation: refused — no owner confirmation of this request is recorded for this attempt"
      : `  ${id}: pass`));
  } finally { box.close(); }
});

test("a yes writes one record bound to the request and paths digests, projected as one events row that rebuild reproduces", async () => {
  const box = sandbox("confirmed");
  try {
    const projection = createDashboardProjection(box.stateRoot);
    let created;
    let result;
    try {
      created = await draft(box, "confirmed", { projectRecord: projection.project });
      await preflight(created.attemptDir, { where: ["core/src/example.ts", "core/test/**"], read: ["AGENTS.md"] }, projection.project);
      result = await confirmCommand(options(box, "confirmed", { projectRecord: projection.project }));
    } finally { projection.close(); }
    assert.equal(result.confirmed, true);
    assert.deepEqual(result.record, {
      schema: "awsf.request-confirmation/v1", project: PROJECT, taskId: "confirmed", attempt: 1,
      requestDigest: requestTextDigest(REQUEST),
      pathsDigest: requestPathsDigest(["core/src/example.ts", "core/test/**"], ["AGENTS.md"]),
      at: AT,
    });
    const written = await confirmations(created.attemptDir);
    assert.equal(written.length, 1, "exactly one record");
    assertRequestConfirmationRecord(written[0]);
    assert.deepEqual(written[0], result.record);
    const status = await readAttempt(created.attemptDir);
    assert.equal(status.lifecycleState, "DRAFT", "the confirmation moves no lifecycle edge");
    assert.equal(status.budget.callsReserved, 0);
    assert.deepEqual(evaluateFreshness(await freshness(created.attemptDir)), { passed: true });

    const rows = (): unknown[] => {
      const db = openDatabase(join(box.stateRoot, "awsf.db"), { readonly: true });
      try {
        return db.prepare("SELECT event_id, session_id, type, name, payload_json, started_at FROM events WHERE name = 'request confirmation'").all();
      } finally { db.close(); }
    };
    const live = rows();
    assert.equal(live.length, 1, "one events row per record");
    const row = live[0] as { type: string; payload_json: string; started_at: string };
    assert.equal(row.type, "notice");
    assert.deepEqual(JSON.parse(row.payload_json), result.record);
    assert.equal(row.started_at, AT);
    const report = await rebuildCommand(box.stateRoot);
    assert.equal(report.ok, true);
    assert.deepEqual(rows(), live);
  } finally { box.close(); }
});

test("a request or path edit after the confirmation leaves it stale under the freshness rule", async () => {
  const box = sandbox("stale");
  try {
    const created = await draft(box, "stale");
    await preflight(created.attemptDir);
    await confirmCommand(options(box, "stale"));
    assert.deepEqual(evaluateFreshness(await freshness(created.attemptDir)), { passed: true });

    const status = await readAttempt(created.attemptDir);
    await persistAttempt(created.attemptDir, status.revision, {
      kind: "attempt.updated", next: nextRevision(status, { request: REQUEST.replace("an example", "a different") }),
    });
    const edited = evaluateFreshness(await freshness(created.attemptDir));
    assert.equal(edited.passed, false);
    assert.equal(edited.passed ? null : edited.refusal, "stale-request", "the record no longer binds the current request");

    // A new preflight of the edited text clears the record's binding but not the owner's.
    await preflight(created.attemptDir);
    const reconfirm = evaluateFreshness(await freshness(created.attemptDir));
    assert.deepEqual(reconfirm, {
      passed: false, refusal: "field-failed", field: "confirmation",
      reason: "the owner's confirmation is bound to other request text: the request changed after it was confirmed",
    });
    await confirmCommand(options(box, "stale"));
    assert.deepEqual(evaluateFreshness(await freshness(created.attemptDir)), { passed: true });

    // A preflight with other paths leaves the confirmation bound to the old ones.
    await preflight(created.attemptDir, { where: ["core/src/example.ts"], read: ["core/src/state/guards.ts"] });
    const paths = evaluateFreshness(await freshness(created.attemptDir));
    assert.equal(paths.passed ? null : paths.reason, "the owner's confirmation is bound to other --where or --read paths: the paths changed after they were confirmed");
    assert.equal((await confirmations(created.attemptDir)).length, 2, "every confirmation stays on file");
  } finally { box.close(); }
});

test("each consulted attempt is shown with its blocker and its cause, when recorded", async () => {
  const box = sandbox("consulted");
  try {
    const parent = await draft(box, "parent", { request: REQUEST.replace("an example", "a parent") });
    await persistAttempt(parent.attemptDir, parent.status.revision, {
      kind: "attempt.updated",
      next: nextRevision(parent.status, {
        lifecycleState: "BLOCKED",
        blocker: { code: "PermissionBreach", detail: "wrote core/src/state/guards.ts", ahead: null, behind: null },
      }),
    });
    await appendTaskAttribution(taskRoot(box.stateRoot, PROJECT, "parent"), {
      schema: ATTRIBUTION_RECORD_SCHEMA_ID, project: PROJECT, taskId: "parent", attempt: 1,
      cause: "driver", reason: "the request named the protected path as its target", at: AT, trap: { kind: "trap", id: "TR-03" },
    });
    const sibling = await draft(box, "sibling", { request: REQUEST.replace("an example", "a sibling") });
    await persistAttempt(sibling.attemptDir, sibling.status.revision, {
      kind: "attempt.updated", next: nextRevision(sibling.status, { lifecycleState: "CANCELLED" }),
    });
    const child = await draft(box, "child", { continuesTask: "parent" });
    await preflight(child.attemptDir, { consulted: ["parent-session", "sibling-session"] });
    const lines: string[] = [];
    await confirmCommand(options(box, "child", { terminal: terminal(false, true, lines) }));
    const start = lines.indexOf("Consulted prior attempts:");
    assert.deepEqual(lines.slice(start, start + 3), [
      "Consulted prior attempts:",
      "  parent-session: parent attempt 1, BLOCKED; blocker PermissionBreach: wrote core/src/state/guards.ts; " +
        "cause driver: the request named the protected path as its target",
      "  sibling-session: not an attempt of this task or of a task it continues",
    ]);
  } finally { box.close(); }
});

test("a request without the four lines is shown as written, and an edit since the preflight is named", async () => {
  const box = sandbox("shape");
  try {
    const created = await draft(box, "shape", { request: "Ask: do something\nDone means: it is done" });
    await preflight(created.attemptDir, { requestDigest: requestTextDigest(REQUEST) });
    const lines: string[] = [];
    await confirmCommand(options(box, "shape", { terminal: terminal(false, true, lines) }));
    assert.deepEqual(lines.slice(1, 4), [
      "The request does not have the four lines (the request has no Where: line; write the four lines Ask:, Where:, Done means: and Out of scope:, in that order). As written:",
      "  Ask: do something",
      "  Done means: it is done",
    ]);
    assert.ok(lines.includes("The request was edited after this preflight was measured; its field results describe other text."));
  } finally { box.close(); }
});

test("only a DRAFT attempt with a preflight record can be confirmed, and a refusal writes nothing", async () => {
  const box = sandbox("refusals");
  try {
    const missing = await draft(box, "unmeasured");
    const before = journal(missing.attemptDir);
    const asked: string[] = [];
    await assert.rejects(confirmCommand(options(box, "unmeasured", { terminal: terminal(true, true, [], asked) })), ConfirmPreflightMissing);
    assert.equal(journal(missing.attemptDir), before);
    assert.deepEqual(asked, [], "the owner is never asked to confirm paths no record holds");

    const prepared = await draft(box, "prepared", { request: REQUEST.replace("an example", "a prepared") });
    await preflight(prepared.attemptDir);
    const status = await readAttempt(prepared.attemptDir);
    await persistAttempt(prepared.attemptDir, status.revision, {
      kind: "attempt.transitioned", next: nextRevision(status, { lifecycleState: "PREPARED" }),
    });
    const prior = journal(prepared.attemptDir);
    await assert.rejects(
      confirmCommand(options(box, "prepared")),
      (error: unknown) => error instanceof ConfirmAttemptNotDraft && /attempt 1 is PREPARED: only a DRAFT attempt's request can be confirmed/u.test(error.message),
    );
    assert.equal(journal(prepared.attemptDir), prior);
  } finally { box.close(); }
});

test("an attempt that moved while the question was open is not confirmed", async () => {
  const box = sandbox("moved");
  try {
    const created = await draft(box, "moved");
    await preflight(created.attemptDir);
    const moving = terminal(async () => {
      // A second preflight lands between what the owner read and their answer.
      await preflight(created.attemptDir, { where: ["core/src/other.ts"] });
      return true;
    });
    await assert.rejects(confirmCommand(options(box, "moved", { terminal: moving })), /attempt revision changed/u);
    assert.deepEqual(await confirmations(created.attemptDir), []);
  } finally { box.close(); }
});

test("the main.ts arm (gate G01-C) takes the owner terminal, records on yes, and records nothing when declined or piped", async () => {
  const box = sandbox("arm");
  try {
    const created = await draft(box, "arm-task");
    await preflight(created.attemptDir);
    const run = async (owner: OwnerTerminal, ...extra: string[]) => {
      const out: string[] = [];
      const errors: string[] = [];
      const code = await main({
        argv: ["confirm", "arm-task", "--state-root", box.stateRoot, "--config", resolve("awsf.config.yaml"), ...extra],
        cwd: resolve("."), terminal: owner, writeOut: (line) => out.push(line), writeError: (line) => errors.push(line),
      });
      return { code, out, errors };
    };

    const piped = await run(untouchable());
    assert.notEqual(piped.code, 0);
    assert.match(piped.errors.join("\n"), /interactive owner terminal/u);
    assert.deepEqual(await confirmations(created.attemptDir), []);

    const declined = await run(terminal(false));
    assert.equal(declined.code, 1);
    assert.deepEqual(await confirmations(created.attemptDir), []);

    const flagged = await run(terminal(true), "--where", "core/src/example.ts");
    assert.notEqual(flagged.code, 0, "confirm takes no path of its own; it binds the preflight's");
    assert.match(flagged.errors.join("\n"), /usage: awsf confirm/u);
    assert.deepEqual(await confirmations(created.attemptDir), []);

    const lines: string[] = [];
    const confirmed = await run(terminal(true, true, lines));
    assert.equal(confirmed.code, 0, confirmed.errors.join("\n"));
    assert.ok(lines.some((line) => line.startsWith("Ask: add an example module")));
    const records = await confirmations(created.attemptDir);
    assert.equal(records.length, 1);
    const status = await readAttempt(created.attemptDir);
    assert.equal(records[0]!.requestDigest, requestTextDigest(status.request));
    assert.equal(records[0]!.pathsDigest, requestPathsDigest(["core/src/example.ts"], []));
  } finally { box.close(); }
});
