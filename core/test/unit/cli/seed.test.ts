import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seedCommand } from "../../../src/cli/commands/seed.ts";
import { main } from "../../../src/cli/main.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { CandidateSeedRejected, completedShift, inspectSeedSource, readVerifiedAttempt, verifiedTargetSeed } from "../../../src/workflow/candidate-seed.ts";
import { assertCandidateSeed } from "../../../src/contracts/candidate-seed.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { seedFixture, git } from "../../fixtures/seeded-continuation.ts";

for (const variant of ["accepted", "wrong-phase", "wrong-round", "not-succeeded"] as const) {
  test(`seed recognizes atomic builder completion: ${variant}`, async () => {
    const world = await seedFixture();
    const path = join(world.sourceDir, "journal.jsonl");
    const records = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const row = records.find(record => record.event.evidence?.type === "phase");
    const phase = row.event.evidence.phase;
    row.event.evidence = { type: "phase-accepted", phase, accepted: {
      phaseKey: variant === "wrong-phase" ? "another-builder" : phase.key, ordinal: phase.ordinal,
      envelopeId: "accepted-builder", envelopeDigest: "a".repeat(64), round: variant === "wrong-round" ? 1 : phase.correctionCount,
      candidateSha: world.candidateSha,
    } };
    if (variant === "not-succeeded") phase.status = "VALIDATING";
    writeFileSync(path, records.map(record => JSON.stringify(record)).join("\n") + "\n");
    const before = readFileSync(path);
    if (variant === "accepted") {
      const result = await seedCommand({ ...world.seedOptions, quiescence: () => "quiescent" });
      assert.equal(result.status?.seed?.seedCandidateSha, world.candidateSha);
      assert.equal(result.status?.budget.callsSpent, 0);
    } else await assert.rejects(seedCommand({ ...world.seedOptions, quiescence: () => "quiescent" }), /accepted builder binding/);
    assert.deepEqual(readFileSync(path), before);
  });
}

const absentTarget = (world: Awaited<ReturnType<typeof seedFixture>>) =>
  assert.equal(existsSync(join(world.stateRoot, "projects", world.config.project.slug, "tasks", "target")), false);

for (const [name, patch] of [
  ["noninteractive", { terminal: { interactive: false, write: () => {}, confirm: async () => true } }],
  ["same source and target", { targetTaskId: "source" }],
  ["zero attempt", { sourceAttempt: 0 }],
  ["fractional attempt", { sourceAttempt: 1.5 }],
  ["abbreviated SHA", { candidateSha: "abcdef0" }],
  ["branch selection", { candidateSha: "HEAD" }],
  ["arbitrary directory", { candidateSha: "/tmp/source" }],
  ["blank request", { request: "  " }],
  ["blank supplement", { instruction: "\n " }],
  ["oversized supplement", { instruction: "a".repeat(16_385) }],
  ["wrong project", { project: "different-project" }],
  ["non-T2 workflow", { workflow: "build" }],
] as const) {
  test(`seed refuses ${name} without target creation`, async () => {
    const world = await seedFixture();
    const before = readFileSync(join(world.sourceDir, "journal.jsonl"));
    await assert.rejects(seedCommand({ ...world.seedOptions, ...patch }));
    absentTarget(world);
    assert.deepEqual(readFileSync(join(world.sourceDir, "journal.jsonl")), before);
  });
}

for (const state of ["live", "unknown"] as const) {
  test(`seed refuses ${state} process state despite a settled status`, async () => {
    const world = await seedFixture();
    await assert.rejects(seedCommand({ ...world.seedOptions, quiescence: () => state }), /survivors are unknown/);
    absentTarget(world);
  });
}

for (const [name, options] of [["missing L7", { missingL7: true }], ["held calls", { unsettled: true }],
  ["protected inherited delta", { inherited: "core/src/policy/inherited.ts" }],
  ["inherited path outside target recipe", { inherited: "outside/feature.ts" }]] as const) {
  test(`seed refuses ${name}`, async () => {
    const world = await seedFixture(options);
    await assert.rejects(seedCommand(world.seedOptions));
    absentTarget(world);
  });
}

test("decline records nothing and preserves the exact source journal", async () => {
  const world = await seedFixture();
  const before = readFileSync(join(world.sourceDir, "journal.jsonl"));
  const result = await seedCommand({ ...world.seedOptions, terminal: { ...world.seedOptions.terminal, confirm: async () => false } });
  assert.equal(result.confirmed, false);
  absentTarget(world);
  assert.deepEqual(readFileSync(join(world.sourceDir, "journal.jsonl")), before);
});

test("source revision or bytes changed during confirmation refuse before target creation", async () => {
  const world = await seedFixture();
  await assert.rejects(seedCommand({ ...world.seedOptions, terminal: { ...world.seedOptions.terminal, confirm: async () => {
    const path = join(world.sourceDir, "journal.jsonl");
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    return true;
  } } }), /source journal changed/);
  absentTarget(world);
});

test("builder prompt changed during confirmation refuses before target creation", async () => {
  const world = await seedFixture();
  await assert.rejects(seedCommand({ ...world.seedOptions, terminal: { ...world.seedOptions.terminal, confirm: async () => {
    const path = join(world.root, "prompts/builder/user.md");
    writeFileSync(path, readFileSync(path, "utf8") + "\nchanged\n");
    return true;
  } } }), /builder prompt changed/);
  absentTarget(world);
});

test("stale source projection and a torn journal refuse read-only", async () => {
  const world = await seedFixture();
  const statusPath = join(world.sourceDir, "status.json");
  writeFileSync(statusPath, JSON.stringify({ ...world.source, candidateSha: world.baseSha }));
  await assert.rejects(seedCommand(world.seedOptions), /status does not equal/);
  writeFileSync(statusPath, JSON.stringify(world.source));
  const journalPath = join(world.sourceDir, "journal.jsonl");
  writeFileSync(journalPath, readFileSync(journalPath, "utf8").trimEnd());
  await assert.rejects(seedCommand(world.seedOptions), /torn tail/);
  absentTarget(world);
});

test("an unresolved source writer lock is not reclaimed", async () => {
  const world = await seedFixture();
  const lock = join(world.sourceDir, "attempt.lock");
  writeFileSync(lock, "unknown holder");
  await assert.rejects(seedCommand(world.seedOptions), /writer lock/);
  assert.equal(readFileSync(lock, "utf8"), "unknown holder");
});

test("absent PID alone cannot settle a retained RUNNING process record", async () => {
  const world = await seedFixture();
  const path = join(world.sourceDir, "journal.jsonl");
  const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  rows.find((row) => row.event.evidence?.type === "process").event.evidence.status = "RUNNING";
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await assert.rejects(seedCommand({ ...world.seedOptions, quiescence: () => "quiescent" }), /settlement/);
  absentTarget(world);
});

// The host records a provider turn whose stream failed or lost its terminal as
// FAILED with neither exit code nor signal. It settles on its end, its start
// identity and a quiescent census; an EXITED record without either does not.
for (const [name, patch, state, settles] of [
  ["a FAILED turn without exit status, quiescent", { status: "FAILED", exitCode: null }, "quiescent", true],
  ["a CANCELLED turn without exit status, quiescent", { status: "CANCELLED", exitCode: null }, "quiescent", true],
  ["a FAILED turn without exit status, live", { status: "FAILED", exitCode: null }, "live", false],
  ["a FAILED turn without exit status, unknown census", { status: "FAILED", exitCode: null }, "unknown", false],
  ["a FAILED turn without exit status that never ended", { status: "FAILED", exitCode: null, endedAt: null }, "quiescent", false],
  ["an EXITED turn without exit status", { status: "EXITED", exitCode: null }, "quiescent", false],
] as const) {
  test(`seed settlement: ${name} ${settles ? "settles" : "refuses"}`, async () => {
    const world = await seedFixture();
    const path = join(world.sourceDir, "journal.jsonl");
    const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    Object.assign(rows.find((row) => row.event.evidence?.type === "process").event.evidence, patch);
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const before = readFileSync(path);
    if (settles) assert.equal((await seedCommand({ ...world.seedOptions, quiescence: () => state })).confirmed, true);
    else {
      await assert.rejects(seedCommand({ ...world.seedOptions, quiescence: () => state }), /settlement\/survivors are unknown/);
      absentTarget(world);
    }
    assert.deepEqual(readFileSync(path), before);
  });
}

test("an L7 source with more recorded process calls than it spent refuses", async () => {
  const world = await seedFixture();
  const path = join(world.sourceDir, "journal.jsonl");
  const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  rows.at(-1).event.next.budget.callsSpent = 0;
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const statusPath = join(world.sourceDir, "status.json");
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  status.budget.callsSpent = 0;
  writeFileSync(statusPath, JSON.stringify(status));
  await assert.rejects(seedCommand({ ...world.seedOptions, quiescence: () => "quiescent" }), /missing completed builder or settled call evidence/);
  absentTarget(world);
});

test("exact L7 candidate mismatch refuses even with matching final status and journal", async () => {
  const world = await seedFixture();
  const path = join(world.sourceDir, "journal.jsonl");
  const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  rows.find((row) => row.event.evidence?.edgeId === "L7").event.next.candidateSha = world.baseSha;
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await assert.rejects(seedCommand(world.seedOptions), /L7 candidate binding/);
});

test("CANCELLED source is eligible and existing target is never reused", async () => {
  const world = await seedFixture({ sealed: "CANCELLED" });
  const first = await seedCommand(world.seedOptions);
  assert.equal(first.status?.seed?.source.lifecycle, "CANCELLED");
  const bytes = readFileSync(join(first.attemptDir!, "journal.jsonl"));
  await assert.rejects(seedCommand(world.seedOptions), /target already exists/);
  assert.deepEqual(readFileSync(join(first.attemptDir!, "journal.jsonl")), bytes);
});

test("projection failure leaves seed and amendment in the atomic target creation event", async () => {
  const world = await seedFixture();
  await assert.rejects(seedCommand({ ...world.seedOptions, instruction: "Retain inherited behavior.", projectRecord: () => { throw new Error("projection unavailable"); } }), /projection unavailable/);
  const dir = join(world.stateRoot, "projects", world.config.project.slug, "tasks", "target", "1");
  const read = await readVerifiedAttempt(dir);
  assert.equal(read.records.length, 1);
  assert.equal(read.records[0]?.event.evidence?.type, "candidate-seed");
  assert.equal(read.status.seed?.ownerAmendment?.text, "Retain inherited behavior.");
  assert.equal(read.status.worktree, null);
  assert.equal(read.status.budget.callsSpent, 0);
});

test("removed seed projection and assurance-transfer fields are rejected", async () => {
  const world = await seedFixture();
  const created = await seedCommand(world.seedOptions);
  assert.throws(() => assertCandidateSeed({ ...created.status!.seed, sourceApprovalsCopied: true }), /assurance-transfer/);
  const status = { ...created.status!, seed: null };
  writeFileSync(join(created.attemptDir!, "status.json"), JSON.stringify(status));
  await assert.rejects(verifiedTargetSeed(created.attemptDir!, status), /status does not equal/);
  await assert.rejects(startCommand({ attemptDir: created.attemptDir!, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) }));
  assert.equal(existsSync(join(world.root, "targets")), false);
});

test("startup refuses changed source provenance and never creates a target worktree", async () => {
  const world = await seedFixture();
  const created = await seedCommand(world.seedOptions);
  const path = join(world.sourceDir, "journal.jsonl");
  writeFileSync(path, readFileSync(path, "utf8") + "\n");
  await assert.rejects(startCommand({ attemptDir: created.attemptDir!, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) }), /provenance changed/);
  assert.equal(existsSync(join(world.root, "targets")), false);
});

test("source canonical advance refuses even if it equals the inherited candidate", async () => {
  const world = await seedFixture();
  git(world.repository, "merge", "--ff-only", world.candidateSha);
  await assert.rejects(seedCommand(world.seedOptions), /canonical HEAD moved/);
  absentTarget(world);
});

test("target recipe union admits documenter-owned inherited paths only in simple-sdlc", async () => {
  const world = await seedFixture({ inherited: "docs/inherited.md" });
  await assert.rejects(seedCommand(world.seedOptions), /writes_within_globs/);
  const created = await seedCommand({ ...world.seedOptions, workflow: "simple-sdlc" });
  assert.equal(created.status?.workflow, "simple-sdlc");
});

test("existing partial target directories are refused without cleanup", async () => {
  const world = await seedFixture();
  const root = join(world.stateRoot, "projects", world.config.project.slug, "tasks", "target");
  mkdirSync(root);
  writeFileSync(join(root, "retained.txt"), "keep");
  await assert.rejects(seedCommand(world.seedOptions), /target already exists/);
  assert.equal(readFileSync(join(root, "retained.txt"), "utf8"), "keep");
});

test("normal creation cannot turn an existing seeded task into an unseeded task", async () => {
  const world = await seedFixture();
  await seedCommand(world.seedOptions);
  await assert.rejects(newCommand({ stateRoot: world.stateRoot, project: world.config.project.slug, taskId: "target", repository: world.repository,
    request: "different", workflow: "build-review", tier: 2 }), /already has attempt/);
});

test("PREPARED validation refuses a moved seeded target HEAD before provider lookup", async () => {
  const world = await seedFixture();
  const created = await seedCommand(world.seedOptions);
  const prepared = await startCommand({ attemptDir: created.attemptDir!, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  git(prepared.worktree!, "checkout", "--detach", world.baseSha);
  let lookups = 0;
  const result = await runProductionCommand({ attemptDir: created.attemptDir!, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    infrastructure: { adapterFor: () => { lookups += 1; throw new Error("unexpected lookup"); } } });
  assert.equal(result.lifecycleState, "BLOCKED");
  assert.equal(lookups, 0);
  assert.equal((await readAttempt(created.attemptDir!)).budget.callsSpent, 0);
});

test("CLI seed creates only DRAFT and refuses transfer flags or duplicate selections", async () => {
  const world = await seedFixture();
  const output: string[] = [];
  const argv = ["seed", "target", "--from", "source", "--source-attempt", "1", "--sha", world.candidateSha,
    "--request", "implement the fresh target", "--config", world.configPath, "--state-root", world.stateRoot];
  const common = { cwd: world.repository, terminal: world.seedOptions.terminal, writeOut: (line: string) => { output.push(line); }, writeError: (line: string) => { output.push(line); } };
  assert.equal(await main({ ...common, argv: [...argv, "--source-approvals", "true"] }), 1);
  absentTarget(world);
  assert.equal(await main({ ...common, argv: [...argv, "--sha", world.baseSha] }), 1);
  absentTarget(world);
  assert.equal(await main({ ...common, argv }), 0);
  const status = await readAttempt(join(world.stateRoot, "projects", world.config.project.slug, "tasks", "target", "1"));
  assert.equal(status.lifecycleState, "DRAFT");
  assert.equal(status.budget.callsSpent, 0);
  assert.equal(status.worktree, null);
  assert.ok(output.some((line) => line.includes("seeded from exact candidate")));
});

test("seed CLI records repeatable target routes, and refuses duplicates and unreachable phases before creation", async () => {
  const world = await seedFixture();
  const argv = ["seed", "target", "--from", "source", "--source-attempt", "1", "--sha", world.candidateSha,
    "--request", "fresh target", "--config", world.configPath, "--state-root", world.stateRoot];
  const common = { cwd: world.repository, terminal: world.seedOptions.terminal, writeOut: () => {}, writeError: () => {} };
  const builder = "builder=codex/openai-codex/target-builder@high";
  const reviewer = "reviewer=claude/anthropic/target-reviewer@low";
  const before = readFileSync(join(world.sourceDir, "journal.jsonl"));
  assert.equal(await main({ ...common, argv: [...argv, "--route", builder, "--route", builder] }), 1);
  assert.equal(await main({ ...common, argv: [...argv, "--route", "documenter=@high"] }), 1);
  absentTarget(world);
  assert.equal(await main({ ...common, argv: [...argv, "--route", builder, `--route=${reviewer}`] }), 0);
  const target = await readAttempt(join(world.stateRoot, "projects", world.config.project.slug, "tasks", "target", "1"));
  assert.deepEqual(target.routeOverrides, {
    builder: { adapter: "codex", provider: "openai-codex", model: "target-builder", effort: "high" },
    reviewer: { adapter: "claude", provider: "anthropic", model: "target-reviewer", effort: "low" },
  });
  assert.deepEqual(readFileSync(join(world.sourceDir, "journal.jsonl")), before);
});

test("source selector cannot name a different task under the same directory", async () => {
  const world = await seedFixture();
  await assert.rejects(inspectSeedSource(world.sourceDir, world.repository, { project: world.config.project.slug, taskId: "other", attempt: 1, candidateSha: world.candidateSha }), /mismatch/);
});

/**
 * A sealed shift's status over three tickets committed at its base, after which
 * canonical HEAD rewrote T01, as a handoff does.
 */
function shiftSource(t01Tail: Uint8Array = new Uint8Array()): { root: string; status: AttemptStatus; baseSha: string; headSha: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-seed-shift-"));
  const plan = "fixture-seed-shift";
  git(tmpdir(), "init", "--quiet", "-b", "main", root);
  mkdirSync(join(root, "specs", "tickets", plan), { recursive: true });
  const tickets = ["T01", "T02", "T03"].map((id) => {
    const path = `specs/tickets/${plan}/${id}.md`;
    writeFileSync(join(root, path), Buffer.concat([Buffer.from(["---", `id: ${id}`, `title: "Ticket ${id}"`, "milestone: M1", "state: todo", "depends_on: []", "---",
      `# ${id} · Ticket ${id}`, "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```", `TASK ${id}.`, "```", ""].join("\n")),
      id === "T01" ? t01Tail : new Uint8Array()]));
    return { id, path, digest: ticketFileDigest(readFileSync(join(root, path))) };
  });
  git(root, "add", ".");
  git(root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: select a shift's tickets");
  const baseSha = git(root, "rev-parse", "HEAD");
  const t01 = join(root, tickets[0]!.path);
  writeFileSync(t01, readFileSync(t01, "utf8").replace("_Empty._", "T01 landed."));
  git(root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-am", "docs: hand T01's findings on");
  const status = { workflow: "shift", repository: root, baseSha, shift: sealShiftManifest({ plan, milestones: ["M1"], tickets }) } as unknown as AttemptStatus;
  return { root, status, baseSha, headSha: git(root, "rev-parse", "HEAD") };
}

const acceptedPhase = (phaseKey: string, candidateSha: string): AttemptEvidence =>
  ({ type: "phase-accepted", accepted: { phaseKey, candidateSha } }) as unknown as AttemptEvidence;
const seedRefusal = (detail: string) => new CandidateSeedRejected(detail);

test("a shift's completed prefix is its contiguous run of tickets whose gates accepted their own build, rebuilt from its base's ticket blobs", async () => {
  const { root, status, headSha } = shiftSource();
  const [a, b, c] = ["a", "b", "c"].map((digit) => digit.repeat(40)) as [string, string, string];
  try {
    const run = [acceptedPhase("t01-build", a), acceptedPhase("t01-tests", a), acceptedPhase("t02-build", b), acceptedPhase("t02-tests", b), acceptedPhase("t03-build", c)];
    const completed = await completedShift(status, run, seedRefusal);
    assert.equal(completed.candidateSha, b, "the commit of a ticket whose gates never accepted it is not the candidate");
    assert.deepEqual(completed.shift, { plan: "fixture-seed-shift", milestones: ["M1"], completedTickets: ["T01", "T02"], remainingTickets: ["T03"] });

    await assert.rejects(completedShift(status, [...run.slice(0, 3), acceptedPhase("t02-tests", a)], seedRefusal),
      (error: unknown) => error instanceof CandidateSeedRejected && /ticket T02's gates accepted a{40}, not its build's commit b{40}/u.test(error.message));
    // A later ticket's acceptance never extends a run its predecessor's gate phase did not reach.
    await assert.rejects(completedShift(status, [run[0]!, ...run.slice(2)], seedRefusal),
      (error: unknown) => error instanceof CandidateSeedRejected && /completed no ticket; partial work is never adopted/u.test(error.message));
    await assert.rejects(completedShift({ ...status, shift: null }, run, seedRefusal), /records no shift selection/u);
    await assert.rejects(completedShift({ ...status, baseSha: null }, run, seedRefusal), /records no base/u);
    // Read at HEAD rather than the recorded base, the rewritten T01 refuses by digest.
    await assert.rejects(completedShift({ ...status, baseSha: headSha }, run, seedRefusal), /ticket T01 changed since selection/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a ticket blob that is not UTF-8 refuses by digest rather than binding other bytes", async () => {
  const { root, status } = shiftSource(Uint8Array.from([0xff, 0xfe, 0x0a]));
  try {
    const run = [acceptedPhase("t01-build", "a".repeat(40)), acceptedPhase("t01-tests", "a".repeat(40))];
    await assert.rejects(completedShift(status, run, seedRefusal),
      (error: unknown) => error instanceof CandidateSeedRejected && /cannot be rebuilt from its recorded selection at its base: ticket T01 changed since selection/u.test(error.message));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
