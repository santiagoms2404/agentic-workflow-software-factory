import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { readAttempt, nextRevision, persistAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { preflightCommand } from "../../../src/cli/commands/preflight.ts";
import { nextCommand } from "../../../src/cli/commands/next.ts";
import { startCommand, StartPreflightRefused } from "../../../src/cli/commands/start.ts";
import { statusCommand, statusJson } from "../../../src/cli/commands/status.ts";
import { gatherRepositoryRows } from "../../../src/doctor/repository.ts";
import { markersRow } from "../../../src/doctor/markers.ts";
import { gatherLandingClosures, readClosure } from "../../../src/closure/readout.ts";
import { CLOSURE_CUT, closureReadout, type LandingClosureFact } from "../../../src/closure/model.ts";
import { evaluateClosure } from "../../../src/preflight/fields.ts";
import { withProjectClosureJournal } from "../../../src/persistence/project-closure-journal.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { box, draft, prepare, start } from "../../fixtures/trap-world.ts";
import { projectDir, recordSyntheticClosure, selectedLanding, syntheticClosure } from "../../fixtures/closure-readers.ts";

const fact: LandingClosureFact = { project: "synthetic", taskId: "landed", attempt: 1,
  landedAt: "2026-10-09T22:02:57Z", hasSelection: true, closure: { state: "not closed", record: null } };

test("K1 closure counts strictly after the fixed cut, only selections without records, and names every attempt", () => {
  assert.equal(CLOSURE_CUT, "2026-10-09T22:02:56Z");
  const ignored = [ { ...fact, landedAt: "2026-10-09T22:02:55Z" }, { ...fact, landedAt: CLOSURE_CUT },
    { ...fact, hasSelection: false }, { ...fact, closure: { state: "open by the owner's choice" as const, record: syntheticClosure("a".repeat(40), true) } } ];
  assert.deepEqual(evaluateClosure(ignored), { passed: true });
  const result = evaluateClosure([...ignored, fact, { ...fact, taskId: "second", attempt: 2 }]);
  assert.equal(result.passed, false);
  if (result.passed) return;
  assert.equal(result.reason, "attempt synthetic/landed#1 landed after 2026-10-09T22:02:56Z with a ticket selection and no closure record; owner closes it with awsf close landed --project synthetic --attempt 1; attempt synthetic/second#2 landed after 2026-10-09T22:02:56Z with a ticket selection and no closure record; owner closes it with awsf close second --project synthetic --attempt 2");
});

test("closure matching requires candidate, plan and the full sealed selection, never task names", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const record = syntheticClosure(landed.status.candidateSha!);
    for (const wrong of [{ ...record, candidateSha: "b".repeat(40) }, { ...record, plan: "other" }, { ...record, tickets: [] }]) {
      assert.equal(closureReadout(landed.status, [wrong]).state, "not closed");
    }
    assert.equal(closureReadout({ ...landed.status, ticketSelection: null }, [record]).state, "not closed");
    assert.equal(closureReadout(landed.status, [record]).state, "closed");
    assert.equal(closureReadout(landed.status, [syntheticClosure(record.candidateSha, true)]).state, "open by the owner's choice");
  } finally { world.close(); }
});

async function snapshot(root: string): Promise<unknown[]> {
  const items: unknown[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      const info = await stat(path);
      items.push([path, info.mode, info.mtimeMs, info.size, info.isDirectory() ? null : (await readFile(path)).toString("hex")]);
      if (info.isDirectory()) await walk(path);
    }
  }
  await walk(root);
  return items;
}

for (const shape of ["not closed", "prepared only", "closed", "open by the owner's choice"] as const) {
  test(`status, JSON, next and doctor read ${shape} without changing any journal, checkout or state byte`, async () => {
    const world = box();
    try {
      const landed = await selectedLanding(world, { shift: true });
      if (shape !== "not closed") await recordSyntheticClosure(landed.attemptDir,
        syntheticClosure(landed.status.candidateSha!, shape === "open by the owner's choice"), shape === "prepared only");
      const expected = shape === "prepared only" ? "not closed" : shape;
      const before = await snapshot(world.root);
      const json = await statusJson(landed.attemptDir);
      assert.equal(json.closure.state, expected);
      assert.ok((await statusCommand(landed.attemptDir)).some(line => line.startsWith(`Closure: ${expected} —`)));
      const close = (await nextCommand(landed.attemptDir)).model.steps.find(step => step.verb === "close");
      if (expected === "not closed") {
        assert.equal(close?.who, "owner");
        assert.equal(close?.interactive, true);
        assert.equal(close?.spendsCalls, false);
        assert.deepEqual(close?.argv, ["awsf", "close", "selected-landing", "--project", world.config.project.slug, "--attempt", "1"]);
      } else assert.equal(close, undefined);
      const rows = await gatherRepositoryRows({ cwd: world.repository, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.config });
      assert.ok(rows.markers.detail.includes(`${world.config.project.slug}/selected-landing#1: ${expected}`));
      const out: string[] = [];
      const code = await main({ argv: ["status", "selected-landing", "--json", "--project", world.config.project.slug,
        "--state-root", world.stateRoot, "--config", world.configPath], cwd: world.repository, env: {}, writeOut: line => out.push(line), writeError: line => assert.fail(line) });
      assert.equal(code, 0);
      assert.equal(JSON.parse(out[0]!).closure.state, expected);
      assert.deepEqual(await snapshot(world.root), before);
    } finally { world.close(); }
  });
}

test("doctor reports all three closure states separately from current ticket markers", () => {
  const result = markersRow(["closed", "open by the owner's choice", "not closed"].map((closure, i) => ({
    attempt: `task#${i + 1}`, plan: "synthetic", tickets: [{ id: "T01", state: "todo" as const }],
    closure: closure as "closed" | "open by the owner's choice" | "not closed",
  })));
  assert.ok(result.detail.includes("closure: closed=1; open by the owner's choice=1; not closed=1"));
  assert.equal(result.status, "warn");
});

test("project owner-commit closure records count, but prepared evidence does not", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const record = syntheticClosure(landed.status.candidateSha!, true);
    await withProjectClosureJournal(projectDir(landed.attemptDir), { project: world.config.project.slug,
      repository: world.repository, operationKey: "synthetic" }, undefined, async (_rows, append) => {
      await append({ type: "closure-prepared", record });
    });
    assert.equal((await readClosure(landed.attemptDir, landed.status)).state, "not closed");
    await withProjectClosureJournal(projectDir(landed.attemptDir), { project: world.config.project.slug,
      repository: world.repository, operationKey: "synthetic" }, undefined, async (_rows, append) => {
      await append({ type: "closure-record", record });
    });
    assert.equal((await readClosure(landed.attemptDir, landed.status)).state, "open by the owner's choice");
    assert.deepEqual(evaluateClosure(await gatherLandingClosures(world.stateRoot, world.config.project.slug)), { passed: true });
  } finally { world.close(); }
});

test("inventory uses the first landing time, includes earlier attempts, and ignores other projects", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world, { at: CLOSURE_CUT });
    await recordSyntheticClosure(landed.attemptDir, syntheticClosure(landed.status.candidateSha!));
    await selectedLanding(world, { project: "other-project", taskId: "other" });
    const facts = await gatherLandingClosures(world.stateRoot, world.config.project.slug);
    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.landedAt, CLOSURE_CUT, "later closure activity must not move the cut comparison");
    assert.deepEqual(evaluateClosure(facts), { passed: true });
    // A newer CANCELLED attempt cannot hide the landed predecessor.
    const newerDir = join(landed.attemptDir, "..", "2");
    await mkdir(newerDir);
    const newer = { ...landed.status, attempt: 2, lifecycleState: "CANCELLED", revision: 1, lastSourceSeq: 1 };
    await writeFile(join(newerDir, "journal.jsonl"), `${JSON.stringify({ source_seq: 1, recorded_at: "2026-10-10T00:00:00Z", event: { kind: "attempt.created", next: newer } })}\n`);
    await writeFile(join(newerDir, "status.json"), JSON.stringify(newer));
    assert.equal((await gatherLandingClosures(world.stateRoot, world.config.project.slug)).length, 1);
  } finally { world.close(); }
});

test("preflight records a closure refusal; an owner record leaving rows open clears it at start without measuring again", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const next = await draft(world);
    const measured = await preflightCommand({ attemptDir: next.attemptDir, stateRoot: world.stateRoot, worktreeRoot: world.worktreeRoot,
      configPath: world.configPath, where: ["core/src/example.ts"], read: [], consulted: [] });
    assert.equal(measured.record.fields.find(field => field.id === "closure")?.passed, false);
    await prepare(world, next.attemptDir);
    await assert.rejects(start(world, next.attemptDir), StartPreflightRefused);
    await recordSyntheticClosure(landed.attemptDir, syntheticClosure(landed.status.candidateSha!, true));
    assert.equal((await start(world, next.attemptDir)).lifecycleState, "PREPARED");
  } finally { world.close(); }
});

for (const workflow of ["intake", "prove"] as const) {
  test(`${workflow}'s historical K1 exemption cannot skip closure`, async () => {
    const world = box();
    try {
      await selectedLanding(world);
      const next = await newCommand({ stateRoot: world.stateRoot, repository: world.repository, project: world.config.project.slug,
        taskId: "next", workflow: "build-review", tier: 2, request: "exempt request", configSnapshotJson: toConfigSnapshotJson(world.config) });
      await persistAttempt(next.attemptDir, next.status.revision, { kind: "attempt.updated", next: nextRevision(next.status, { workflow }) });
      await assert.rejects(startCommand({ attemptDir: next.attemptDir, configPath: world.configPath, worktreeRoot: world.worktreeRoot }),
        error => error instanceof StartPreflightRefused && error.field === "closure");
      assert.equal((await readAttempt(next.attemptDir)).lifecycleState, "DRAFT");
    } finally { world.close(); }
  });
}

test("next never infers close from planRef or task id, and never offers it outside LANDED", async () => {
  const world = box();
  try {
    const unmapped = await selectedLanding(world, { selected: false });
    assert.equal((await nextCommand(unmapped.attemptDir)).model.steps.some(step => step.verb === "close"), false);
    const created = await draft(world);
    assert.equal((await nextCommand(created.attemptDir)).model.steps.some(step => step.verb === "close"), false);
    const status = await readAttempt(created.attemptDir);
    await persistAttempt(created.attemptDir, status.revision, { kind: "attempt.updated", next: nextRevision(status, { lifecycleState: "AWAITING_OWNER" }) });
    assert.equal((await nextCommand(created.attemptDir)).model.steps.some(step => step.verb === "close"), false);
  } finally { world.close(); }
});

test("a torn selected landing journal refuses inventory instead of silently skipping closure", async () => {
  const world = box();
  try {
    const landed = await selectedLanding(world);
    const path = join(landed.attemptDir, "journal.jsonl");
    const text = await readFile(path, "utf8");
    await writeFile(path, text.slice(0, -1));
    await assert.rejects(gatherLandingClosures(world.stateRoot, world.config.project.slug), /torn attempt journal/u);
  } finally { world.close(); }
});
