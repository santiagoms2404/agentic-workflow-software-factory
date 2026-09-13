import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { seedCommand } from "../../../src/cli/commands/seed.ts";
import { main } from "../../../src/cli/main.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { inspectSeedSource, readVerifiedAttempt, verifiedTargetSeed } from "../../../src/workflow/candidate-seed.ts";
import { assertCandidateSeed } from "../../../src/contracts/candidate-seed.ts";
import { seedFixture, git } from "../../fixtures/seeded-continuation.ts";

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

test("source selector cannot name a different task under the same directory", async () => {
  const world = await seedFixture();
  await assert.rejects(inspectSeedSource(world.sourceDir, world.repository, { project: world.config.project.slug, taskId: "other", attempt: 1, candidateSha: world.candidateSha }), /mismatch/);
});
