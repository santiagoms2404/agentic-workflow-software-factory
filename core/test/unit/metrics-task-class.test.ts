import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { TicketSchema, TICKET_TASK_CLASSES } from "../../src/contracts/ticket.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { parsePlanTicketData } from "../../src/persistence/plan-tickets.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { runGit, systemGitRunner } from "../../src/git/changes.ts";
import { ShiftTicketUnreadable } from "../../src/workflow/shift/compile.ts";
import { readShiftTaskClasses, shiftTaskClasses } from "../../src/metrics/task-class.ts";
import { buildRoleRows, readRunFacts } from "../../src/metrics/role-rows.ts";
import { buildMetricsPayload } from "../../src/metrics/payload.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { metricsFilter, metricsReadout, filterRows } from "../../src/cli/commands/metrics.ts";
import { main } from "../../src/cli/main.ts";
import { facetOptions, DEFAULT_METRICS_ROUTE, metricsRouteHash, parseMetricsRoute, rowsInLens, withSelection } from "../../../dashboard/src/metrics-lens.ts";
import { groupRows } from "../../../dashboard/src/metrics-ledger.ts";
import { frontier, recommend, taskClassOf, verdicts } from "../../../dashboard/shared/route-metrics.ts";
import { listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { AT, phase, session, SyntheticAttempt, usage } from "./_metrics-journal.ts";

function ticket(id: string, taskClass: unknown): string {
  return `---\nid: ${id}\ntitle: Fixture\nmilestone: M1\nstate: todo\ndepends_on: []\ntask_class: ${JSON.stringify(taskClass)}\n---\n## Build prompt\n\n\`\`\`\nBuild the fixture.\n\`\`\`\n`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awsf-task-class-"));
  const first = ticket("T01", TICKET_TASK_CLASSES[0]);
  const second = ticket("T02", TICKET_TASK_CLASSES[1]);
  const bodies = new Map([["T01.md", first], ["T02.md", second]]);
  for (const [name, body] of bodies) writeFileSync(join(root, name), body);
  const shift = sealShiftManifest({ plan: "fixture", milestones: ["M1"], tickets: [...bodies].map(([path, body]) => ({
    id: path.slice(0, 3), path, digest: ticketFileDigest(Buffer.from(body)),
  })) });
  mkdirSync(join(root, "attempt"));
  writeFileSync(join(root, "attempt/status.json"), JSON.stringify({ repository: root, baseSha: null, shift }));
  return { root, bodies, shift };
}

function run(root: string) {
  const attempt = new SyntheticAttempt({ ...session("classes"), journalPath: join(root, "attempt/journal.jsonl"), planRef: "fixture" });
  for (const [index, key] of ["t01-build", "t02-build"].entries()) {
    const phaseId = `phase-${key}`;
    attempt.phase(phase(key, "builder", { ordinal: index * 3 + 2 }));
    attempt.start(phaseId, "builder", "codex", "openai-codex", "codex:gpt-6-sol");
    attempt.event(phaseId, key, { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
    attempt.event(phaseId, key, { kind: "usage", usage: usage(100, 10, 0, 0, null) });
    attempt.call(phaseId, "builder", "codex", "openai-codex", "codex:gpt-6-sol", "gpt-6-sol", usage(100, 10, 0, 0, null));
    attempt.envelope(phaseId, "builder", 0, "success");
    attempt.gate(phaseId, 0, "diff_matches_claims", index === 0);
    attempt.phase(phase(key, "builder", { ordinal: index * 3 + 2, status: "SUCCEEDED", endedAt: AT }));
    attempt.phase(phase(`t0${index + 1}-tests`, "host", {
      ordinal: index * 3 + 3, kind: "code", status: index === 0 ? "SUCCEEDED" : "FAILED",
      errorCode: index === 0 ? null : "CommandPhaseFailure", endedAt: AT,
    }));
  }
  attempt.phase(phase("shift-review", "reviewer", { ordinal: 8, status: "SUCCEEDED", endedAt: AT }));
  attempt.transition("BLOCKED", "phase-abort");
  return attempt;
}

test("ticket task class is optional, uses one vocabulary, and rejects invalid values without coercion", () => {
  for (const taskClass of TICKET_TASK_CLASSES) {
    assert.equal(parsePlanTicketData(ticket("T01", taskClass))?.task_class, taskClass);
  }
  const base = { id: "T01", title: "Fixture", milestone: "M1", tier: 2, state: "todo", depends_on: [], workflow: "build",
    outcome: "change", context: [], acceptance: [], non_goals: [] };
  assert.equal(Value.Check(TicketSchema, base), true);
  for (const value of ["unclassified", "other", "", null, 0, [TICKET_TASK_CLASSES[0]]]) {
    assert.equal(parsePlanTicketData(ticket("T01", value)), null);
    assert.equal(Value.Check(TicketSchema, { ...base, task_class: value }), false);
  }
  assert.equal(parsePlanTicketData(ticket("T01", TICKET_TASK_CLASSES[0]).replace(/^task_class:.*\n/m, ""))?.task_class, undefined);
  assert.equal(Value.Check(TicketSchema, { ...base, task_class: TICKET_TASK_CLASSES[0] }), true);
});

test("the shift join uses sealed ticket bytes at the recorded base and excludes the review tail", () => {
  const f = fixture();
  try {
    // Today's ticket changed at owner bookkeeping; recorded blobs still classify the run.
    writeFileSync(join(f.root, "T01.md"), ticket("T01", TICKET_TASK_CLASSES[2]));
    const baseSha = "a".repeat(40);
    const classes = shiftTaskClasses({ repository: f.root, baseSha, shift: f.shift }, (argv) => {
      assert.deepEqual(argv.slice(0, 2), ["cat-file", "blob"]);
      assert.ok(argv[2]!.startsWith(`${baseSha}:`));
      return { status: 0, stdout: Buffer.from(f.bodies.get(argv[2]!.slice(41))!), stderr: "", error: null };
    });
    assert.deepEqual([...classes], [["t01-build", TICKET_TASK_CLASSES[0]], ["t02-build", TICKET_TASK_CLASSES[1]]]);
    assert.equal(classes.has("shift-review"), false);
    assert.equal(readShiftTaskClasses(join(f.root, "attempt/journal.jsonl")).size, 0, "digest drift never invents a class");
    assert.equal(readShiftTaskClasses(join(f.root, "missing/journal.jsonl")).size, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

// B4-25: the sealed digest covers the bytes Git stored at the recorded base. A
// text round trip changed a non-UTF-8 ticket's bytes, so it refused as a digest
// mismatch that named the wrong cause. Real Git, so the bytes cross the real runner.
function committedTickets(root: string, files: Readonly<Record<string, Buffer>>) {
  const git = systemGitRunner(root);
  runGit(git, ["init", "--quiet", "-b", "main"]);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(root, name), bytes);
  runGit(git, ["add", "--", ...Object.keys(files)]);
  runGit(git, ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "--quiet", "--no-gpg-sign", "-m", "base"]);
  const shift = sealShiftManifest({ plan: "fixture", milestones: ["M1"], tickets: Object.entries(files).map(([path, bytes]) => ({
    id: path.slice(0, 3), path, digest: ticketFileDigest(bytes),
  })) });
  return { baseSha: runGit(git, ["rev-parse", "HEAD"]).trim(), shift };
}

test("B4-25: a sealed ticket that is not UTF-8 refuses on its own UTF-8 rule, never as a digest mismatch", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-task-class-bytes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // 0x93 is a Windows-1252 quotation mark: a sealed ticket whose bytes are not UTF-8.
  const bytes = Buffer.from(ticket("T01", TICKET_TASK_CLASSES[0]).replace("Fixture", "Fixture \x93quoted\x93"), "latin1");
  const { baseSha, shift } = committedTickets(root, { "T01.md": bytes });
  assert.throws(() => shiftTaskClasses({ repository: root, baseSha, shift }), (error: unknown) => {
    assert.ok(error instanceof ShiftTicketUnreadable, `expected an unreadable-ticket refusal, got ${String(error)}`);
    assert.equal(error.message, "ticket T01 cannot be compiled: its bytes are not valid UTF-8");
    return true;
  });
});

test("B4-25: a valid non-ASCII ticket at the recorded base still classifies its builder", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-task-class-utf8-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from(ticket("T01", TICKET_TASK_CLASSES[0]).replace("Fixture", "Fixture Café —"), "utf8");
  const { baseSha, shift } = committedTickets(root, { "T01.md": bytes });
  assert.deepEqual([...shiftTaskClasses({ repository: root, baseSha, shift })], [["t01-build", TICKET_TASK_CLASSES[0]]]);
});

test("the projected payload separates a shift's builder classes; tokens, calls, gates and blocks never cross classes", () => {
  const f = fixture();
  const db = openDatabase(":memory:");
  try {
    run(f.root).project(db);
    const payload = buildMetricsPayload(db, { extractedAt: AT });
    const [first, second, review] = payload.roleRows;
    assert.deepEqual(payload.roleRows.map((row) => [row.role, row.taskClass]), [
      ["builder", TICKET_TASK_CLASSES[0]], ["builder", TICKET_TASK_CLASSES[1]], ["reviewer", "unclassified"],
    ]);
    assert.equal(first!.calls, 1);
    assert.equal(second!.calls, 1);
    assert.equal(first!.tokens.inputTokens, 100);
    assert.equal(second!.tokens.inputTokens, 100);
    assert.equal(first!.claims, 1);
    assert.equal(second!.claims, 1);
    assert.equal(first!.refuted, 0);
    assert.equal(second!.refuted, 1);
    assert.equal(first!.blockedHere, false);
    assert.equal(second!.blockedHere, true);
    assert.equal(review!.blockedHere, false);
    const facts = readRunFacts(db)[0]!;
    const other = buildRoleRows([{ ...facts, workflowId: "build-review" }]);
    assert.ok(other.every((row) => row.taskClass === "unclassified"));
    assert.equal(other[0]!.phases, 2);
    assert.equal(other[0]!.calls, 2);
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("CLI and dashboard filters compare within class and refuse pooled verdicts", async () => {
  const f = fixture();
  const dbPath = join(f.root, "awsf.db");
  const db = openDatabase(dbPath);
  try {
    run(f.root).project(db);
    const payload = buildMetricsPayload(db, { extractedAt: AT });
    const filter = metricsFilter({ role: "builder", taskClass: TICKET_TASK_CLASSES[0] });
    assert.equal(filterRows(payload.roleRows, filter).length, 1);
    const text = metricsReadout(payload, metricsFilter({ role: "builder" })).join("\n");
    assert.ok(text.includes(`builder · ${TICKET_TASK_CLASSES[0]}`));
    assert.ok(text.includes(`builder · ${TICKET_TASK_CLASSES[1]}`));
    assert.match(text, /Insufficient evidence: n 1/);
    assert.doesNotMatch(text, /Insufficient evidence: n 2/);
    const output: string[] = [];
    assert.equal(await main({ argv: ["metrics", "--task-class", TICKET_TASK_CLASSES[0], "--state-root", f.root],
      writeOut: (line) => output.push(line), writeError: (line) => output.push(line) }), 0);
    assert.ok(output.join("\n").includes("1 role-rows"));
    assert.equal(await main({ argv: ["metrics", "--json", "--task-class", TICKET_TASK_CLASSES[0], "--state-root", f.root],
      writeOut: () => {}, writeError: () => {} }), 1);
    assert.throws(() => metricsFilter({ taskClass: "bogus" }), /--task-class/);

    const context = { rateCard: RATE_CARD.rows, roleColors: {}, priorLabels: {} };
    const options = facetOptions(payload.roleRows, DEFAULT_METRICS_ROUTE, "taskClass", context);
    assert.ok(options.some((option) => option.value === "unclassified"));
    const lens = withSelection(DEFAULT_METRICS_ROUTE, "taskClass", options.map((option) => option.value), [TICKET_TASK_CLASSES[0]]);
    assert.deepEqual(parseMetricsRoute(metricsRouteHash(lens)), lens);
    const scoped = rowsInLens(payload.roleRows, lens);
    assert.equal(scoped.length, 1);
    assert.equal(taskClassOf(scoped[0]!), TICKET_TASK_CLASSES[0]);
    const groups = groupRows(payload.roleRows, "taskClass", listPrice, context);
    assert.ok(groups.some((group) => group.title === "unclassified"));
    assert.deepEqual(verdicts(frontier(payload.roleRows, "builder", "first-pass", "list-per-row", listPrice)), []);
    assert.equal(recommend(payload.roleRows, "builder", null, "production", { price: listPrice, prior: () => null }), null);
    const advice = recommend(payload.roleRows, "builder", TICKET_TASK_CLASSES[0], "production", { price: listPrice, prior: () => null });
    assert.equal(advice?.choice.settled, 1);
    const legacy = { ...payload.roleRows[0]! };
    delete legacy.taskClass;
    const unclassified = recommend([legacy, ...payload.roleRows], "builder", "unclassified", "production", { price: listPrice, prior: () => null });
    assert.equal(unclassified?.choice.settled, 1, "unclassified is not a wildcard for ticket classes");
    assert.equal(readFileSync(join(f.root, "T01.md"), "utf8"), f.bodies.get("T01.md"));
  } finally {
    db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
