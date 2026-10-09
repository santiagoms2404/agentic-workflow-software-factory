import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCommand, type CloseCommandOptions } from "../../../src/cli/commands/close.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { sealTicketSelection } from "../../../src/contracts/ticket-selection-record.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { compileShift } from "../../../src/workflow/shift/compile.ts";
import { recoveryDigest } from "../../../src/contracts/phase-recovery.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { readClosureSnapshot, closureGitRunner, verifyClosureCommit } from "../../../src/git/closure.ts";
import { runGit } from "../../../src/git/changes.ts";
import { proposeSpineRollUp } from "../../../src/closure/spine.ts";
import { projectClosureJournalRecords, projectClosureJournalPath } from "../../../src/persistence/project-closure-journal.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { treeAgreement } from "../../../src/closure/tree.ts";

const marker = (value: string) => `<code class="status">[${value}]</code>`;
const deep = (first = "x") => `<section><h3>${marker(first)} Milestone M1: First</h3>
<h4>1. First task</h4><ul><li>${marker(first)} First requirement.</li></ul></section>
<section><h3>${marker("")} Milestone M2: Last</h3>
<h4>2. Last task</h4><ul><li>${marker("")} Last requirement.</li></ul></section>\n`;
const spineSection = (n = 1, href = "./deep.html") => `<section class="phase"><h3>${marker("")} Milestone M${n}: Workstream</h3>
<p><a href="${href}">Unrelated link text</a></p>
<h4>${n}. Workstream ${n}</h4><ul><li>${marker("")} Authored and approved.</li>
<li>${marker("")} Implementation accepted.</li></ul></section>\n`;
const ticket = (id: string, title: string, milestone: string, state = "todo") => `---
id: ${id}
title: ${title}
milestone: ${milestone}
state: ${state}
depends_on: []
---
# Ticket

## Handoff

## Build prompt

\`\`\`
Build ${id}.
\`\`\`
`;
const prompts = (entries: readonly [string, string][]) => `# Section B — Task prompts (recommended)\n` + entries.map(([id, title]) =>
  `### T${id.slice(1)} — ${title}\n\n\`\`\`\nBuild ${id}.\n\`\`\`\n`).join("\n");

async function world(options: { spine?: string; first?: string; approval?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "awsf-spine-unit-")), repository = join(root, "repository");
  const projectDir = join(root, "state/projects/sample");
  for (const plan of ["deep", "spine"]) mkdirSync(join(repository, `plans/tickets/${plan}`), { recursive: true });
  const git = closureGitRunner(repository);
  runGit(git, ["init", "-b", "main"]);
  runGit(git, ["config", "user.name", "Fixture Owner"]);
  runGit(git, ["config", "user.email", "owner@example.invalid"]);
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: sample}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, "plans/deep.html"), deep(options.first));
  writeFileSync(join(repository, "plans/deep-build-prompts.md"), prompts([["T01", "First task"], ["T02", "Last task"]]));
  writeFileSync(join(repository, "plans/tickets/deep/T01.md"), ticket("T01", "First task", "M1", options.first === "" ? "todo" : "done"));
  writeFileSync(join(repository, "plans/tickets/deep/T02.md"), ticket("T02", "Last task", "M2"));
  writeFileSync(join(repository, "plans/spine.html"), options.spine ?? spineSection());
  writeFileSync(join(repository, "plans/spine-build-prompts.md"), prompts([["W01", "Workstream 1"], ["W02", "Workstream 2"]]));
  writeFileSync(join(repository, "plans/tickets/spine/W01.md"), ticket("W01", "Workstream 1", "M1"));
  if (options.spine?.includes("Milestone M2")) writeFileSync(join(repository, "plans/tickets/spine/W02.md"), ticket("W02", "Workstream 2", "M2"));
  runGit(git, ["add", "."]); runGit(git, ["commit", "-m", "fixture base"]);
  const base = runGit(git, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(repository, "built.txt"), "implementation\n");
  runGit(git, ["add", "."]); runGit(git, ["commit", "-m", "fixture candidate"]);
  const candidate = runGit(git, ["rev-parse", "HEAD"]).trim();
  const plan = options.approval ? "spine" : "deep", id = options.approval ? "W01" : "T02";
  const path = `plans/tickets/${plan}/${id}.md`;
  const created = await newCommand({ stateRoot: join(root, "state"), repository, project: "sample", taskId: "fixture-build",
    workflow: "build-review", tier: 2, request: "fixture", planRef: plan,
    ticketSelection: sealTicketSelection({ plan, tickets: [{ id, path, digest: ticketFileDigest(readFileSync(join(repository, path))) }] }) });
  await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.transitioned",
    next: nextRevision(created.status, { lifecycleState: "LANDED", baseSha: base, candidateSha: candidate }) });
  const out: string[] = [], questions: string[] = [];
  const terminal = { interactive: true, write: (line: string) => { out.push(line); }, confirm: async (prompt: string) => { questions.push(prompt); return true; } };
  const closeOptions: CloseCommandOptions = { attemptDir: created.attemptDir, terminal };
  const ownerOptions: CloseCommandOptions = { commit: candidate, repository, projectDir, project: "sample", plan: "deep", terminal };
  const commit = (path: string, text: string) => {
    writeFileSync(join(repository, path), text); runGit(git, ["add", "."]); runGit(git, ["commit", "-m", "fixture owner change"]);
  };
  return { root, repository, projectDir, git, base, candidate, dir: created.attemptDir, out, questions, closeOptions, ownerOptions, terminal, commit };
}
function snapshot(root: string): Map<string, string> {
  const bytes = new Map<string, string>();
  const visit = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (lstatSync(path).isDirectory()) visit(path, `${prefix}${name}/`);
      else bytes.set(`${prefix}${name}`, readFileSync(path).toString("hex"));
    }
  };
  visit(root, ""); return bytes;
}
function assertAgreement(w: Awaited<ReturnType<typeof world>>, sha: string) {
  const after = readClosureSnapshot(w.git, sha);
  assert.deepEqual(treeAgreement(after.tree, after.registry), []);
}

test("deep completion offers link-mapped spine rows and includes both sets in one checked commit", async () => {
  const w = await world();
  const result = await closeCommand(w.closeOptions); assert.ok(result.record);
  assert.equal(result.record.parentSha, w.candidate);
  assert.deepEqual(result.record.blobs.map(blob => blob.path), ["plans/deep.html", "plans/spine.html", "plans/tickets/deep/T02.md", "plans/tickets/spine/W01.md"]);
  assert.deepEqual(result.record.rowsClosed.map(row => row.ticket), ["T02", "W01", "W01"]);
  assert.match(readFileSync(join(w.repository, "plans/tickets/spine/W01.md"), "utf8"), /state: done/);
  assert.ok(w.questions.some(question => question.includes("spine rows")));
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
  assert.equal((await readAttemptEvidence(w.dir)).filter(row => row.type === "closure-record").length, 1);
});

for (const choice of ["one", "none"] as const) test(`spine roll-up moves only owner-chosen rows: ${choice}`, async () => {
  const w = await world();
  const terminal = { ...w.terminal, confirm: async (prompt: string) => {
    if (prompt.startsWith("Mark all offered spine")) return false;
    if (prompt.includes("plans/spine.html")) return choice === "one" && prompt.includes("row 0");
    return true;
  } };
  const result = await closeCommand({ ...w.closeOptions, terminal }); assert.ok(result.record);
  const text = readFileSync(join(w.repository, "plans/spine.html"), "utf8");
  assert.ok(text.includes(`${marker("")} Implementation accepted.`));
  assert.ok(text.includes(`${marker(choice === "one" ? "x" : "")} Authored and approved.`));
  assert.match(readFileSync(join(w.repository, "plans/tickets/spine/W01.md"), "utf8"), /state: wip/);
  assert.equal(result.record.rowsLeftOpen.length, choice === "one" ? 1 : 2);
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
});

test("an incomplete deep plan offers no spine rows", async () => {
  const w = await world({ first: "" });
  const result = await closeCommand(w.closeOptions); assert.ok(result.record);
  assert.deepEqual(result.record.blobs.map(blob => blob.path), ["plans/deep.html", "plans/tickets/deep/T02.md"]);
  assert.equal(w.questions.some(question => question.includes("spine rows")), false);
  assertAgreement(w, result.record.commitSha);
});

test("a selected W ticket approves only its owner-chosen row, not its implementation", async () => {
  const w = await world({ approval: true });
  const terminal = { ...w.terminal, confirm: async (prompt: string) => prompt.startsWith("Commit") || prompt.includes("row 0") };
  const result = await closeCommand({ ...w.closeOptions, terminal }); assert.ok(result.record);
  assert.equal(result.record.plan, "spine"); assert.deepEqual(result.record.tickets, ["W01"]);
  assert.equal(result.record.rowsClosed.length, 1); assert.equal(result.record.rowsLeftOpen.length, 1);
  assert.match(readFileSync(join(w.repository, "plans/tickets/spine/W01.md"), "utf8"), /state: wip/);
  assert.ok(readFileSync(join(w.repository, "plans/spine.html"), "utf8").includes(`${marker("")} Implementation accepted.`));
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
});

for (const [name, spine, message] of [
  ["no link despite matching prose", spineSection(1, "elsewhere.html").replace("Unrelated link text", "deep.html"), /no section linking/],
  ["two sections", spineSection() + spineSection(2), /more than one section/],
  ["two tasks in one section", spineSection().replace("</section>", `<h4>2. Extra</h4>${marker("")}</section>`), /exactly one workstream/],
] as const) test(`roll-up refuses ${name} before any byte is written`, async () => {
  const w = await world({ spine }); const before = snapshot(w.root);
  await assert.rejects(closeCommand(w.closeOptions), message);
  assert.deepEqual(snapshot(w.root), before);
});

test("a changed spine ask since the attempt base refuses without writing", async () => {
  const w = await world();
  w.commit("plans/spine.html", spineSection().replace("Implementation accepted.", "Different requirement."));
  const before = snapshot(w.root);
  await assert.rejects(closeCommand(w.closeOptions), /ask changed since base: W01.checklist/);
  assert.deepEqual(snapshot(w.root), before);
});

test("the section mapping accepts a relative link with a fragment and ignores outside-section links", async () => {
  const w = await world({ spine: spineSection(1, "./deep.html#phases") + '<p><a href="deep.html">outside</a></p>' });
  const before = readClosureSnapshot(w.git, w.candidate), tree = new Map(before.tree);
  tree.set("plans/deep.html", Buffer.from(deep().replaceAll('status">[]', 'status">[x]')));
  const proposal = proposeSpineRollUp(tree, before.registry, "deep");
  assert.deepEqual(proposal?.tickets, ["W01"]); assert.equal(proposal?.rows.length, 2);
});

test("owner commit evidence closes rows across any tasks in a project journal, not an attempt", async () => {
  const w = await world({ first: "" });
  const attempt = snapshot(w.dir);
  const projected: number[] = [];
  const result = await closeCommand({ ...w.ownerOptions, projectClosureRecord: row => { projected.push(row.source_seq); } });
  assert.ok(result.record); assert.deepEqual(result.record.tickets, ["T01", "T02"]);
  assert.equal(result.record.candidateSha, w.candidate);
  assert.deepEqual(snapshot(w.dir), attempt);
  const records = await projectClosureJournalRecords(w.projectDir);
  assert.deepEqual(records.map(row => row.event.evidence.type), ["closure-intent", "closure-prepared", "closure-record"]);
  assert.ok(records.every(row => row.event.project === "sample" && row.event.repository === w.repository));
  assert.deepEqual(projected, [1, 2, 3]);
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
  const head = runGit(w.git, ["rev-parse", "HEAD"]);
  assert.deepEqual((await closeCommand(w.ownerOptions)).record, result.record);
  assert.equal(runGit(w.git, ["rev-parse", "HEAD"]), head);
});

test("owner rows not chosen leave unrelated task state and milestone untouched", async () => {
  const w = await world({ first: "" });
  const firstBytes = readFileSync(join(w.repository, "plans/tickets/deep/T01.md"));
  const terminal = { ...w.terminal, confirm: async (prompt: string) => prompt.startsWith("Commit") || prompt.includes("T02 row") };
  const result = await closeCommand({ ...w.ownerOptions, terminal }); assert.ok(result.record);
  assert.deepEqual(result.record.tickets, ["T02"]);
  assert.deepEqual(readFileSync(join(w.repository, "plans/tickets/deep/T01.md")), firstBytes);
  assert.ok(readFileSync(join(w.repository, "plans/deep.html"), "utf8").includes(`${marker("")} Milestone M1`));
  assert.equal(result.record.rowsLeftOpen.length, 1);
  assertAgreement(w, result.record.commitSha);
});

for (const [name, change, message] of [
  ["unreachable evidence", (w: Awaited<ReturnType<typeof world>>) => ({ commit: runGit(w.git, ["commit-tree", runGit(w.git, ["rev-parse", `${w.base}^{tree}`]).trim(), "-p", w.base, "-m", "fixture sibling"]).trim() }), /evidence commit is not reachable/],
  ["invalid evidence", () => ({ commit: "not-a-revision" }), /evidence commit is not reachable/],
  ["mixed evidence", (w: Awaited<ReturnType<typeof world>>) => ({ attemptDir: w.dir }), /closure requires an attempt/],
  ["dirty checkout", (w: Awaited<ReturnType<typeof world>>) => { writeFileSync(join(w.repository, "untracked"), "dirty"); return {}; }, /clean canonical checkout/],
  ["ask drift", (w: Awaited<ReturnType<typeof world>>) => { w.commit("plans/deep.html", deep().replace("Last requirement.", "New requirement.")); return {}; }, /ask changed since base/],
  ["wrong project", () => ({ project: "another" }), /project differs/],
  ["non-human actor", () => ({ actor: "delegate" as const }), /human actor/],
  ["non-interactive terminal", (w: Awaited<ReturnType<typeof world>>) => ({ terminal: { ...w.terminal, interactive: false } }), /interactive owner terminal/],
  ["lease", () => ({ lease: "fixture lease" }), /cannot run under a lease/],
  ["unset identity", (w: Awaited<ReturnType<typeof world>>) => { runGit(w.git, ["config", "user.name", ""]); return {}; }, /configured user.name/],
  ["agreement drift", (w: Awaited<ReturnType<typeof world>>) => { w.commit("plans/spine-build-prompts.md", prompts([["W01", "Different title"]])); return {}; }, /delta refused.*agreement/],
  ["unknown ticket", () => ({ tickets: ["T99"] }), /cannot resolve ask/],
  ["duplicate tickets", () => ({ tickets: ["T02", "T02"] }), /distinct registered tickets/],
] as const) test(`owner-commit refusal ${name} leaves checkout and both journals unchanged`, async () => {
  const w = await world(), overrides = change(w), before = snapshot(w.root);
  await assert.rejects(closeCommand({ ...w.ownerOptions, ...overrides }), message);
  assert.deepEqual(snapshot(w.root), before);
});

for (const step of ["intent", "prepared", "published", "recorded"] as const) test(`project closure interruption after ${step} never repeats its commit`, async () => {
  const w = await world();
  await assert.rejects(closeCommand({ ...w.ownerOptions, tickets: ["T02"], onStep: point => { if (point === step) throw new Error("fixture interruption"); } }), /fixture interruption/);
  const head = runGit(w.git, ["rev-parse", "HEAD"]);
  if (step === "intent" || step === "prepared") {
    const before = snapshot(w.root);
    await assert.rejects(closeCommand({ ...w.ownerOptions, tickets: ["T02"] }), /no automatic replay/);
    assert.deepEqual(snapshot(w.root), before);
  } else {
    assert.ok((await closeCommand({ ...w.ownerOptions, tickets: ["T02"] })).record);
    assert.equal((await projectClosureJournalRecords(w.projectDir)).filter(row => row.event.evidence.type === "closure-record").length, 1);
  }
  assert.equal(runGit(w.git, ["rev-parse", "HEAD"]), head);
});

test("completing a spine never tries to roll it up to another registered spine", async () => {
  const w = await world({ approval: true });
  mkdirSync(join(w.repository, "plans/tickets/other-spine"), { recursive: true });
  writeFileSync(join(w.repository, "plans/other-spine.html"), spineSection(1, "elsewhere.html"));
  writeFileSync(join(w.repository, "plans/other-spine-build-prompts.md"), prompts([["W01", "Workstream 1"]]));
  w.commit("plans/tickets/other-spine/W01.md", ticket("W01", "Workstream 1", "M1"));
  const result = await closeCommand(w.closeOptions); assert.ok(result.record);
  assert.deepEqual(result.record.tickets, ["W01"]);
  assert.match(readFileSync(join(w.repository, "plans/tickets/spine/W01.md"), "utf8"), /state: done/);
  assert.equal(result.record.blobs.some(blob => blob.path.includes("other-spine")), false);
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
});

test("an interrupted project closure cannot be bypassed by changing its ticket selection", async () => {
  const w = await world({ first: "" });
  await assert.rejects(closeCommand({ ...w.ownerOptions, tickets: ["T01"], onStep: point => { if (point === "intent") throw new Error("fixture interruption"); } }), /fixture interruption/);
  const before = snapshot(w.root);
  await assert.rejects(closeCommand({ ...w.ownerOptions, tickets: ["T02"] }), /rerun the original commit, plan and ticket selection/);
  assert.deepEqual(snapshot(w.root), before);
});

test("two scoped owner closures can cite the same reachable evidence without rewriting prior journal bytes", async () => {
  const w = await world({ first: "" });
  const first = await closeCommand({ ...w.ownerOptions, tickets: ["T01"] }); assert.ok(first.record);
  const prefix = readFileSync(projectClosureJournalPath(w.projectDir));
  const second = await closeCommand({ ...w.ownerOptions, tickets: ["T02"] }); assert.ok(second.record);
  assert.equal(second.record.parentSha, first.record.commitSha);
  assert.deepEqual(readFileSync(projectClosureJournalPath(w.projectDir)).subarray(0, prefix.length), prefix);
  assert.equal((await projectClosureJournalRecords(w.projectDir)).length, 6);
  assertAgreement(w, second.record.commitSha);
});

test("a shift rolls both completed deep milestones into its spine in the same closure", async () => {
  const w = await world({ first: "" });
  const current = await readAttempt(w.dir);
  const tickets = ["T01", "T02"].map(id => {
    const path = `plans/tickets/deep/${id}.md`;
    return { id, path, digest: ticketFileDigest(readFileSync(join(w.repository, path))) };
  });
  const shift = sealShiftManifest({ plan: "deep", milestones: ["M1", "M2"], tickets });
  const recipe = compileShift(shift, new Map(tickets.map(ticket => [ticket.id, readFileSync(join(w.repository, ticket.path))])), { prompts: { builder: "", reviewer: "" } });
  const prefix = recipe.phases.filter(phase => phase.kind === "agent").map((phase, index) => ({ phaseKey: phase.id, ordinal: index + 1,
    envelopeId: `fixture-envelope-${index}`, envelopeDigest: recoveryDigest(index), round: 0, candidateSha: w.candidate }));
  // Replace only synthetic attempt evidence; production closure changes no selection.
  const rows = readFileSync(join(w.dir, "journal.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const status = { ...current, workflow: "shift", ticketSelection: null, shift, recovery: {
    schema: "awsf.phase-recovery/v1", id: "fixture-checkpoint", sessionId: current.sessionId, kind: "completed-phase", workflowId: "shift",
    bindingDigest: recoveryDigest(shift), prefix, repository: w.repository, worktree: w.repository, commonGitDir: join(w.repository, ".git"),
    integrationBaseSha: w.base, worktreeHeadSha: w.candidate, budgetDigest: recoveryDigest(current.budget), quota: null, createdAt: "2026-10-09" } };
  rows[rows.length - 1].event.next = status;
  writeFileSync(join(w.dir, "journal.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(join(w.dir, "status.json"), JSON.stringify(status));
  const result = await closeCommand(w.closeOptions); assert.ok(result.record);
  assert.deepEqual(result.record.tickets, ["T01", "T02"]);
  assert.deepEqual(result.record.rowsClosed.map(row => row.ticket), ["T01", "T02", "W01", "W01"]);
  assertAgreement(w, result.record.commitSha); verifyClosureCommit(w.git, result.record);
});

test("project closure final decline writes no byte and leaves no project journal", async () => {
  const w = await world(), before = snapshot(w.root);
  const result = await closeCommand({ ...w.ownerOptions, terminal: { ...w.terminal, confirm: async prompt => !prompt.startsWith("Commit") } });
  assert.deepEqual(result, { confirmed: false, record: null });
  assert.deepEqual(snapshot(w.root), before);
});

test("project journal refuses a torn tail without repairing or writing any bytes", async () => {
  const w = await world();
  const path = projectClosureJournalPath(w.projectDir); mkdirSync(join(w.projectDir, "closure"), { recursive: true });
  writeFileSync(path, '{"source_seq":1'); const before = snapshot(w.root);
  await assert.rejects(closeCommand(w.ownerOptions), /torn project journal/);
  assert.deepEqual(snapshot(w.root), before);
});
