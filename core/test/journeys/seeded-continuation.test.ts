import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { seedCommand } from "../../src/cli/commands/seed.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../src/cli/commands/attempt.ts";
import { retryCommand } from "../../src/cli/commands/retry.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { sha256 } from "../../src/contracts/owner-amendment.ts";
import { seedFixture, git, SeedAdapter, fakeSeedBroker, INHERITED, AUTHORED } from "../fixtures/seeded-continuation.ts";

async function buildTarget(instruction?: string) {
  const world = await seedFixture();
  const projection = createDashboardProjection(world.stateRoot);
  const sourceBytes = readFileSync(join(world.sourceDir, "journal.jsonl"));
  const created = await seedCommand({ ...world.seedOptions, ...(instruction === undefined ? {} : { instruction }), projectRecord: projection.project });
  assert.equal(created.confirmed, true);
  const dir = created.attemptDir!;
  const initial = created.status!;
  assert.equal(initial.lifecycleState, "DRAFT");
  assert.equal(initial.baseSha, world.baseSha);
  assert.equal(initial.candidateSha, null);
  assert.equal(initial.worktree, null);
  assert.equal(initial.budget.callsSpent, 0);
  assert.equal(initial.budget.callsReserved, 0);
  assert.equal(initial.gatesPass || initial.requiredReviewPresent || initial.journeyApproved || initial.protectedApprovalsValid, false);
  assert.equal(initial.landingApproval, null);
  const prepared = await startCommand({ attemptDir: dir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), world.candidateSha);
  assert.equal(prepared.baseSha, world.baseSha);
  const prompts: string[] = [];
  const result = await runProductionCommand({ attemptDir: dir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    projectRecord: projection.project, assertAdvancement: projection.assertAdvancement, assertLaunchProjection: projection.assertLaunchPermitted,
    infrastructure: { adapterFor: (_entry, id) => new SeedAdapter(id, prompts), createBroker: fakeSeedBroker, sandboxProbe: () => false } });
  assert.equal(result.lifecycleState, "AWAITING_OWNER", result.blocker?.detail);
  assert.equal(result.budget.callsSpent, 2);
  assert.notEqual(result.candidateSha, world.candidateSha);
  assert.equal(result.requiredReviewPresent, true);
  assert.equal(result.journeyApproved, false);
  assert.deepEqual(readFileSync(join(world.sourceDir, "journal.jsonl")), sourceBytes);
  assert.equal(git(world.repository, "rev-parse", "HEAD"), world.baseSha);
  return { ...world, projection, dir, result, prepared, prompts, initial };
}

test("8C builds from the seed, attributes only target edits, reviews the full diff, and earns fresh journey/landing", async () => {
  const world = await buildTarget("Check the inherited constant while implementing the new source.");
  try {
    const targetDiff = git(world.result.worktree!, "diff", "--name-only", `${world.candidateSha}..${world.result.candidateSha}`);
    assert.equal(targetDiff, AUTHORED);
    const reviewDiff = readFileSync(join(world.dir, "raw", `review-context-${world.result.candidateSha}.diff`), "utf8");
    assert.ok(reviewDiff.includes(INHERITED));
    assert.ok(reviewDiff.includes(AUTHORED));
    assert.equal(world.prompts.length, 2);
    assert.ok(world.prompts[0]!.includes("Host-measured seed attribution"));
    assert.ok(world.prompts[1]!.includes(INHERITED));
    assert.ok(world.prompts[1]!.includes(AUTHORED));
    assert.ok(world.prompts.every((prompt) => prompt.includes("Check the inherited constant")));
    assert.ok(world.prompts.every((prompt) => !prompt.includes("source intent never transfers")));
    const rows = readFileSync(join(world.dir, "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const delivery = rows.filter((row) => row.event.evidence?.type === "owner-amendment-delivery");
    assert.equal(delivery.length, 1);
    assert.equal(delivery[0].event.evidence.composedDigest, sha256(world.prompts[0]!));
    assert.equal(rows[0].event.evidence.seed.ownerAmendment.binding.sessionId, world.result.sessionId);
    assert.equal(world.initial.seed?.source.journalDigest, sha256(readFileSync(join(world.sourceDir, "journal.jsonl"), "utf8")));
    await assert.rejects(landCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal }), /journey/i);
    await journeyCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal, journeyId: "seed-target-journey",
      observedSha: world.result.candidateSha!, projectRecord: world.projection.project });
    const landed = await landCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal, projectRecord: world.projection.project });
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(git(world.repository, "rev-parse", "HEAD"), world.result.candidateSha);
  } finally { world.projection.close(); }
});

test("8C refuses a base advance that is still an ancestor of the final candidate", async () => {
  const world = await buildTarget();
  try {
    await journeyCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal, journeyId: "seed-base-journey", observedSha: world.result.candidateSha! });
    git(world.repository, "merge", "--ff-only", world.candidateSha);
    await assert.rejects(landCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal }), /requires canonical HEAD/);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), world.candidateSha);
    assert.equal((await readAttempt(world.dir)).lifecycleState, "AWAITING_OWNER");
  } finally { world.projection.close(); }
});

test("8C rechecks its base after LANDING persistence, before mutation", async () => {
  const world = await buildTarget();
  try {
    await journeyCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal, journeyId: "seed-race-journey", observedSha: world.result.candidateSha! });
    const result = await landCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal,
      afterLandingPersisted: () => { git(world.repository, "merge", "--ff-only", world.candidateSha); } });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.blocker?.code, "git-failure");
    assert.match(result.status.blocker?.detail ?? "", /seed-base-changed/);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), world.candidateSha);
  } finally { world.projection.close(); }
});

test("8C LANDING recovery accepts the already-approved final HEAD", async () => {
  const world = await buildTarget();
  try {
    await journeyCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal, journeyId: "seed-recovery-journey", observedSha: world.result.candidateSha! });
    await assert.rejects(landCommand({ attemptDir: world.dir, terminal: world.seedOptions.terminal,
      afterLandingPersisted: () => { git(world.repository, "merge", "--ff-only", world.result.candidateSha!); throw new Error("fixture crash after Git movement"); } }), /fixture crash/);
    const result = await landCommand({ attemptDir: world.dir, terminal: { interactive: false, write: () => {}, confirm: async () => { throw new Error("must not reconfirm"); } } });
    assert.equal(result.status.lifecycleState, "LANDED");
  } finally { world.projection.close(); }
});

test("8C rejects a substituted amendment at the actual adapter input before GO", async () => {
  const world = await seedFixture();
  const created = await seedCommand({ ...world.seedOptions, instruction: "Check the inherited constant." });
  const dir = created.attemptDir!;
  await startCommand({ attemptDir: dir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"), preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  let launches = 0;
  const result = await runProductionCommand({ attemptDir: dir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    infrastructure: { adapterFor: (_entry, id) => new SeedAdapter(id, [], { dropInstruction: true }),
      createBroker: (options) => { const broker = fakeSeedBroker(options); return { startProcess: async (...args) => { launches += 1; return broker.startProcess(...args); } }; }, sandboxProbe: () => false } });
  assert.equal(result.lifecycleState, "BLOCKED");
  assert.equal(launches, 0);
  assert.equal(result.budget.callsSpent, 0);
});

test("retry of a seeded target drops seed and amendment authority and prepares from canonical HEAD", async () => {
  const world = await seedFixture();
  const created = await seedCommand({ ...world.seedOptions, instruction: "Check the inherited constant." });
  const current = created.status!;
  await persistAttempt(created.attemptDir!, current.revision, { kind: "attempt.updated", next: nextRevision(current, { lifecycleState: "CANCELLED" }) });
  const retried = await retryCommand({ attemptDir: created.attemptDir!, stateRoot: world.stateRoot,
    configSnapshotJson: toConfigSnapshotJson(world.config), allowance: world.config.risk.correction_allowance });
  assert.equal(retried.status.seed, null);
  assert.equal(retried.status.baseSha, null);
  const prepared = await startCommand({ attemptDir: retried.attemptDir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), world.baseSha);
  assert.equal(existsSync(join(prepared.worktree!, INHERITED)), false);
});

test("simple-sdlc keeps inherited documentation outside builder/documenter claims and reviews all changes", async () => {
  const world = await seedFixture({ inherited: "docs/inherited.md" });
  const created = await seedCommand({ ...world.seedOptions, workflow: "simple-sdlc", instruction: "Preserve the inherited documentation." });
  const dir = created.attemptDir!;
  await startCommand({ attemptDir: dir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  const prompts: string[] = [];
  const result = await runProductionCommand({ attemptDir: dir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    infrastructure: { adapterFor: (_entry, id) => new SeedAdapter(id, prompts), createBroker: fakeSeedBroker, sandboxProbe: () => false } });
  assert.equal(result.lifecycleState, "AWAITING_OWNER", result.blocker?.detail);
  assert.equal(result.budget.callsSpent, 4);
  assert.equal(prompts.length, 4);
  assert.equal(prompts[0]!.includes("Preserve the inherited documentation."), false);
  assert.ok(prompts[1]!.includes("Preserve the inherited documentation."));
  const fullDiff = readFileSync(join(dir, "raw", `review-context-${result.candidateSha}.diff`), "utf8");
  for (const path of ["docs/inherited.md", "docs/target.md", AUTHORED]) assert.ok(fullDiff.includes(path));
  assert.deepEqual(git(result.worktree!, "diff", "--name-only", `${world.candidateSha}..${result.candidateSha}`).split("\n"), [AUTHORED, "docs/target.md"]);
});

test("source worktree dirty bytes are neither copied nor needed", async () => {
  const world = await seedFixture();
  writeFileSync(join(world.sourceTree, INHERITED), "uncommitted source bytes must not transfer\n");
  const before = readFileSync(join(world.sourceTree, INHERITED));
  const created = await seedCommand(world.seedOptions);
  const prepared = await startCommand({ attemptDir: created.attemptDir!, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  assert.equal(readFileSync(join(prepared.worktree!, INHERITED), "utf8"), "export const inherited = 1;\n");
  assert.deepEqual(readFileSync(join(world.sourceTree, INHERITED)), before);
});
