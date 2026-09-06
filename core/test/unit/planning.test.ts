import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capture, propose, apply, replay, hash, proposalHash, reference, groupDirectory, type Location } from "../../src/planning/store.ts";
import { currentUnit, affectedSuccessors, type Change, type Group, type Narrative, type Proposal, type Unit } from "../../src/planning/model.ts";
import { checklist } from "../../src/planning/evidence.ts";
import { bounded, packet, previewGroup } from "../../src/planning/views.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../src/cli/commands/attempt.ts";
import { transition } from "../../src/state/task-machine.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";

const at = "2026-01-01T00:00:00.000Z";
const narrative: Narrative = { title: "Refine scope", explanation: "Keep the request and the reasons for changing it.", changes: "Record the selected scope.", reason: "Owner request", friction: "", tasks: [], references: [] };
const owner: OwnerTerminal = { interactive: true, write() {}, async confirm() { return true; } };
const assistant: OwnerTerminal = { interactive: false, write() {}, async confirm() { throw new Error("must not ask an assistant"); } };
function unit(id = "one", revision = 1): Unit {
  return { id, revision, title: `Unit ${id}`, purpose: "A verifiable change", taskId: id, scope: ["Selected behavior"], nonGoals: ["Unrelated work"], serves: ["R1"], acceptance: ["The selected behavior is verified"], prerequisites: [], decisions: [], references: [], completion: "landed", disposition: "active", reason: "", revisit: "", parents: [] };
}
async function fixture(t: TestContext): Promise<Location> {
  const stateRoot = await mkdtemp(join(tmpdir(), "awsf-group-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  await mkdir(join(stateRoot, "projects", "sample", "tasks"), { recursive: true });
  return { stateRoot, project: "sample", group: "session" };
}
async function initial(location: Location, text = "Owner: español  and English.\r\nKeep this exactly.\n"): Promise<Group> {
  return capture({ ...location, id: "capture", expected: 0 }, { id: "original", text, sha256: hash(text), provenance: "owner message text, no rewrapping", attachments: [] }, narrative);
}
async function amendment(location: Location, changes: Change[], id = "scope"): Promise<Group> {
  const { group } = await replay(location);
  const proposal: Proposal = { id, base: group.revision, narrative, changes, alternatives: ["Retain the prior definition"] };
  const proposed = await propose({ ...location, id: `propose-${id}`, expected: group.revision }, proposal);
  return apply({ ...location, id: `apply-${id}`, expected: proposed.revision }, id, proposalHash(proposal), "Accept this selected planning change", owner);
}
async function defined(location: Location, units = [unit()]): Promise<Group> {
  await initial(location);
  return amendment(location, [{ kind: "requirements", values: [{ id: "R1", text: "Preserve intended behavior" }] }, { kind: "constraints", values: ["No execution permission from planning"] }, ...units.map((value) => ({ kind: "define" as const, unit: value }))]);
}
async function attempt(location: Location, taskId = "one") {
  return newCommand({ stateRoot: location.stateRoot, project: location.project, taskId, repository: process.cwd(), request: "Build the selected behavior", workflow: "build", tier: 1, now: () => at, sessionId: () => `session-${taskId}` });
}
async function bind(location: Location, group: Group, sessionId = "session-one") {
  return amendment(location, [{ kind: "bind", binding: { unit: "one", revision: currentUnit(group, "one").revision, taskId: "one", attempt: 1, sessionId } }], `binding-${group.revision}`);
}

test("exact mixed-language UTF-8 input round-trips once, including BOM, CRLF and whitespace", async (t) => {
  const location = await fixture(t);
  const text = "\ufeffEnglish: sí, à, ‘quotes’.  \r\nEspañol sin traducción.\n";
  const group = await initial(location, text);
  assert.equal(group.inputs[0]?.text, text);
  const { group: restored } = await replay(location);
  assert.equal(restored.inputs[0]?.sha256, hash(Buffer.from(text)));
  const output: string[] = [];
  assert.equal(await main({ argv: ["group", "input", "--state-root", location.stateRoot, "--project", location.project, "--group", location.group, "--input-id", "original"], writeOut: (value) => output.push(value) }), 0);
  assert.equal(Buffer.compare(Buffer.from(output.join("")), Buffer.from(text)), 0);
  const journal = await readFile(join(await groupDirectory(location), "journal.jsonl"), "utf8");
  assert.equal(journal.split("Español").length - 1, 1);
});

test("input and journal tampering are detected and left unchanged", async (t) => {
  const location = await fixture(t);
  await initial(location);
  const path = join(await groupDirectory(location), "journal.jsonl");
  const tampered = (await readFile(path, "utf8")).replace("Keep this exactly", "Change this exactly");
  await writeFile(path, tampered);
  await assert.rejects(replay(location), /digest mismatch/u);
  assert.equal(await readFile(path, "utf8"), tampered);
  await assert.rejects(capture({ ...location, group: "other", id: "first", expected: 0 }, { id: "original", text: "changed", sha256: hash("original"), provenance: "owner", attachments: [] }, narrative), /input digest/u);
});

test("unsafe input and invalid UTF-8 are refused without persisting replacements", async (t) => {
  const location = await fixture(t);
  const unsafe = ["Bear", "er", " ", "sensitivevaluehere"].join("");
  await assert.rejects(initial(location, unsafe), /unsafe input refused unchanged/u);
  assert.equal((await replay(location)).group.revision, 0);
  const path = join(location.stateRoot, "invalid.txt");
  await writeFile(path, Buffer.from([0xc3, 0x28]));
  const errors: string[] = [];
  assert.equal(await main({ argv: ["group", "capture", "--state-root", location.stateRoot, "--project", "sample", "--group", "other", "--id", "first", "--expected", "0", "--input-id", "original", "--input-file", path], writeError: (line) => errors.push(line) }), 1);
  assert.equal((await replay({ ...location, group: "other" })).group.revision, 0);
  assert.ok(errors.length > 0);
});

test("capture, proposals, owner decisions and history retain distinct authorities", async (t) => {
  const location = await fixture(t);
  await initial(location);
  const proposal: Proposal = { id: "first", base: 1, narrative, alternatives: [], changes: [{ kind: "define", unit: { ...unit(), serves: [] } }] };
  const staged = await propose({ ...location, id: "propose", expected: 1 }, proposal);
  assert.equal(staged.units.length, 0);
  await assert.rejects(apply({ ...location, id: "apply", expected: 2 }, proposal.id, proposalHash(proposal), "Approve", assistant), /owner terminal/u);
  assert.equal((await replay(location)).group.revision, 2);
  const messages: string[] = [];
  const accepted = await apply({ ...location, id: "apply", expected: 2 }, proposal.id, proposalHash(proposal), "Owner choice", { ...owner, write: (text) => messages.push(text) });
  assert.match(messages[0]!, new RegExp(proposalHash(proposal)));
  assert.deepEqual(accepted.stages.map((stage) => stage.authority), ["owner-input", "assistant-proposal", "owner-decision"]);
  assert.deepEqual(accepted.stages.map((stage) => stage.narrativeAuthority), ["assistant-explanation", "assistant-explanation", "accepted-proposal"]);
  assert.equal(accepted.proposals.length, 1);
  assert.deepEqual((await replay(location)).group, accepted);
});

test("idempotency returns an acknowledged append, but conflicting keys and stale revisions refuse", async (t) => {
  const location = await fixture(t);
  const first = await initial(location);
  assert.deepEqual(await initial(location), first);
  await assert.rejects(initial(location, "different"), /idempotency/u);
  await assert.rejects(capture({ ...location, id: "next", expected: 0 }, { id: "followup", text: "Follow-up", sha256: hash("Follow-up"), provenance: "owner", attachments: [] }, narrative), /stale group revision/u);
});

test("concurrent writers have one winner and a contiguous replay", async (t) => {
  const location = await fixture(t);
  const results = await Promise.allSettled([initial(location), initial(location, "another request")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await replay(location)).group.revision, 1);
});

test("a crash after durable append replays and retries without double applying", async (t) => {
  const location = await fixture(t);
  const input = { id: "original", text: "Request", sha256: hash("Request"), provenance: "owner", attachments: [] };
  await assert.rejects(capture({ ...location, id: "capture", expected: 0, afterAppend() { throw new Error("crash"); } }, input, narrative), /crash/u);
  const retried = await capture({ ...location, id: "capture", expected: 0 }, input, narrative);
  assert.equal(retried.revision, 1);
  assert.equal(retried.inputs.length, 1);
});

test("torn tails and abandoned locks refuse without truncating or stealing evidence", async (t) => {
  const location = await fixture(t);
  await initial(location);
  const dir = await groupDirectory(location);
  const journal = join(dir, "journal.jsonl");
  await appendFile(journal, '{"partial":');
  const before = await readFile(journal);
  await assert.rejects(replay(location), /interrupted group append/u);
  assert.deepEqual(await readFile(journal), before);
  const other = { ...location, group: "locked" };
  const otherDir = await groupDirectory(other);
  await mkdir(otherDir, { recursive: true });
  await writeFile(join(otherDir, "group.lock"), "retained lock");
  await assert.rejects(initial(other), /EEXIST/u);
  assert.equal(await readFile(join(otherDir, "group.lock"), "utf8"), "retained lock");
});

test("intervening stages and wrong proposal hashes cannot reuse approval", async (t) => {
  const location = await fixture(t);
  await initial(location);
  const proposal: Proposal = { id: "first", base: 1, narrative, alternatives: [], changes: [{ kind: "constraints", values: ["One"] }] };
  await propose({ ...location, id: "propose", expected: 1 }, proposal);
  await assert.rejects(apply({ ...location, id: "apply", expected: 2 }, proposal.id, hash("wrong"), "Accept", owner), /hash changed/u);
  await capture({ ...location, id: "followup", expected: 2 }, { id: "followup", text: "New input", sha256: hash("New input"), provenance: "owner", attachments: [] }, narrative);
  await assert.rejects(apply({ ...location, id: "apply", expected: 3 }, proposal.id, proposalHash(proposal), "Accept", owner), /proposal is stale/u);
});

test("reorder preserves identities and unit revisions, split preserves lineage, and deferral retains scope", async (t) => {
  const location = await fixture(t);
  let group = await defined(location, [unit(), unit("two")]);
  group = await amendment(location, [{ kind: "order", units: ["two", "one"] }], "order");
  assert.equal(currentUnit(group, "one").revision, 1);
  group = await amendment(location, [{ kind: "split", unit: "one", reason: "Separate acceptance boundaries", children: [{ ...unit("child-a"), parents: ["one"] }, { ...unit("child-b"), parents: ["one"] }] }], "split");
  assert.equal(currentUnit(group, "one").disposition, "split");
  assert.equal(group.units.filter((value) => value.id === "one").length, 2);
  assert.deepEqual(currentUnit(group, "child-a").parents, ["one"]);
  group = await amendment(location, [{ kind: "defer", unit: "child-a", reason: "Later scope", revisit: "When the interface is accepted" }], "defer");
  assert.equal(currentUnit(group, "child-a").revision, 2);
  assert.deepEqual(currentUnit(group, "child-a").acceptance, unit("child-a").acceptance);
  assert.equal(currentUnit(group, "child-a").disposition, "deferred");
});

test("missing and cyclic prerequisites, lost coverage, duplicate order and split successors refuse", async (t) => {
  const location = await fixture(t);
  const second = { ...unit("two"), prerequisites: [{ unit: "one", revision: 1, kind: "implementation" as const, contract: "Working implementation" }] };
  const group = await defined(location, [unit(), second]);
  assert.deepEqual(affectedSuccessors(group, ["one"]), ["two"]);
  const bad: Change[][] = [
    [{ kind: "define", unit: { ...unit("three"), prerequisites: [{ unit: "missing", revision: 1, kind: "interface", contract: "Contract" }] } }],
    [{ kind: "define", unit: { ...unit("one", 2), prerequisites: [{ unit: "two", revision: 1, kind: "implementation", contract: "Cycle" }] } }],
    [{ kind: "requirements", values: [{ id: "R1", text: "Original" }, { id: "R2", text: "Uncovered" }] }],
    [{ kind: "order", units: ["one", "one"] }],
    [{ kind: "split", unit: "one", reason: "Split", children: [{ ...unit("child-a"), parents: ["one"] }, { ...unit("child-b"), parents: ["one"] }] }],
  ];
  for (const [index, changes] of bad.entries()) await assert.rejects(amendment(location, changes, `bad-${index}`));
  assert.equal((await replay(location)).group.revision, group.revision);
});

test("unknown inventory, fresh todo, awaiting owner, green gates, landing and revision-specific completion", async (t) => {
  const location = await fixture(t);
  let group = await defined(location);
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "todo");
  const absent = join(location.stateRoot, "unavailable");
  assert.equal((await checklist(group, absent, at)).rows[0]?.delivery, "unknown");
  const created = await attempt(location);
  group = await bind(location, group);
  const waiting = nextRevision(created.status, { lifecycleState: "AWAITING_OWNER", gatesPass: true, candidateSha: "a".repeat(40) });
  await persistAttempt(created.attemptDir, 1, { kind: "attempt.transitioned", next: waiting });
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "awaiting-owner");
  const landed = nextRevision(waiting, { lifecycleState: "LANDED" });
  await persistAttempt(created.attemptDir, waiting.revision, { kind: "attempt.transitioned", next: landed });
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "done");
  group = await amendment(location, [{ kind: "define", unit: { ...currentUnit(group, "one"), revision: 2, acceptance: ["Additional acceptance"] } }], "revision");
  const row = (await checklist(group, location.stateRoot, at)).rows[0]!;
  assert.equal(row.delivery, "stale");
  assert.equal(row.observed[0]?.state, "LANDED");
});

test("stale projection never produces done and a missing binding never silently inherits delivery", async (t) => {
  const location = await fixture(t);
  const group = await defined(location);
  const created = await attempt(location);
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "stale");
  await writeFile(join(created.attemptDir, "status.json"), JSON.stringify({ ...created.status, lifecycleState: "LANDED" }));
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "stale");
});

test("defer and all planning reads leave an active attempt byte-identical", async (t) => {
  const location = await fixture(t);
  let group = await defined(location);
  const created = await attempt(location);
  const running = nextRevision(created.status, { lifecycleState: "RUNNING" });
  await persistAttempt(created.attemptDir, 1, { kind: "attempt.transitioned", next: running });
  group = await bind(location, group);
  const paths = [join(created.attemptDir, "journal.jsonl"), join(created.attemptDir, "status.json")];
  const before = await Promise.all(paths.map((path) => readFile(path)));
  group = await amendment(location, [{ kind: "defer", unit: "one", reason: "Later", revisit: "Owner asks" }], "defer");
  const view = await checklist(group, location.stateRoot, at);
  await packet(group, view, "one", 100_000);
  assert.equal(view.rows[0]?.disposition, "deferred");
  assert.equal(view.rows[0]?.observed[0]?.state, "RUNNING");
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
});

test("packet unavailable and checklist absent do not change execution authorization or accounting", async (t) => {
  const location = await fixture(t);
  const group = await defined(location);
  const observation = await checklist(group, location.stateRoot, at);
  const execute = () => {
    const ledger = new CallBudget({ taskId: "ordinary", tier: 1 });
    const authorized = transition({ from: "PREPARED", to: "RUNNING", actor: "host", tier: 1,
      reason: { source: "process", detail: "workflow start" }, interactive: false, budget: ledger.snapshot(),
      evidence: { workflowCompiled: true }, spawn: { cost: 1 } });
    const reserved = ledger.reserve({ cost: authorized.spends.calls });
    ledger.spendOnGo(reserved.id);
    return { authorized, accounting: ledger.snapshot() };
  };
  await packet(group, observation, "one", 100_000);
  const withViews = execute();
  await assert.rejects(packet(group, observation, "one", 1), /overflow/u);
  await rm(await groupDirectory(location), { recursive: true });
  const withoutViews = execute();
  assert.deepEqual(withViews, withoutViews);
  assert.equal(withoutViews.accounting.callsSpent, 1);
  assert.equal(withoutViews.accounting.callsReserved, 0);
  // Also exercise ordinary request creation with no planning state at all.
  const created = await attempt(location, "ordinary");
  assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "DRAFT");
});

test("interface acceptance is distinct from implementation completion and evidence changes invalidate it", async (t) => {
  const location = await fixture(t);
  const second = { ...unit("two"), prerequisites: [{ unit: "one", revision: 1, kind: "interface" as const, contract: "API v1" }] };
  let group = await defined(location, [unit(), second]);
  assert.equal((await checklist(group, location.stateRoot, at)).rows[1]?.delivery, "blocked");
  const file = join(location.stateRoot, "design.txt");
  await writeFile(file, "Accepted API v1");
  const ref = await reference(file, "sample", "design-v1", "complete text", "text");
  group = await amendment(location, [{ kind: "accept-interface", unit: "one", revision: 1, contract: "API v1", evidence: [ref] }], "interface");
  assert.equal((await checklist(group, location.stateRoot, at)).rows[1]?.delivery, "todo");
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "todo");
  await writeFile(file, "Different API");
  assert.equal((await checklist(group, location.stateRoot, at)).rows[1]?.delivery, "blocked");
});

test("owner-accepted reports require owner approval of revision-specific evidence", async (t) => {
  const location = await fixture(t);
  let group = await defined(location, [{ ...unit(), completion: "owner-accepted" }]);
  const file = join(location.stateRoot, "report.txt");
  await writeFile(file, "Report output");
  const evidence = [await reference(file, "sample", "report-v1", "complete report", "text")];
  group = await amendment(location, [{ kind: "accept-delivery", unit: "one", revision: 1, evidence }], "accept");
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "done");
  group = await amendment(location, [{ kind: "define", unit: { ...currentUnit(group, "one"), revision: 2, acceptance: ["New report criteria"] } }], "new-criteria");
  assert.notEqual((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "done");
});

test("packet/checklist output is deterministic, complete or explicitly refused, and stale references fail", async (t) => {
  const location = await fixture(t);
  const file = join(location.stateRoot, "source.txt");
  await writeFile(file, "Read this evidence");
  const ref = await reference(file, "sample", "source-v1", "line 1", "text");
  const group = await defined(location, [{ ...unit(), references: [ref] }]);
  const observed = await checklist(group, location.stateRoot, at);
  assert.equal(bounded(observed, 100_000), bounded(await checklist(group, location.stateRoot, at), 100_000));
  const view = await packet(group, observed, "one", 100_000);
  assert.equal(await packet(group, observed, "one", Buffer.byteLength(view)), view);
  await assert.rejects(packet(group, observed, "one", Buffer.byteLength(view) - 1), /No partial output/u);
  const parsed = JSON.parse(view) as Record<string, unknown>;
  for (const key of ["constraints", "requirements", "inputs", "scope", "prerequisites", "amendments", "observations", "references"]) assert.ok(Object.hasOwn(parsed, key));
  await writeFile(file, "Changed evidence");
  await assert.rejects(packet(group, observed, "one", 100_000), /stale evidence/u);
});

test("schema rejects invented authority and commands reject duplicate/unknown options", async (t) => {
  const location = await fixture(t);
  await initial(location);
  await assert.rejects(propose({ ...location, id: "proposal", expected: 1 }, { id: "first", base: 1, narrative, alternatives: [], changes: [{ kind: "constraints", values: [] }], authority: "owner" } as unknown as Proposal), /schema/u);
  for (const argv of [["group", "orient", "--typo", "value"], ["group", "orient", "--group", "one", "--group", "two"]]) {
    const errors: string[] = [];
    assert.equal(await main({ argv, writeError: (line) => errors.push(line) }), 1);
    assert.ok(errors.length);
  }
});

test("repository runtime roots, traversal, and symlinked group journals are refused", async (t) => {
  const location = await fixture(t);
  await assert.rejects(replay({ ...location, group: "../elsewhere" }), /path-safe/u);
  await assert.rejects(groupDirectory({ ...location, stateRoot: resolve("runtime") }), /outside repositories/u);
  await initial(location);
  const target = join(location.stateRoot, "redirect");
  await writeFile(target, "do not touch");
  const other = { ...location, group: "redirected" };
  const dir = await groupDirectory(other);
  await mkdir(dir, { recursive: true });
  await symlink(target, join(dir, "journal.jsonl"));
  await assert.rejects(replay(other), /symlinked/u);
  assert.equal(await readFile(target, "utf8"), "do not touch");
});

test("preview focuses unapproved scope without applying it or checking off delivery", async (t) => {
  const location = await fixture(t);
  await initial(location);
  const proposal: Proposal = { id: "candidate", base: 1, narrative, alternatives: [], changes: [{ kind: "define", unit: { ...unit(), serves: [] } }] };
  const group = await propose({ ...location, id: "proposed", expected: 1 }, proposal);
  const preview = previewGroup(group, proposal.id);
  const text = await packet(preview, await checklist(preview, location.stateRoot, at), "one", 100_000, proposal.id);
  assert.match(text, /assistant-proposal preview/u);
  assert.match(text, /proposal scope is not owner-approved/u);
  assert.match(text, /"delivery": "unknown"/u);
  assert.equal((await replay(location)).group.units.length, 0);
  assert.deepEqual((await checklist(group, location.stateRoot, at)).rows, []);
  const output: string[] = [];
  assert.equal(await main({ argv: ["group", "focus", "--state-root", location.stateRoot, "--project", location.project, "--group", location.group, "--proposal", proposal.id, "--unit", "one"], writeOut: (text) => output.push(text) }), 0);
  assert.match(output[0]!, /assistant-proposal preview/u);
});

test("owner decline and unresolved execution binding do not append decisions", async (t) => {
  const location = await fixture(t);
  const group = await defined(location);
  await assert.rejects(bind(location, group), /binding does not resolve/u);
  assert.equal((await replay(location)).group.revision, group.revision);
  const proposal: Proposal = { id: "defer", base: group.revision, narrative, alternatives: [], changes: [{ kind: "defer", unit: "one", reason: "Later", revisit: "Owner asks" }] };
  const proposed = await propose({ ...location, id: "proposal", expected: group.revision }, proposal);
  await assert.rejects(apply({ ...location, id: "apply", expected: proposed.revision }, proposal.id, proposalHash(proposal), "Accept", { ...owner, async confirm() { return false; } }), /owner declined/u);
  assert.equal(currentUnit((await replay(location)).group, "one").disposition, "active");
});

test("deferring an implementation prerequisite affects successors, not independent scheduling preferences", async (t) => {
  const location = await fixture(t);
  const dependent = { ...unit("two"), prerequisites: [{ unit: "one", revision: 1, kind: "implementation" as const, contract: "Working code" }] };
  let group = await defined(location, [unit(), dependent, unit("independent")]);
  group = await amendment(location, [{ kind: "order", units: ["independent", "two", "one"] }, { kind: "defer", unit: "one", reason: "Not now", revisit: "Owner asks" }], "deferred-prerequisite");
  const result = await checklist(group, location.stateRoot, at);
  assert.equal(result.rows.find((row) => row.id === "two")?.delivery, "blocked");
  assert.equal(result.rows.find((row) => row.id === "independent")?.delivery, "todo");
  assert.deepEqual(affectedSuccessors(group, ["one"]), ["two"]);
});

test("attachments retain provenance and stale attachments or NUL input refuse admission", async (t) => {
  const location = await fixture(t);
  const path = join(location.stateRoot, "attachment.bin");
  await writeFile(path, Buffer.from([1, 2, 3, 4]));
  const attachment = await reference(path, "sample", "attachment-v1", "owner attachment", "attachment");
  await writeFile(path, Buffer.from([1, 2, 3, 5]));
  await assert.rejects(capture({ ...location, id: "capture", expected: 0 }, { id: "original", text: "Input", sha256: hash("Input"), provenance: "owner", attachments: [attachment] }, narrative), /stale evidence/u);
  await assert.rejects(initial(location, "invalid" + String.fromCharCode(0)), /NUL/u);
  await assert.rejects(initial(location, String.fromCharCode(0xd800)), /Unicode/u);
  assert.equal((await replay(location)).group.revision, 0);
});

test("registered plan source and Section B/ticket authority remain part of the read-only completion join", async (t) => {
  const location = await fixture(t);
  const repository = join(location.stateRoot, "foreign-plan-repository");
  const catalog = join(repository, "awsf.project.yaml");
  const tickets = join(repository, "specs", "tickets", "sample-plan");
  await mkdir(tickets, { recursive: true });
  const catalogText = "version: awsf.project/v1\nproject:\n  slug: sample\nrepositories:\n  plans:\n    role: plan\n    default_branch: main\nplans:\n  root: specs\n  format: awsf-plan-html/v1\n  default: sample-plan\n";
  await writeFile(catalog, catalogText);
  await writePlacement(location.stateRoot, location.project, { version: "awsf.placement/v1", project: location.project, repositories: { plans: { path: repository } } });
  const html = '<section><h3><code class="status">[]</code> Milestone M1: Sample</h3><h4>1. Sample task</h4><ul><li><code class="status">[]</code> Complete</li></ul></section>';
  await writeFile(join(repository, "specs", "sample-plan.html"), html);
  const prompt = "Build the sample task";
  // Legacy combined prompts use unpadded T1 while the ticket identity is T01.
  await writeFile(join(repository, "specs", "sample-plan-build-prompts.md"), `# Section B — Task prompts (recommended)\n\n### T1 — Sample task\n\n${prompt}\n`);
  const ticket = `---\nid: T01\ntitle: Sample task\nmilestone: M1\nstate: todo\ndepends_on: []\n---\n\n## Build prompt\n\n${prompt}\n`;
  await writeFile(join(tickets, "T01.md"), ticket);
  let group = await defined(location, [{ ...unit(), plan: { catalog, stem: "sample-plan", task: "T01", sourceSha256: hash(html) } }]);
  const created = await attempt(location);
  group = await bind(location, group);
  await persistAttempt(created.attemptDir, 1, { kind: "attempt.transitioned", next: nextRevision(created.status, { lifecycleState: "LANDED", candidateSha: "a".repeat(40) }) });
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "awaiting-owner");
  assert.equal(await readFile(join(tickets, "T01.md"), "utf8"), ticket);
  await writeFile(join(tickets, "T01.md"), ticket.replace(prompt, "A changed prompt"));
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "stale");
  await writeFile(join(tickets, "T01.md"), ticket);
  await writeFile(catalog, catalogText.replace("awsf-plan-html/v1", "unsupported-format/v1"));
  assert.notEqual((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "done");
});

test("current source refresh supersedes historical hashes without erasing amendment history", async (t) => {
  const location = await fixture(t);
  const file = join(location.stateRoot, "source.txt");
  await writeFile(file, "Version one");
  const old = await reference(file, "sample", "version-one", "line 1", "text");
  await initial(location);
  const proposal: Proposal = { id: "old", base: 1, narrative: { ...narrative, references: [old] }, alternatives: [], changes: [{ kind: "define", unit: { ...unit(), serves: [], references: [old] } }] };
  await propose({ ...location, id: "propose-old", expected: 1 }, proposal);
  await apply({ ...location, id: "apply-old", expected: 2 }, proposal.id, proposalHash(proposal), "Accept original", owner);
  await writeFile(file, "Version two");
  const fresh = await reference(file, "sample", "version-two", "line 1", "text");
  const group = await amendment(location, [{ kind: "define", unit: { ...unit("one", 2), serves: [], references: [fresh] } }], "refresh");
  const text = await packet(group, await checklist(group, location.stateRoot, at), "one", 100_000);
  const value = JSON.parse(text) as { references: { id: string; sha256: string; freshness: string }[] };
  assert.ok(value.references.some((ref) => ref.sha256 === old.sha256 && ref.freshness.startsWith("historical")));
  assert.ok(value.references.some((ref) => ref.sha256 === fresh.sha256 && ref.freshness === "hash-verified"));
  const ids = new Set(value.references.map((ref) => ref.id));
  for (const match of text.matchAll(/"reference": "([^"]+)"/gu)) assert.ok(ids.has(match[1]!), "every interned pointer resolves in the packet");
  assert.equal(ids.size, value.references.length);
  const output: string[] = [];
  assert.equal(await main({ argv: ["group", "inspect", "--state-root", location.stateRoot, "--project", location.project, "--group", location.group, "--proposal", "old"], writeOut: (text) => output.push(text) }), 0);
  assert.match(output[0]!, new RegExp(old.sha256));
  assert.doesNotMatch(output[0]!, /Version two/u);
});

test("evidence changed during owner confirmation refuses instead of recording stale acceptance", async (t) => {
  const location = await fixture(t);
  const group = await defined(location, [{ ...unit(), completion: "owner-accepted" }]);
  const file = join(location.stateRoot, "report.txt");
  await writeFile(file, "Original report");
  const ref = await reference(file, "sample", "report-v1", "complete text", "text");
  const proposal: Proposal = { id: "accept", base: group.revision, narrative, alternatives: [], changes: [{ kind: "accept-delivery", unit: "one", revision: 1, evidence: [ref] }] };
  const proposed = await propose({ ...location, id: "propose", expected: group.revision }, proposal);
  await assert.rejects(apply({ ...location, id: "apply", expected: proposed.revision }, proposal.id, proposalHash(proposal), "Accept", { ...owner, async confirm() { await writeFile(file, "Changed while confirming"); return true; } }), /stale evidence/u);
  assert.equal((await replay(location)).group.decisions.includes(proposal.id), false);
});

test("global acceptance context changes invalidate old unit completion without whole-unit reauthoring", async (t) => {
  const location = await fixture(t);
  let group = await defined(location, [unit(), unit("two")]);
  const created = await attempt(location);
  group = await bind(location, group);
  await persistAttempt(created.attemptDir, 1, { kind: "attempt.transitioned", next: nextRevision(created.status, { lifecycleState: "LANDED", candidateSha: "a".repeat(40) }) });
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "done");
  group = await amendment(location, [{ kind: "constraints", values: ["Additional applicable acceptance constraint"] }], "context-change");
  assert.equal(currentUnit(group, "one").revision, 2);
  assert.equal(currentUnit(group, "two").revision, 2);
  assert.equal((await checklist(group, location.stateRoot, at)).rows[0]?.delivery, "stale");
  group = await amendment(location, [{ kind: "requirements", values: [{ id: "R1", text: "Changed requirement" }] }], "requirement-change");
  assert.equal(currentUnit(group, "one").revision, 3);
  assert.equal(currentUnit(group, "two").revision, 3);
  assert.equal(group.bindings[0]?.revision, 1);
});

test("closing the group retains history and refuses all subsequent writes", async (t) => {
  const location = await fixture(t);
  const group = await defined(location);
  const closed = await amendment(location, [{ kind: "close", reason: "Handoff" }], "close");
  assert.equal(closed.closed, true);
  assert.ok(closed.revision > group.revision);
  await assert.rejects(amendment(location, [{ kind: "order", units: ["one"] }], "later"), /closed/u);
  assert.deepEqual((await replay(location)).group, closed);
});
