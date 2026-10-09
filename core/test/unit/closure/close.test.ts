import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Value } from "@sinclair/typebox/value";
import { closeCommand, type CloseCommandOptions } from "../../../src/cli/commands/close.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { sealTicketSelection } from "../../../src/contracts/ticket-selection-record.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { ClosureRecordSchema, CLOSURE_RECORD_SCHEMA_ID } from "../../../src/contracts/closure-record.ts";
import { RECORD_SCHEMAS, ENVELOPE_SCHEMAS } from "../../../src/contracts/registry.ts";
import { readClosureSnapshot, closureGitRunner, verifyClosureCommit } from "../../../src/git/closure.ts";
import { runGit } from "../../../src/git/changes.ts";
import { closureDelta } from "../../../src/closure/delta.ts";
import { proposeClosure, applyClosureChoices } from "../../../src/closure/propose.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { recoveryDigest } from "../../../src/contracts/phase-recovery.ts";
import { compileShift } from "../../../src/workflow/shift/compile.ts";
import { closureJournalRecords } from "../../../src/persistence/closure-journal.ts";
import { projectClosureJournalRecords } from "../../../src/persistence/project-closure-journal.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { projectAttemptStatus } from "../../../src/observability/projector.ts";
import { toAttemptStatusProjection } from "../../../src/cli/commands/attempt-projection.ts";
import { OWNER_ACT_COMMANDS } from "../../../src/lifecycle/next-steps.ts";
import { main } from "../../../src/cli/main.ts";

const planPath = "plans/sample.html";
const ticketPath = (id: string) => `plans/tickets/sample/${id}.md`;
const fixturePlan = `<section id="phases">
<h3><code class="status">[]</code> Milestone M1: One</h3>
<h4>1. First task</h4>
<ul><li><code class="status">[]</code> First row.</li><li><code class="status">[]</code> Second row.</li></ul>
<h4>2. Second task</h4>
<ul><li><code class="status">[]</code> Last row.</li></ul>
</section>
<p><code class="status">[]</code> Outside the parser, unchanged.</p>\n`;
const fixtureTicket = (id: string) => `---
id: ${id}
title: ${id === "T01" ? "First task" : "Second task"}
milestone: M1
state: todo
depends_on: []
workflow: build-review
---
# Ticket

## Handoff

Findings.

## Build prompt

\`\`\`
Build ${id}.
\`\`\`
`;

async function world() {
  // Every closure runs only on this synthetic repository and synthetic journal.
  const root = mkdtempSync(join(tmpdir(), "awsf-closure-unit-"));
  const repository = join(root, "repository");
  mkdirSync(join(repository, "plans/tickets/sample"), { recursive: true });
  const git = closureGitRunner(repository);
  runGit(git, ["init", "-b", "main"]);
  runGit(git, ["config", "user.name", "Fixture Owner"]);
  runGit(git, ["config", "user.email", "owner@example.invalid"]);
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: sample}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, planPath), fixturePlan);
  writeFileSync(join(repository, "plans/sample-build-prompts.md"), `# Section B — Task prompts (recommended)
### T01 — First task

\`\`\`
Build T01.
\`\`\`

### T02 — Second task

\`\`\`
Build T02.
\`\`\`
`);
  for (const id of ["T01", "T02"]) writeFileSync(join(repository, ticketPath(id)), fixtureTicket(id));
  writeFileSync(join(repository, "binary.dat"), Buffer.from([255, 0, 128]));
  runGit(git, ["add", "."]);
  runGit(git, ["commit", "-m", "fixture base"]);
  const base = runGit(git, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(repository, "source.txt"), "built\n");
  runGit(git, ["add", "."]);
  runGit(git, ["commit", "-m", "fixture candidate"]);
  const candidate = runGit(git, ["rev-parse", "HEAD"]).trim();
  const tickets = ["T01", "T02"].map(id => ({ id, path: ticketPath(id), digest: ticketFileDigest(readFileSync(join(repository, ticketPath(id)))) }));
  const created = await newCommand({ stateRoot: join(root, "state"), repository, project: "sample", taskId: "unrelated-task",
    request: "build", workflow: "build-review", tier: 2, planRef: "sample", ticketSelection: sealTicketSelection({ plan: "sample", tickets: [tickets[0]!] }) });
  const dir = created.attemptDir;
  const status = await persistAttempt(dir, created.status.revision, { kind: "attempt.transitioned",
    next: nextRevision(created.status, { lifecycleState: "LANDED", baseSha: base, candidateSha: candidate }) });
  const out: string[] = [];
  let answers: boolean[] = [];
  const terminal = { interactive: true, write: (line: string) => { out.push(line); }, confirm: async (_prompt: string) => answers.shift() ?? true };
  const update = async (changes: Partial<AttemptStatus>) => {
    const current = await readAttempt(dir);
    // Test fixture replaces synthetic evidence, not a production transition.
    const next = { ...current, ...changes };
    const rows = readFileSync(join(dir, "journal.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    rows[rows.length - 1].event.next = next;
    writeFileSync(join(dir, "journal.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    writeFileSync(join(dir, "status.json"), JSON.stringify(next));
  };
  const options: CloseCommandOptions = { attemptDir: dir, terminal };
  const commit = (path: string, text: string) => {
    writeFileSync(join(repository, path), text);
    runGit(git, ["add", "."]); runGit(git, ["commit", "-m", "fixture owner change"]);
  };
  return { root, repository, git, dir, base, candidate, tickets, status, out, options, terminal, update, commit,
    answers: (values: boolean[]) => { answers = [...values]; } };
}

function bytesSnapshot(repository: string): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory)) {
      if (name === ".git") continue;
      const physical = join(directory, name), path = `${prefix}${name}`;
      if (lstatSync(physical).isDirectory()) visit(physical, `${path}/`);
      else out.set(path, readFileSync(physical).toString("hex"));
    }
  };
  visit(repository, "");
  out.set(".git/index", readFileSync(join(repository, ".git/index")).toString("hex"));
  out.set(".git/refs/heads/main", readFileSync(join(repository, ".git/refs/heads/main")).toString("hex"));
  return out;
}

for (const [name, change, message] of [
  ["wrong actor first", async (w: Awaited<ReturnType<typeof world>>) => { await w.update({ lifecycleState: "DRAFT" }); return { actor: "delegate" as const, terminal: { ...w.terminal, interactive: false } }; }, /human actor/],
  ["non-interactive first", async (w: Awaited<ReturnType<typeof world>>) => { await w.update({ lifecycleState: "DRAFT" }); return { terminal: { ...w.terminal, interactive: false } }; }, /interactive owner terminal/],
  ["lease", async () => ({ lease: "owner lease" }), /cannot run under a lease/],
  ["not LANDED", async (w: Awaited<ReturnType<typeof world>>) => { await w.update({ lifecycleState: "DRAFT" }); return {}; }, /LANDED attempt/],
  ["no selection", async (w: Awaited<ReturnType<typeof world>>) => { await w.update({ ticketSelection: null }); return {}; }, /sealed ticket selection/],
  ["candidate not in HEAD before dirty", async (w: Awaited<ReturnType<typeof world>>) => {
    const sibling = runGit(w.git, ["commit-tree", runGit(w.git, ["rev-parse", `${w.base}^{tree}`]).trim(), "-p", w.base, "-m", "fixture sibling"]).trim();
    await w.update({ candidateSha: sibling }); writeFileSync(join(w.repository, "untracked"), "dirty"); return {};
  }, /not an ancestor/],
  ["dirty checkout", async (w: Awaited<ReturnType<typeof world>>) => { writeFileSync(join(w.repository, "untracked"), "dirty"); return {}; }, /clean canonical checkout/],
  ["ask drift", async (w: Awaited<ReturnType<typeof world>>) => { w.commit(planPath, fixturePlan.replace("First row.", "Different ask.")); return {}; }, /ask changed since base: T01.checklist/],
  ["unset identity", async (w: Awaited<ReturnType<typeof world>>) => { runGit(w.git, ["config", "user.name", ""]); return {}; }, /configured user.name/],
  ["agreement drift", async (w: Awaited<ReturnType<typeof world>>) => { w.commit(ticketPath("T02"), fixtureTicket("T02").replace("Build T02.", "Changed prompt.")); return {}; }, /delta refused.*agreement/],
] as const) test(`closure refusal ${name} leaves every checkout and index byte unchanged`, async () => {
  const w = await world();
  const overrides = await change(w);
  const before = bytesSnapshot(w.repository);
  const journal = readFileSync(join(w.dir, "journal.jsonl"));
  await assert.rejects(closeCommand({ ...w.options, ...overrides }), message);
  assert.deepEqual(bytesSnapshot(w.repository), before);
  assert.deepEqual(readFileSync(join(w.dir, "journal.jsonl")), journal);
});

test("HEAD movement during final confirmation refuses without adding any byte", async () => {
  const w = await world();
  let atConfirmation: Map<string, string> | undefined;
  const terminal = { ...w.terminal, confirm: async (prompt: string) => {
    if (prompt.startsWith("Commit these")) { w.commit("source.txt", "external movement\n"); atConfirmation = bytesSnapshot(w.repository); }
    return true;
  } };
  await assert.rejects(closeCommand({ ...w.options, terminal }), /HEAD moved during closure confirmation/);
  assert.deepEqual(bytesSnapshot(w.repository), atConfirmation);
});

test("final decline leaves checkout and journal untouched", async () => {
  const w = await world(); w.answers([true, false]);
  const before = bytesSnapshot(w.repository), journal = readFileSync(join(w.dir, "journal.jsonl"));
  assert.deepEqual(await closeCommand(w.options), { confirmed: false, record: null });
  assert.deepEqual(bytesSnapshot(w.repository), before);
  assert.deepEqual(readFileSync(join(w.dir, "journal.jsonl")), journal);
});

for (const [name, answers, state, closedCount, milestone] of [
  ["all rows", [true, true], "done", 2, "wip"],
  ["one row", [false, true, false, true], "wip", 1, "wip"],
  ["every row left open", [false, false, false, true], "wip", 0, "wip"],
] as const) test(`closure derives ${name}, records choices and proves the actual commit delta`, async () => {
  const w = await world(); w.answers([...answers]);
  const result = await closeCommand(w.options);
  assert.ok(result.record); const record = result.record;
  assert.equal(Value.Check(ClosureRecordSchema, record), true);
  assert.equal(record.rowsClosed.length, closedCount);
  assert.equal(record.rowsLeftOpen.length, 2 - closedCount);
  assert.match(readFileSync(join(w.repository, ticketPath("T01")), "utf8"), new RegExp(`state: ${state}`));
  assert.match(readFileSync(join(w.repository, planPath), "utf8"), new RegExp(`\\[${milestone}\\]</code> Milestone`));
  assert.match(readFileSync(join(w.repository, planPath), "utf8"), /\[\]<\/code> Outside the parser, unchanged/);
  assert.deepEqual(readFileSync(join(w.repository, "binary.dat")), Buffer.from([255, 0, 128]));
  assert.equal(runGit(w.git, ["status", "--porcelain"]), "");
  assert.equal(runGit(w.git, ["show", "--format=%B", "--no-patch", record.commitSha]).trim(), `chore(specs): close sample T01 after ${w.candidate.slice(0, 7)}`);
  assert.equal(runGit(w.git, ["show", "--format=%an <%ae>|%cn <%ce>", "--no-patch", record.commitSha]).trim(), "Fixture Owner <owner@example.invalid>|Fixture Owner <owner@example.invalid>");
  const before = readClosureSnapshot(w.git, record.parentSha), after = readClosureSnapshot(w.git, record.commitSha);
  assert.equal(closureDelta(before.tree, after.tree, after.registry, { before: before.modes, after: after.modes }).ok, true);
  verifyClosureCommit(w.git, record);
  assert.equal((await readAttempt(w.dir)).lifecycleState, "LANDED");
  const evidence = await readAttemptEvidence(w.dir);
  assert.deepEqual(evidence.map(item => item.type), ["closure-intent", "closure-prepared", "closure-record"]);
  assert.ok(w.out.some(line => line.includes('"todo" ->')));
  const head = runGit(w.git, ["rev-parse", "HEAD"]);
  assert.deepEqual((await closeCommand(w.options)).record, record);
  assert.equal(runGit(w.git, ["rev-parse", "HEAD"]), head, "never closes twice");
});

test("multiple selected tasks derive a complete milestone in one commit", async () => {
  const w = await world();
  await w.update({ ticketSelection: sealTicketSelection({ plan: "sample", tickets: w.tickets }) });
  const result = await closeCommand(w.options);
  assert.equal(result.record!.rowsClosed.length, 3);
  assert.match(readFileSync(join(w.repository, planPath), "utf8"), /\[x\]<\/code> Milestone/);
  for (const id of ["T01", "T02"]) assert.match(readFileSync(join(w.repository, ticketPath(id)), "utf8"), /state: done/);
});

test("a pure proposal excludes unbuilt shift tickets and resolves current rows through registration", async () => {
  const w = await world(); const before = readClosureSnapshot(w.git, w.candidate);
  const proposal = proposeClosure(before.tree, before.registry, "sample", ["T01", "T02"], new Set(["T01"]));
  assert.deepEqual(proposal.notClosable, ["T02"]);
  assert.equal(proposal.rows.length, 2);
  const after = applyClosureChoices(before.tree, before.registry, proposal, new Set(proposal.rows));
  assert.deepEqual(after.get(ticketPath("T02")), before.tree.get(ticketPath("T02")));
});

test("a shift offers only host accepted builds that are ancestors of its landed candidate", async () => {
  const w = await world();
  const shift = sealShiftManifest({ plan: "sample", milestones: ["M1"], tickets: w.tickets });
  const recipe = compileShift(shift, new Map(w.tickets.map(ticket => [ticket.id, readFileSync(join(w.repository, ticket.path))])), { prompts: { builder: "", reviewer: "" } });
  const phases = recipe.phases.slice(0, 2);
  const prefix = phases.map((phase, index) => ({ phaseKey: phase.id, ordinal: index + 1, envelopeId: `envelope-${index}`,
    envelopeDigest: recoveryDigest(index), round: 0, candidateSha: index === 1 ? w.candidate : w.base }));
  await w.update({ workflow: "shift", shift, ticketSelection: null, recovery: { schema: "awsf.phase-recovery/v1", id: "checkpoint", sessionId: w.status.sessionId,
    kind: "completed-phase", workflowId: "shift", bindingDigest: recoveryDigest(shift), prefix, repository: w.repository, worktree: w.repository,
    commonGitDir: join(w.repository, ".git"), integrationBaseSha: w.base, worktreeHeadSha: w.candidate, budgetDigest: recoveryDigest(w.status.budget), quota: null, createdAt: "2026-10-09" } });
  const result = await closeCommand(w.options);
  assert.deepEqual(result.record!.tickets, ["T01"]);
  assert.deepEqual(result.record!.notClosable, ["T02"]);
  assert.ok(w.out.some(line => line.startsWith("T02: not closable")));
});

for (const step of ["intent", "commit", "prepared", "published", "checkout", "recorded"] as const) test(`interruption after ${step} is finished or reported without a second commit`, async () => {
  const w = await world();
  await assert.rejects(closeCommand({ ...w.options, onStep: point => { if (point === step) throw new Error("fixture interruption"); } }), /fixture interruption/);
  const before = bytesSnapshot(w.repository);
  if (["intent", "commit", "prepared"].includes(step)) {
    await assert.rejects(closeCommand(w.options), /interrupted closure.*no automatic replay/);
    assert.deepEqual(bytesSnapshot(w.repository), before);
    assert.equal(runGit(w.git, ["rev-parse", "HEAD"]).trim(), w.candidate);
  } else {
    const head = runGit(w.git, ["rev-parse", "HEAD"]);
    const result = await closeCommand(w.options);
    assert.ok(result.record);
    assert.equal(runGit(w.git, ["rev-parse", "HEAD"]), head);
    assert.equal(runGit(w.git, ["status", "--porcelain"]), "");
    assert.equal((await readAttemptEvidence(w.dir)).filter(item => item.type === "closure-record").length, 1);
  }
});

test("interrupted publication with unknown dirty bytes reports rather than overwriting", async () => {
  const w = await world();
  await assert.rejects(closeCommand({ ...w.options, onStep: point => { if (point === "published") throw new Error("interruption"); } }));
  writeFileSync(join(w.repository, planPath), "owner's new bytes\n");
  const before = bytesSnapshot(w.repository);
  await assert.rejects(closeCommand(w.options), /checkout bytes changed/);
  assert.deepEqual(bytesSnapshot(w.repository), before);
});

test("closure records project as idempotent event rows and replay after a projection interruption", async () => {
  const w = await world();
  const db = openDatabase(":memory:");
  try {
    const project: NonNullable<CloseCommandOptions["projectRecord"]> = (record, status) => {
      const result = projectAttemptStatus(db, toAttemptStatusProjection(join(w.root, "state"), status, record.event), record.source_seq);
      assert.equal(result.ok, true, result.notice?.detail ?? "projection failed");
    };
    for (const record of await closureJournalRecords(w.dir)) await project(record, record.event.next);
    let interrupted = false;
    await assert.rejects(closeCommand({ ...w.options, projectRecord: (record, status) => {
      if (record.event.evidence?.type === "closure-record" && !interrupted) { interrupted = true; throw new Error("projection interruption"); }
      return project(record, status);
    } }), /projection interruption/);
    // Also model an interrupted status replacement: the journal remains authoritative.
    writeFileSync(join(w.dir, "status.json"), JSON.stringify(w.status));
    const result = await closeCommand({ ...w.options, projectRecord: project });
    assert.ok(result.record);
    const events = db.prepare("SELECT name, payload_json FROM events ORDER BY first_source_seq").all() as { name: string; payload_json: string }[];
    assert.deepEqual(events.map(event => event.name), ["closure-intent", "closure-prepared", "closure-record"]);
    assert.deepEqual(JSON.parse(events[2]!.payload_json), result.record);
    assert.equal((await readAttempt(w.dir)).revision, (await closureJournalRecords(w.dir)).length);
    await closeCommand({ ...w.options, projectRecord: project });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events").get()!.count, 3);
  } finally { db.close(); }
});

test("a closure with no changed bytes still journals one empty-diff commit", async () => {
  const w = await world();
  w.commit(planPath, fixturePlan.replace('[]</code> Milestone', '[wip]</code> Milestone'));
  w.commit(ticketPath("T01"), fixtureTicket("T01").replace("state: todo", "state: wip"));
  w.answers([false, false, false, true]);
  const result = await closeCommand(w.options);
  assert.deepEqual(result.record!.blobs, []);
  assert.equal(result.record!.rowsLeftOpen.length, 2);
  assert.equal(runGit(w.git, ["diff", "--name-only", result.record!.parentSha, result.record!.commitSha]), "");
});

const OWNER_CONFIG = resolve("awsf.config.yaml");

async function viaMain(w: Awaited<ReturnType<typeof world>>, argv: readonly string[], terminal: CloseCommandOptions["terminal"] = w.terminal) {
  const out: string[] = [], err: string[] = [];
  const code = await main({ argv: [...argv, "--project", "sample", "--state-root", join(w.root, "state"), "--config", OWNER_CONFIG],
    cwd: w.repository, terminal, writeOut: line => out.push(line), writeError: line => err.push(line) });
  return { code, out, err };
}

test("close is an owner act: an arm in main that constructs the owner terminal, and in OWNER_ACT_COMMANDS (G03-C)", () => {
  assert.equal((OWNER_ACT_COMMANDS as readonly string[]).includes("close"), true);
  const source = readFileSync(new URL("../../../src/cli/main.ts", import.meta.url), "utf8");
  const start = source.indexOf('case "close": {');
  assert.notEqual(start, -1);
  const arm = source.slice(start, source.indexOf("\n    }\n", start));
  assert.ok(arm.includes("processOwnerTerminal()") && arm.includes("closeCommand("));
  assert.equal(arm.includes("lease"), false);
});

for (const [name, argv, piped] of [
  ["a piped terminal", ["close", "unrelated-task"], true],
  ["a path flag", ["close", "unrelated-task", "--where", "plans/**"], false],
  ["--ticket on the task form", ["close", "unrelated-task", "--ticket", "T01"], false],
  ["--commit without --plan", ["close", "--commit", "HEAD"], false],
  ["--commit with a task", ["close", "unrelated-task", "--commit", "HEAD", "--plan", "sample"], false],
] as const) test(`close through main refuses ${name} and writes nothing`, async () => {
  const w = await world();
  const before = bytesSnapshot(w.repository), journal = readFileSync(join(w.dir, "journal.jsonl"));
  const result = await viaMain(w, argv, piped ? { ...w.terminal, interactive: false } : w.terminal);
  assert.notEqual(result.code, 0);
  assert.deepEqual(bytesSnapshot(w.repository), before);
  assert.deepEqual(readFileSync(join(w.dir, "journal.jsonl")), journal);
  assert.equal(existsSync(join(w.root, "state/projects/sample/closure")), false);
});

test("close through main records a landed attempt's rows in one commit and pushes nothing", async () => {
  const w = await world();
  const head = runGit(w.git, ["rev-parse", "HEAD"]).trim();
  const result = await viaMain(w, ["close", "unrelated-task"]);
  assert.equal(result.code, 0, result.err.join("\n"));
  assert.ok(result.out.some(line => line.startsWith("Closed sample T01 in ")), result.out.join("\n"));
  const after = runGit(w.git, ["rev-parse", "HEAD"]).trim();
  assert.equal(runGit(w.git, ["rev-parse", `${after}^`]).trim(), head);
  assert.equal(runGit(w.git, ["log", "-1", "--format=%s", after]).trim(), `chore(specs): close sample T01 after ${w.candidate.slice(0, 7)}`);
  assert.equal((await readAttemptEvidence(w.dir)).filter(item => item.type === "closure-record").length, 1);
});

test("close --commit through main closes owner rows at the project and leaves the attempt untouched", async () => {
  const w = await world();
  const journal = readFileSync(join(w.dir, "journal.jsonl"));
  const result = await viaMain(w, ["close", "--commit", w.candidate, "--plan", "sample", "--ticket", "T02"]);
  assert.equal(result.code, 0, result.err.join("\n"));
  assert.ok(result.out.some(line => line.startsWith("Closed sample T02 in ")), result.out.join("\n"));
  assert.deepEqual(readFileSync(join(w.dir, "journal.jsonl")), journal);
  const records = await projectClosureJournalRecords(join(w.root, "state/projects/sample"));
  assert.deepEqual(records.map(row => row.event.evidence.type), ["closure-intent", "closure-prepared", "closure-record"]);
});

test("the closure record is closed host data, not a provider envelope", () => {
  assert.equal(RECORD_SCHEMAS[CLOSURE_RECORD_SCHEMA_ID], ClosureRecordSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, CLOSURE_RECORD_SCHEMA_ID), false);
  assert.equal(Value.Check(ClosureRecordSchema, {}), false);
});
