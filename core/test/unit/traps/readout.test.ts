import assert from "node:assert/strict";
import { after, test } from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { main } from "../../../src/cli/main.ts";
import { trapsCommand } from "../../../src/cli/commands/traps.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptEvent, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { TRAPS_READOUT_SCHEMA_ID, TrapsReadoutSchema } from "../../../src/contracts/traps-readout.ts";
import { ATTRIBUTION_RECORD_SCHEMA_ID, type AttributionRecordV2 } from "../../../src/contracts/attribution-record.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import { appendTaskAttribution } from "../../../src/persistence/task-attributions.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { journalFilePath } from "../../../src/persistence/platform-paths.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { TRAPS, TRAP_CUT } from "../../../src/traps/catalogue.ts";
import { readTrapsReadout as readCurrentTrapsReadout, trapsExitCode } from "../../../src/traps/readout.ts";

// Exact serialized outputs captured from the original reader on every existing successful fixture read.
const baselineReadouts: string[] = JSON.parse(readFileSync(new URL("./readout.snapshot.json", import.meta.url), "utf8"));
let fixtureRead = 0;
async function readTrapsReadout(stateRoot: string) {
  const model = await readCurrentTrapsReadout(stateRoot);
  const baseline = JSON.parse(baselineReadouts[fixtureRead++]!);
  // M4 intentionally advances the catalogue; journal-derived bytes stay pinned.
  baseline.catalogue.traps = 17;
  baseline.catalogue.byTrap.push({ id: "TR-13", seeds: 2 }, { id: "TR-14", seeds: 1 }, { id: "TR-15", seeds: 0 }, { id: "TR-16", seeds: 1 }, { id: "TR-17", seeds: 2 });
  baseline.nextFreeTrapId = "TR-18";
  assert.equal(JSON.stringify(model), JSON.stringify(baseline), "fixture journal readout bytes are unchanged");
  return model;
}
after(() => assert.equal(fixtureRead, baselineReadouts.length, "all baseline fixture readouts were checked"));

const PRE = "2026-10-07T12:00:00.000Z";
const POST = "2026-10-08T12:00:00.000Z";
const LATER = "2026-10-09T12:00:00.000Z";
const BASE = "a".repeat(40);
const CANDIDATE = "b".repeat(40);

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "awsf-traps-readout-"));
  return { root, stateRoot: join(root, "state"), close: () => rmSync(root, { recursive: true, force: true }) };
}

async function register(box: ReturnType<typeof sandbox>, project: string) {
  await writePlacement(box.stateRoot, project, { version: "awsf.placement/v1", project, repositories: { main: { path: box.root } } });
}

async function attempt(box: ReturnType<typeof sandbox>, project: string, taskId: string,
  state: AttemptStatus["lifecycleState"] = "BLOCKED", at = POST, workflow = "build") {
  const created = await newCommand({ stateRoot: box.stateRoot, project, taskId, repository: box.root,
    request: `synthetic ${taskId}`, workflow: "build", tier: 1, now: () => PRE, sessionId: () => `${project}-${taskId}` });
  const next = nextRevision(created.status, { lifecycleState: state, workflow, lastActivityAt: at, lastActivity: `synthetic ${state}`,
    baseSha: BASE, candidateSha: null });
  await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.transitioned", next, evidence: {
    type: "transition", id: `${project}-${taskId}-terminal`, seq: next.revision, from: "DRAFT", to: state, actor: "host",
    edgeId: "synthetic", reasonSource: "human", reasonCode: null, reasonDetail: "synthetic stop",
    spawnSite: false, at,
  } });
  return { attemptDir: created.attemptDir, taskRoot: join(box.stateRoot, "projects", project, "tasks", taskId), status: next };
}

async function link(facts: Awaited<ReturnType<typeof attempt>>, trap: AttributionRecordV2["trap"]) {
  await appendTaskAttribution(facts.taskRoot, { schema: ATTRIBUTION_RECORD_SCHEMA_ID, project: facts.status.project,
    taskId: facts.status.taskId, attempt: 1, cause: "factory", reason: "synthetic coverage reason", at: LATER, trap });
}

async function appendEvent(facts: Awaited<ReturnType<typeof attempt>>, event: AttemptEvent) {
  const journal = new Journal<AttemptEvent>(journalFilePath(facts.attemptDir));
  try { await journal.append(event); } finally { await journal.close(); }
}

function snapshot(root: string): unknown[] {
  const rows: unknown[] = [];
  function visit(path: string) {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const stat = statSync(full);
      rows.push([relative(root, full), stat.mode, stat.mtimeMs, stat.size, stat.isDirectory() ? null : readFileSync(full).toString("hex")]);
      if (stat.isDirectory()) visit(full);
    }
  }
  visit(root);
  return rows;
}

async function ownerShapedRoot(box: ReturnType<typeof sandbox>) {
  await register(box, "awsf");
  await register(box, "fusion");
  await register(box, "empty");
  await attempt(box, "awsf", "pre-cut", "CANCELLED", PRE);
  await attempt(box, "awsf", "at-cut", "CANCELLED", TRAP_CUT);
  await link(await attempt(box, "awsf", "linked"), { kind: "trap", id: "TR-01" });
  await attempt(box, "awsf", "unlinked", "CANCELLED");
  await link(await attempt(box, "fusion", "missing"), { kind: "trap", id: "TR-99" });
  await link(await attempt(box, "fusion", "no-trap", "CANCELLED"), { kind: "none", because: "fixed", reason: "synthetic defect already fixed" });
  await attempt(box, "awsf", "prove-replay", "CANCELLED", POST, "prove");
  await attempt(box, "unregistered", "ignored");
  const landed = await attempt(box, "awsf", "landed", "LANDED");
  // Synthetic landed history uses real full AttemptStatus records and canonical gate evidence.
  await appendEvent(landed, { kind: "attempt.updated", next: { ...landed.status, candidateSha: CANDIDATE, lastActivityAt: LATER }, evidence: {
    type: "gate", id: "landed-commands", phaseId: "gate", round: 1, gateId: "commands_pass", kind: "subprocess",
    candidateSha: CANDIDATE, passed: true, exitCode: 0, checks: [{ item: "traps:exit code zero", ok: true, note: "exitCode=0" }],
    violations: [], outputPath: null, startedAt: POST, endedAt: POST,
  } });
  return landed;
}

test("awsf.traps/v1 is a closed host record, never a provider envelope", () => {
  assert.equal(RECORD_SCHEMAS[TRAPS_READOUT_SCHEMA_ID], TrapsReadoutSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, TRAPS_READOUT_SCHEMA_ID), false);
});

test("owner-shaped registered roots return exact four coverage lists, counts, next id and newest landed gate", async () => {
  const box = sandbox();
  try {
    await ownerShapedRoot(box);
    const before = snapshot(box.root);
    const model = await readTrapsReadout(box.stateRoot);
    assert.equal(Value.Check(TrapsReadoutSchema, model), true);
    assert.equal(model.cut, TRAP_CUT);
    assert.equal(model.stops.total, 4);
    const identity = (items: readonly { project: string; taskId: string; attempt: number }[]) => items.map(item => `${item.project}/${item.taskId}#${item.attempt}`);
    assert.deepEqual(identity(model.stops.linkedToTrap), ["awsf/linked#1"]);
    assert.deepEqual(identity(model.stops.linkedToNoTrap), ["fusion/no-trap#1"]);
    assert.deepEqual(identity(model.stops.missingTrap), ["fusion/missing#1"]);
    assert.deepEqual(identity(model.stops.unlinked), ["awsf/unlinked#1"]);
    assert.deepEqual(model.stops.missingTrap[0]?.trap, { kind: "trap", id: "TR-99" });
    assert.deepEqual(model.stops.linkedToNoTrap[0]?.trap, { kind: "none", because: "fixed", reason: "synthetic defect already fixed" });
    assert.deepEqual(model.stops, {
      total: 4,
      linkedToTrap: [{ project: "awsf", taskId: "linked", attempt: 1, terminalAt: POST, lifecycleState: "BLOCKED",
        trap: { kind: "trap", id: "TR-01" } }],
      linkedToNoTrap: [{ project: "fusion", taskId: "no-trap", attempt: 1, terminalAt: POST, lifecycleState: "CANCELLED",
        trap: { kind: "none", because: "fixed", reason: "synthetic defect already fixed" } }],
      missingTrap: [{ project: "fusion", taskId: "missing", attempt: 1, terminalAt: POST, lifecycleState: "BLOCKED",
        trap: { kind: "trap", id: "TR-99" } }],
      unlinked: [{ project: "awsf", taskId: "unlinked", attempt: 1, terminalAt: POST, lifecycleState: "CANCELLED", preLink: false }],
    });
    assert.equal(model.catalogue.traps, 17);
    assert.deepEqual(model.catalogue.byTrap, TRAPS.map(trap => ({ id: trap.id, seeds: trap.seeds.length })));
    assert.equal(model.catalogue.noTraps, 48);
    assert.deepEqual(model.catalogue.byNoTrapKind, { fixed: 4, "after-spend": 25, owner: 3, unexplained: 9, "not-a-stop": 7 });
    assert.equal(model.nextFreeTrapId, "TR-18");
    assert.deepEqual(model.projects, [
      { project: "awsf", newestLanded: { taskId: "landed", attempt: 1, landedAt: POST, baseSha: BASE, candidateSha: CANDIDATE, traps: { passed: true, sha: CANDIDATE } } },
      { project: "empty", newestLanded: null }, { project: "fusion", newestLanded: null },
    ]);
    assert.equal(trapsExitCode(model), 1);
    assert.deepEqual(snapshot(box.root), before, "readout changes no file, mode, size or mtime");
    assert.equal(Value.Check(TrapsReadoutSchema, { ...model, repair: true }), false);
  } finally { box.close(); }
});

test("main traps JSON and text need no config or owner terminal, write nothing, and report rather than repair", async () => {
  const box = sandbox();
  try {
    await ownerShapedRoot(box);
    const before = snapshot(box.root);
    const json: string[] = [];
    const errors: string[] = [];
    const terminal = { interactive: false, write: () => assert.fail("no owner terminal"), confirm: async () => { assert.fail("no confirmation"); return false; } };
    assert.equal(await main({ argv: ["traps", "--json", "--state-root", box.stateRoot], cwd: box.root, env: {}, terminal,
      writeOut: line => json.push(line), writeError: line => errors.push(line) }), 1);
    assert.equal(json.length, 1);
    assert.equal(Value.Check(TrapsReadoutSchema, JSON.parse(json[0]!)), true);
    assert.deepEqual(JSON.parse(json[0]!), await readTrapsReadout(box.stateRoot));
    assert.equal(errors.length, 0);
    const text: string[] = [];
    assert.equal(await main({ argv: ["traps", "--state-root", box.stateRoot], cwd: box.root, env: {}, terminal,
      writeOut: line => text.push(line), writeError: line => errors.push(line) }), 1);
    assert.match(text.join("\n"), /fusion\/missing attempt 1.*TR-99/);
    assert.match(text.join("\n"), /awsf\/unlinked attempt 1/);
    assert.match(text.join("\n"), /reports and never repairs/);
    assert.deepEqual(snapshot(box.root), before);
  } finally { box.close(); }
});

test("terminalAt comes from a real attempt's transition, not a later activity record or status file", async () => {
  const box = sandbox();
  try {
    await register(box, "awsf");
    const pre = await attempt(box, "awsf", "pre", "BLOCKED", PRE);
    // Pin a disagreement on the transition record itself: evidence.at, not next.lastActivityAt, owns terminal time.
    const transitionJournal = new Journal<AttemptEvent>(journalFilePath(pre.attemptDir));
    try {
      await transitionJournal.append({ kind: "attempt.transitioned", next: { ...pre.status, lastActivityAt: LATER }, evidence: {
        type: "transition", id: "pre-evidence", seq: 3, from: "DRAFT", to: "BLOCKED", actor: "host", edgeId: "synthetic",
        reasonSource: "human", reasonCode: null, reasonDetail: "synthetic stop", spawnSite: false, at: PRE,
      } });
    } finally { await transitionJournal.close(); }
    // Historical metadata after terminal state must never move a pre-cut stop across the cut.
    await appendEvent(pre, { kind: "attempt.updated", next: { ...pre.status, lastActivityAt: LATER } });
    const post = await attempt(box, "awsf", "post", "CANCELLED", POST);
    await appendEvent(post, { kind: "attempt.updated", next: { ...post.status, lastActivityAt: LATER } });
    const status = await readAttempt(post.attemptDir);
    writeFileSync(join(post.attemptDir, "status.json"), JSON.stringify({ ...status, lastActivityAt: PRE }));
    const legacy = await attempt(box, "awsf", "legacy-transition", "BLOCKED", PRE);
    const path = journalFilePath(legacy.attemptDir);
    const rows = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    delete rows[1].event.evidence;
    rows[1].recorded_at = PRE;
    rows[1].event.next.lastActivityAt = LATER;
    writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const model = await readTrapsReadout(box.stateRoot);
    assert.equal(model.stops.total, 1);
    assert.equal(model.stops.unlinked[0]?.taskId, "post");
    assert.equal(model.stops.unlinked[0]?.terminalAt, POST);
  } finally { box.close(); }
});

test("v1 attribution is counted as pre-link and v2 latest wins without moving the stop time", async () => {
  const box = sandbox();
  try {
    await register(box, "awsf");
    const facts = await attempt(box, "awsf", "legacy");
    const journal = new Journal(join(facts.taskRoot, "attributions.jsonl"));
    try { await journal.append({ schema: "awsf.attribution/v1", project: "awsf", taskId: "legacy", attempt: 1,
      cause: "factory", reason: "synthetic legacy judgement", at: LATER }); } finally { await journal.close(); }
    assert.deepEqual((await readTrapsReadout(box.stateRoot)).stops.unlinked.map(item => item.preLink), [true]);
    await link(facts, { kind: "trap", id: "TR-01" });
    const model = await readTrapsReadout(box.stateRoot);
    assert.equal(model.stops.unlinked.length, 0);
    assert.equal(model.stops.linkedToTrap.length, 1);
    assert.equal(model.stops.linkedToTrap[0]?.terminalAt, POST);
    assert.equal(trapsExitCode(model), 0);
    // A historical v1 appended later still wins; neither schema version nor timestamp sorts records.
    const latest = new Journal(join(facts.taskRoot, "attributions.jsonl"));
    try { await latest.append({ schema: "awsf.attribution/v1", project: "awsf", taskId: "legacy", attempt: 1,
      cause: "driver", reason: "synthetic later historical judgement", at: PRE }); } finally { await latest.close(); }
    const reversed = await readTrapsReadout(box.stateRoot);
    assert.deepEqual(reversed.stops.linkedToTrap, []);
    assert.deepEqual(reversed.stops.unlinked, [{ project: "awsf", taskId: "legacy", attempt: 1,
      terminalAt: POST, lifecycleState: "BLOCKED", preLink: true }]);
    assert.equal(trapsExitCode(reversed), 1);
  } finally { box.close(); }
});

test("newest landed row replaces older green: absent, red and stale-candidate traps are not reported passing", async () => {
  const box = sandbox();
  try {
    const old = await ownerShapedRoot(box);
    const newer = await attempt(box, "awsf", "newest", "LANDED", LATER);
    let model = await readTrapsReadout(box.stateRoot);
    assert.equal(model.projects[0]?.newestLanded?.taskId, "newest");
    assert.deepEqual(model.projects[0]?.newestLanded?.traps, { passed: null, sha: null });
    const gate: NonNullable<AttemptEvent["evidence"]> = { type: "gate", id: "newest-commands", phaseId: "gate", round: 2,
      gateId: "commands_pass", kind: "subprocess", candidateSha: CANDIDATE, passed: false, exitCode: 1,
      checks: [{ item: "traps:exit code zero", ok: false, note: "exitCode=1" }], violations: [], outputPath: null, startedAt: LATER, endedAt: LATER };
    await appendEvent(newer, { kind: "attempt.updated", next: { ...newer.status, candidateSha: CANDIDATE }, evidence: gate });
    model = await readTrapsReadout(box.stateRoot);
    assert.deepEqual(model.projects[0]?.newestLanded?.traps, { passed: false, sha: CANDIDATE });
    await appendEvent(newer, { kind: "attempt.updated", next: { ...newer.status, candidateSha: BASE }, evidence: { ...gate, passed: true,
      checks: [{ item: "traps:exit code zero", ok: true, note: "exitCode=0" }] } });
    model = await readTrapsReadout(box.stateRoot);
    assert.deepEqual(model.projects[0]?.newestLanded?.traps, { passed: null, sha: null });
    // Later publication/activity on the older landed attempt cannot make it newest.
    await appendEvent(old, { kind: "attempt.transitioned", next: { ...old.status, lifecycleState: "PUBLISHED", lastActivityAt: "2026-10-10T12:00:00.000Z" } });
    assert.equal((await readTrapsReadout(box.stateRoot)).projects[0]?.newestLanded?.taskId, "newest");
  } finally { box.close(); }
});

test("empty roots and fully linked roots exit zero with valid JSON, without creating anything", async () => {
  const box = sandbox();
  try {
    const absent = join(box.root, "absent");
    const before = snapshot(box.root);
    await readTrapsReadout(absent);
    const result = await trapsCommand(absent);
    assert.equal(result.exitCode, 0);
    assert.equal(Value.Check(TrapsReadoutSchema, result.model), true);
    assert.deepEqual(result.model.stops, { total: 0, linkedToTrap: [], linkedToNoTrap: [], missingTrap: [], unlinked: [] });
    assert.deepEqual(snapshot(box.root), before);
    await register(box, "awsf");
    await link(await attempt(box, "awsf", "linked"), { kind: "trap", id: "TR-01" });
    const json: string[] = [];
    assert.equal(await main({ argv: ["traps", "--json", "--state-root", box.stateRoot], cwd: box.root, env: {}, writeOut: line => json.push(line) }), 0);
    assert.equal(Value.Check(TrapsReadoutSchema, JSON.parse(json[0]!)), true);
    assert.equal(json[0], JSON.stringify(await readTrapsReadout(box.stateRoot)));
  } finally { box.close(); }
});

test("torn attempt journals and invalid registered placements fail without changing evidence", async () => {
  const box = sandbox();
  try {
    await register(box, "awsf");
    const facts = await attempt(box, "awsf", "torn");
    appendFileSync(journalFilePath(facts.attemptDir), "{unfinished");
    const before = snapshot(box.root);
    await assert.rejects(readTrapsReadout(box.stateRoot), /interrupted attempt append/);
    assert.deepEqual(snapshot(box.root), before);
    mkdirSync(join(box.stateRoot, "projects", "invalid"), { recursive: true });
    writeFileSync(join(box.stateRoot, "projects", "invalid", "placement.yaml"), "invalid: true");
    // Registration is not silently dropped when its placement is unreadable.
    await assert.rejects(readTrapsReadout(box.stateRoot));
  } finally { box.close(); }
});
