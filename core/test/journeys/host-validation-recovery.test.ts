import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config/load.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import { parseEnvelope } from "../../src/contracts/parse-envelope.ts";
import { wrapEnvelope, type StoredEnvelope } from "../../src/contracts/stored-envelope.ts";
import type { HostCommitIntent, HostValidationProgress, HostValidationStage } from "../../src/contracts/host-validation.ts";
import { recoveryBudgetDigest, recoveryDigest, type PhaseRecovery } from "../../src/contracts/phase-recovery.ts";
import type { SavedPhaseResult } from "../../src/contracts/saved-phase-result.ts";
import { changesSinceBase, runGit, systemGitRunner } from "../../src/git/changes.ts";
import { HOST_AUTHOR, commitAsHost } from "../../src/git/commit.ts";
import { hostCommitContentDigest } from "../../src/git/commit-reconcile.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { persistAttempt, readAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../src/observability/attempt-evidence.ts";
import { inspectPhaseRecovery, verifyRecoveryWorktree } from "../../src/workflow/phase-recovery.ts";
import { savedResultTreeDigest } from "../../src/workflow/saved-phase-result.ts";

const PHASE = "builder";
const RUN_ID = "run-1";
const RESERVATION = "op-1:r1";
const MESSAGE = "feat: write the bounded source";
const AT = "2026-09-20T00:00:00.000Z";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/**
 * A disposable attempt and its own managed worktree, built by the real
 * `awsf new` and `awsf start`.
 *
 * Nothing here reads or writes a runtime attempt of this project. The crash
 * cuts below truncate and extend THIS journal, which is the only way to study
 * a cut without producing one in work somebody is relying on.
 */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-host-validation-recovery-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", "test: seed host validation recovery");
  // The shipped config seeds dependencies into every worktree. A disposable
  // fixture repository has none, and none is needed to study a journal cut.
  const configText = readFileSync(resolve("awsf.config.yaml"), "utf8").replace(/^\s*seed_paths:.*$/m, "  seed_paths: []");
  const config = loadConfig(configText);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: "fixture-host-validation",
    repository: canonical, request: "write one bounded source", workflow: "build", tier: 1,
    routeOverrides: {}, configSnapshotJson: JSON.stringify(config) });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  return { root, canonical, stateRoot, configPath, attemptDir: created.attemptDir,
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

const payload: BuildOutput = {
  schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote the bounded source",
  artifacts: [], notesForNextPhase: "", changedFiles: ["src/a.ts"], implementationNotes: ["one file"],
  commandsRun: [], proposedCommitMessage: MESSAGE,
};

function phaseRecord(status: AttemptStatus, state: string): PhaseEvidenceRecord {
  return { phaseId: `${status.sessionId}:${PHASE}`, ordinal: 1, key: PHASE, name: PHASE, kind: "agent",
    owner: PHASE, description: "build", status: state, correctionCount: 0, maxCorrections: 1,
    errorCode: null, errorMessage: null, startedAt: AT, endedAt: null, createdAt: AT };
}

async function append(attemptDir: string, patch: Partial<AttemptStatus>, evidence?: AttemptEvidence): Promise<AttemptStatus> {
  const current = await readAttempt(attemptDir);
  const next = { ...current, ...patch, revision: current.revision + 1, lastSourceSeq: current.lastSourceSeq + 1 };
  return persistAttempt(attemptDir, current.revision, { kind: "attempt.updated", next, ...(evidence === undefined ? {} : { evidence }) });
}

/**
 * Drive a disposable attempt to the exact instant the existing recovery already
 * understands: one complete reply, durably stored, with its original call
 * already spent and host validation not yet begun.
 */
async function savedReply(attemptDir: string) {
  const prepared = await readAttempt(attemptDir);
  const worktree = prepared.worktree!;
  const worktreeGit = systemGitRunner(worktree);
  await mkdir(dirname(join(worktree, "src/a.ts")), { recursive: true });
  writeFileSync(join(worktree, "src/a.ts"), "export const a = 1;\n");

  const parsed = parseEnvelope(JSON.stringify(payload), "awsf.build-output/v1");
  assert.ok(parsed.valid);
  const stored: StoredEnvelope<BuildOutput> = wrapEnvelope({
    envelopeId: `${prepared.sessionId}:${PHASE}:0`, sessionId: prepared.sessionId, phaseId: PHASE,
    correctionRound: 0, agent: PHASE, schemaId: "awsf.build-output/v1", createdAt: AT,
    rawOutputPath: `raw/${PHASE}-0.txt`,
  }, parsed) as StoredEnvelope<BuildOutput>;

  const budget = { ...prepared.budget, callsSpent: 1, callsReserved: 0 };
  const barrier = { identity: { pid: 4242, startedAt: AT, host: "fixture", user: "fixture" } as never, runId: RUN_ID,
    edge: "L4" as const, reservationId: RESERVATION, command: ["fixture"], cwd: worktree };

  await append(attemptDir, { budget }, { type: "agent-start", phaseId: `${prepared.sessionId}:${PHASE}`, agent: PHASE,
    adapterId: "claude-code", provider: "anthropic", color: null, requestedModel: "sonnet",
    sandboxBadge: "tool-policy", sandboxMechanism: "none", at: AT });
  await append(attemptDir, { budget }, { type: "process", phaseId: `${prepared.sessionId}:${PHASE}`, adapterId: "claude-code",
    role: PHASE, record: barrier, status: "RUNNING", registeredAt: AT, releasedAt: AT, endedAt: null, exitCode: null, exitSignal: null });
  await append(attemptDir, { budget }, { type: "process", phaseId: `${prepared.sessionId}:${PHASE}`, adapterId: "claude-code",
    role: PHASE, record: barrier, status: "EXITED", registeredAt: AT, releasedAt: AT, endedAt: AT, exitCode: 0, exitSignal: null });
  await append(attemptDir, { budget }, { type: "envelope", phaseId: `${prepared.sessionId}:${PHASE}`, envelope: stored });

  const pending: SavedPhaseResult = { phaseKey: PHASE, runId: RUN_ID, ordinal: 1, envelopeId: stored.envelopeId,
    envelopeDigest: recoveryDigest(stored), round: 0, worktreeDigest: await savedResultTreeDigest(worktree, worktreeGit),
    before: {}, sandboxBadge: "tool-policy",
    reservation: { id: RESERVATION, cost: 1, kind: "single", edge: "L4", attempt: prepared.attempt, state: "spent", spent: 1 },
    model: { adapter: "claude-code", provider: "anthropic", requestedModel: "sonnet", contextWindow: null,
      supportsThinking: false, supportsTools: true, supportsImages: false, continuity: "same-session-correction",
      usageAuthority: "provider", costAuthority: "unavailable" } };

  const checkpoint: PhaseRecovery = { schema: "awsf.phase-recovery/v1", id: randomUUID(), sessionId: prepared.sessionId,
    kind: "result-ready", pending, workflowId: "build", bindingDigest: "b".repeat(64), prefix: [],
    repository: await realpath(prepared.repository), worktree: await realpath(worktree),
    commonGitDir: await realpath(runGit(worktreeGit, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
    integrationBaseSha: prepared.baseSha!, worktreeHeadSha: runGit(worktreeGit, ["rev-parse", "HEAD"]).trim(),
    budgetDigest: recoveryBudgetDigest(budget), quota: null, createdAt: AT };

  const status = await append(attemptDir, { budget, recovery: checkpoint, phase: { name: PHASE, state: "VALIDATING", round: 0, maximumRounds: 1 } },
    { type: "phase-result-ready", phase: { ...phaseRecord(prepared, "VALIDATING") }, checkpoint });
  return { status, checkpoint, pending, worktree, worktreeGit, budget };
}

/** Exactly what the host records immediately before calling the commit transport. */
async function intentFor(worktree: string, worktreeGit: ReturnType<typeof systemGitRunner>): Promise<HostCommitIntent> {
  const parentSha = runGit(worktreeGit, ["rev-parse", "HEAD"]).trim();
  return { intentId: randomUUID(), phaseKey: PHASE, ordinal: 1, round: 0, runId: RUN_ID, parentSha,
    message: MESSAGE, author: HOST_AUTHOR, committer: HOST_AUTHOR, changedPaths: ["src/a.ts"],
    committedPaths: [...changesSinceBase(worktree, parentSha, worktreeGit)],
    contentDigest: await hostCommitContentDigest(worktree, parentSha, worktreeGit),
    treeDigest: await savedResultTreeDigest(worktree, worktreeGit) };
}

/** One durable stage advance, exactly as the integration seam would append it. */
async function advance(attemptDir: string, from: PhaseRecovery, progress: HostValidationProgress): Promise<{ status: AttemptStatus; checkpoint: PhaseRecovery }> {
  const checkpoint: PhaseRecovery = { ...from, id: randomUUID(), kind: "validating", validation: progress, createdAt: AT };
  const status = await append(attemptDir, { recovery: checkpoint },
    { type: "phase-validation-started", phaseId: `${from.sessionId}:${PHASE}`, checkpointId: from.id });
  return { status, checkpoint };
}

function progressAt(stage: HostValidationStage, resultCheckpointId: string, pending: SavedPhaseResult,
  commitIntent: HostCommitIntent | null = null, commitResult: HostValidationProgress["commitResult"] = null): HostValidationProgress {
  return { schema: "awsf.host-validation/v1", phaseKey: PHASE, ordinal: 1, round: pending.round, runId: RUN_ID,
    envelopeId: pending.envelopeId, envelopeDigest: pending.envelopeDigest, resultCheckpointId, stage, commitIntent, commitResult, protectedConsumptionId: null };
}

test("a cut inside read-only host validation replays the prefix without touching a byte", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    for (const stage of ["envelope-check", "gates", "permission-enforce", "capture-diff"] as const) {
      const advanced = await advance(fixture.attemptDir, saved.checkpoint, progressAt(stage, saved.checkpoint.id, saved.pending));
      const inspected = await inspectPhaseRecovery(fixture.attemptDir);
      assert.equal(inspected.checkpoint.validation?.stage, stage);
      const reconciliation = await verifyRecoveryWorktree(inspected.status, inspected.checkpoint);
      assert.deepEqual(reconciliation?.plan, { action: "replay", from: "envelope-check" });
      assert.equal(reconciliation?.commit, null);
      assert.equal(reconciliation?.candidateSha, null);
      assert.equal(git(saved.worktree, "rev-parse", "HEAD"), advanced.checkpoint.worktreeHeadSha);
    }
  } finally { fixture.dispose(); }
});

test("a cut at the commit with no commit object recognises that the transport never ran", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("commit", saved.checkpoint.id, saved.pending, intent));
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    const reconciliation = await verifyRecoveryWorktree(inspected.status, inspected.checkpoint);
    assert.equal(reconciliation?.plan.action, "reconcile-commit");
    assert.deepEqual(reconciliation?.commit, { outcome: "not-committed" });
    assert.equal(reconciliation?.candidateSha, null);
    assert.equal(git(saved.worktree, "rev-list", "--count", "HEAD"), "1");
    assert.equal(readFileSync(join(saved.worktree, "src/a.ts"), "utf8"), "export const a = 1;\n");
  } finally { fixture.dispose(); }
});

test("a cut between the commit and its durable result adopts the exact commit rather than repeating it", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("commit", saved.checkpoint.id, saved.pending, intent));
    // The crash falls here: the transport ran, its result never reached the journal.
    const commitSha = commitAsHost({ repository: saved.worktree, message: MESSAGE }, saved.worktreeGit);
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    const reconciliation = await verifyRecoveryWorktree(inspected.status, inspected.checkpoint);
    assert.deepEqual(reconciliation?.commit, { outcome: "committed", commitSha });
    assert.equal(reconciliation?.candidateSha, commitSha);
    assert.equal(git(saved.worktree, "rev-list", "--count", "HEAD"), "2");
    assert.equal(inspected.status.budget.callsSpent, 1, "the original debit is preserved and never doubled");
    assert.equal(inspected.status.budget.callsReserved, 0);
  } finally { fixture.dispose(); }
});

test("a cut inside the configured candidate commands refuses and keeps the candidate", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    const commitSha = commitAsHost({ repository: saved.worktree, message: MESSAGE }, saved.worktreeGit);
    const treeDigest = await savedResultTreeDigest(saved.worktree, saved.worktreeGit);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("verify-candidate", saved.checkpoint.id, saved.pending,
      intent, { intentId: intent.intentId, commitSha, treeDigest }));
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    await assert.rejects(verifyRecoveryWorktree(inspected.status, inspected.checkpoint), /no durable per-command result/);
    assert.equal(git(saved.worktree, "rev-parse", "HEAD"), commitSha);
    assert.equal(git(saved.worktree, "status", "--porcelain"), "");
  } finally { fixture.dispose(); }
});

test("a cut after every effectful step reconciles the recorded candidate and offers acceptance", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    const commitSha = commitAsHost({ repository: saved.worktree, message: MESSAGE }, saved.worktreeGit);
    const treeDigest = await savedResultTreeDigest(saved.worktree, saved.worktreeGit);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("accept", saved.checkpoint.id, saved.pending,
      intent, { intentId: intent.intentId, commitSha, treeDigest }));
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    const reconciliation = await verifyRecoveryWorktree(inspected.status, inspected.checkpoint);
    assert.equal(reconciliation?.plan.action, "reconcile-commit");
    assert.ok(reconciliation?.plan.action === "reconcile-commit");
    assert.equal(reconciliation.plan.resumeAt, "accept");
    assert.equal(reconciliation.candidateSha, commitSha);
    assert.equal(git(saved.worktree, "rev-list", "--count", "HEAD"), "2");
  } finally { fixture.dispose(); }
});

test("a durable commit result that disagrees with the repository refuses", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    const treeDigest = await savedResultTreeDigest(saved.worktree, saved.worktreeGit);
    // The journal claims a commit; the repository never made one.
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("accept", saved.checkpoint.id, saved.pending,
      intent, { intentId: intent.intentId, commitSha: "e".repeat(40), treeDigest }));
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    await assert.rejects(verifyRecoveryWorktree(inspected.status, inspected.checkpoint), /name different revisions/);
    assert.equal(git(saved.worktree, "rev-list", "--count", "HEAD"), "1");
    assert.equal(readFileSync(join(saved.worktree, "src/a.ts"), "utf8"), "export const a = 1;\n");
  } finally { fixture.dispose(); }
});

test("retained bytes that moved after a recorded commit refuse without cleaning the tree", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const intent = await intentFor(saved.worktree, saved.worktreeGit);
    const commitSha = commitAsHost({ repository: saved.worktree, message: MESSAGE }, saved.worktreeGit);
    const treeDigest = await savedResultTreeDigest(saved.worktree, saved.worktreeGit);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("accept", saved.checkpoint.id, saved.pending,
      intent, { intentId: intent.intentId, commitSha, treeDigest }));
    writeFileSync(join(saved.worktree, "stray.txt"), "written after the recorded commit\n");
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    await assert.rejects(verifyRecoveryWorktree(inspected.status, inspected.checkpoint), /worktree is not clean|bytes changed after the recorded commit/);
    assert.equal(readFileSync(join(saved.worktree, "stray.txt"), "utf8"), "written after the recorded commit\n");
    assert.equal(git(saved.worktree, "rev-parse", "HEAD"), commitSha);
  } finally { fixture.dispose(); }
});

test("retained bytes that moved during read-only validation refuse without resetting them", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("gates", saved.checkpoint.id, saved.pending));
    writeFileSync(join(saved.worktree, "src/a.ts"), "export const a = 99;\n");
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    await assert.rejects(verifyRecoveryWorktree(inspected.status, inspected.checkpoint), /worktree or index bytes changed/);
    assert.equal(readFileSync(join(saved.worktree, "src/a.ts"), "utf8"), "export const a = 99;\n");
  } finally { fixture.dispose(); }
});

test("a stage that no event ever announced is refused", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const progress = progressAt("gates", saved.checkpoint.id, saved.pending);
    const forged: PhaseRecovery = { ...saved.checkpoint, id: randomUUID(), kind: "validating", validation: progress, createdAt: AT };
    // The same checkpoint, installed by an ordinary update rather than by a
    // stage advance. A status field is not evidence of what the host reached.
    await append(fixture.attemptDir, { recovery: forged });
    await assert.rejects(inspectPhaseRecovery(fixture.attemptDir), /no durable advance evidence/);
  } finally { fixture.dispose(); }
});

test("a stage citing a result checkpoint the journal never proved is refused", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    await advance(fixture.attemptDir, saved.checkpoint, progressAt("gates", randomUUID(), saved.pending));
    await assert.rejects(inspectPhaseRecovery(fixture.attemptDir), /completion proof changed/);
  } finally { fixture.dispose(); }
});

test("a stage advance may not quietly move the accepted prefix, the pins or the debit", async () => {
  const mutations = [
    { name: "prefix", refusal: /frontier is inconsistent/ },
    { name: "head", refusal: /completion proof changed/ },
    { name: "budget", refusal: /active or unsettled execution/ },
    { name: "worktree", refusal: /belongs to another attempt or repository/ },
  ] as const;
  for (const mutation of mutations) {
    const fixture = await world();
    try {
      const saved = await savedReply(fixture.attemptDir);
      const tampered: PhaseRecovery = mutation.name === "prefix"
        ? { ...saved.checkpoint, prefix: [{ phaseKey: "request", ordinal: 1, envelopeId: "x", envelopeDigest: "c".repeat(64), round: 0, candidateSha: null }] }
        : mutation.name === "head" ? { ...saved.checkpoint, worktreeHeadSha: "d".repeat(40) }
        : mutation.name === "budget" ? { ...saved.checkpoint, budgetDigest: "e".repeat(64) }
        : { ...saved.checkpoint, worktree: join(saved.worktree, "elsewhere") };
      await advance(fixture.attemptDir, tampered, progressAt("gates", saved.checkpoint.id, saved.pending));
      await assert.rejects(inspectPhaseRecovery(fixture.attemptDir), mutation.refusal, mutation.name);
    } finally { fixture.dispose(); }
  }
});

test("a legacy cut that cleared the checkpoint still refuses rather than guessing what ran", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    await append(fixture.attemptDir, { recovery: null },
      { type: "phase-validation-started", phaseId: `${saved.status.sessionId}:${PHASE}`, checkpointId: saved.checkpoint.id });
    await assert.rejects(inspectPhaseRecovery(fixture.attemptDir), /no durable accepted-phase checkpoint/);
  } finally { fixture.dispose(); }
});

test("a superseded stage checkpoint cannot be replayed once a later stage is durable", async () => {
  const fixture = await world();
  try {
    const saved = await savedReply(fixture.attemptDir);
    const first = await advance(fixture.attemptDir, saved.checkpoint, progressAt("gates", saved.checkpoint.id, saved.pending));
    await advance(fixture.attemptDir, first.checkpoint, progressAt("capture-diff", saved.checkpoint.id, saved.pending));
    const inspected = await inspectPhaseRecovery(fixture.attemptDir);
    assert.equal(inspected.checkpoint.validation?.stage, "capture-diff");
    // Reinstate the earlier stage as current. It has since been cited by the
    // advance that superseded it, which is what makes it stale.
    await append(fixture.attemptDir, { recovery: first.checkpoint });
    await assert.rejects(inspectPhaseRecovery(fixture.attemptDir), /validation has started|no durable advance evidence/);
  } finally { fixture.dispose(); }
});
