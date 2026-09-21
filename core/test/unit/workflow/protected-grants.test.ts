import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { protectedGrantSubject } from "../../../src/cli/commands/production-run.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt } from "../../../src/cli/commands/attempt.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";
import { protectedFactDigest, type ProtectedGrant } from "../../../src/contracts/protected-grant.ts";
import { protectedExemptionAllows, verifyProtectedWrite, type ProtectedFilesCapability } from "../../../src/contracts/protected-capability.ts";
import { captureProtectedBaselines, protectedRootIdentity } from "../../../src/workflow/protected-files.ts";
import { prepareProtectedConsumption, readProtectedState } from "../../../src/workflow/protected-grants.ts";
import { evaluatePathPolicy } from "../../../src/policy/path-policy.ts";
import { openPermissionSession } from "../../../src/policy/sandbox-broker.ts";
import { noProtectedPaths } from "../../../src/gates/git-diff.ts";

const target = "core/src/policy/example.ts";
const other = "core/src/policy/other.ts";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awsf-grant-authority-"));
  const canonical = join(root, "canonical"); const worktree = join(root, "worktree"); const stateRoot = join(root, "state");
  mkdirSync(canonical); const git = systemGitRunner(canonical);
  runGit(git, ["init", "-b", "main"]); mkdirSync(join(canonical, "core/src/policy"), { recursive: true });
  writeFileSync(join(canonical, target), "export const original = true;\n"); writeFileSync(join(canonical, other), "unchanged\n");
  runGit(git, ["add", "."]);
  runGit(git, ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: initialize grant authority"]);
  const head = runGit(git, ["rev-parse", "HEAD"]).trim(); runGit(git, ["worktree", "add", "--detach", worktree, head]);
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: "protected-fixture", repository: canonical,
    request: "Edit exactly one source", workflow: "build", tier: 1, configSnapshotJson: JSON.stringify(config) });
  let status = await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.updated",
    next: nextRevision(created.status, { lifecycleState: "PREPARED", worktree, baseSha: head }) });
  const commonGitDir = join(canonical, ".git");
  const subject = { project: status.project, taskId: status.taskId, sessionId: status.sessionId, attempt: 1, repository: canonical,
    worktree, commonGitDir, worktreeGitDir: runGit(systemGitRunner(worktree), ["rev-parse", "--absolute-git-dir"]).trim(),
    roots: [canonical, commonGitDir, worktree, runGit(systemGitRunner(worktree), ["rev-parse", "--absolute-git-dir"]).trim()].map(protectedRootIdentity), integrationBaseSha: head,
    preWriteHeadSha: head, phaseKey: "builder", phaseOrdinal: 2, bindingDigest: "a".repeat(64) };
  const unsigned: ProtectedGrant = { schema: "awsf.protected-grant/v1", id: "fixture-grant", generationId: "fixture-generation", subject,
    files: captureProtectedBaselines(worktree, head, [target]), anchorRevision: status.revision,
    reason: "Exact test source", confirmedAt: "2026-09-20T00:00:00Z", digest: "" };
  const grant = { ...unsigned, digest: protectedFactDigest(unsigned) };
  status = await persistAttempt(created.attemptDir, status.revision, { kind: "attempt.updated", next: nextRevision(status, {}), evidence: { type: "protected-grant", grant } });
  const operationId = "fixture-operation"; const reservationId = "fixture-operation:1";
  const consumption = prepareProtectedConsumption(created.attemptDir, subject, operationId, reservationId)!;
  await assert.rejects(() => verifyProtectedWrite({ attemptDir: created.attemptDir, subject, operationId, reservationId }), /exact unused activation/,
    "preparing an unjournalled consumption cannot mint launch authority");
  status = await persistAttempt(created.attemptDir, status.revision, { kind: "attempt.updated",
    next: nextRevision(status, { lifecycleState: "RUNNING", activeOperation: operationId, budget: { ...status.budget, callsReserved: 1 } }),
    evidence: { type: "protected-activation", consumption, phase: { phaseId: `${status.sessionId}:builder`, key: "builder", name: "builder", ordinal: 2,
      kind: "agent", owner: "builder", description: "fixture", status: "RUNNING", correctionCount: 0, maxCorrections: 0, errorCode: null,
      errorMessage: null, startedAt: "2026-09-20T00:00:00Z", endedAt: null, createdAt: "2026-09-20T00:00:00Z" } } });
  const input = { attemptDir: created.attemptDir, subject, operationId, reservationId };
  const capability = await verifyProtectedWrite(input);
  const agent = config.agents.find(agent => agent.name === "builder")!;
  const request = { canonicalRepository: canonical, worktree, sessionRuntime: join(created.attemptDir, "private", "builder"), stateRoot,
    profile: agent.tools.profile, tools: agent.tools.allow, writes: agent.writes, protectedPaths: config.policy.protected_paths, sandboxProbe: () => true,
    protectedCapability: capability };
  return { root, worktree, canonical, config, status, input, capability, request, grant, consumption, attemptDir: created.attemptDir };
}

test("A2 authentic capability permits one exact protected file in permission and cumulative gate without enlarging writes", async () => {
  const world = await fixture();
  try {
    assert.throws(() => openPermissionSession({ ...world.request, writes: ["**"] }), /original role policy/);
    const permission = openPermissionSession(world.request);
    writeFileSync(join(world.worktree, target), "export const changed = true;\n");
    assert.deepEqual(permission.enforce().changedPaths, [target]);
    assert.equal(noProtectedPaths([target], world.request.protectedPaths, true, [world.capability]).passed, true);
    assert.equal(noProtectedPaths([other], world.request.protectedPaths, true, [world.capability]).passed, false);
    assert.equal(evaluatePathPolicy([target], { writes: [], protectedPaths: world.request.protectedPaths, protectedCapability: world.capability })[0]?.reasons.includes("outside-write-globs"), true);
    assert.equal(protectedExemptionAllows(world.capability, target.toUpperCase()), false);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

for (const fake of [{}, { paths: [target] }, new Set([target]), { protectedApprovalsValid: true }]) {
  test("A2 data-shaped exemptions leave no-grant permission and gate behavior unchanged", () => {
    const policy = { writes: ["core/src/**"], protectedPaths: ["core/src/policy/**"] };
    for (const paths of [[target], [other], ["core/src/plain.ts"], ["../outside"], [target.toUpperCase()]]) {
      assert.deepEqual(evaluatePathPolicy(paths, { ...policy, protectedCapability: fake as ProtectedFilesCapability }), evaluatePathPolicy(paths, policy));
      assert.equal(noProtectedPaths(paths, policy.protectedPaths, true, [fake as ProtectedFilesCapability]).passed, noProtectedPaths(paths, policy.protectedPaths).passed);
    }
  });
}

for (const mutation of ["hardlink", "symlink", "parent-symlink", "mode", "root", "rename", "ungranted"] as const) {
  test(`A2 granted output refuses ${mutation} without committing or changing the debit`, async () => {
    const world = await fixture();
    try {
      const permission = openPermissionSession(world.request);
      const before = readFileSync(join(world.attemptDir, "journal.jsonl"));
      if (mutation === "hardlink") linkSync(join(world.worktree, target), join(world.root, "external-alias"));
      if (mutation === "symlink") { renameSync(join(world.worktree, target), join(world.root, "original")); symlinkSync(join(world.root, "original"), join(world.worktree, target)); }
      if (mutation === "parent-symlink") { renameSync(join(world.worktree, "core/src/policy"), join(world.worktree, "core/src/moved")); symlinkSync("moved", join(world.worktree, "core/src/policy")); }
      if (mutation === "mode") chmodSync(join(world.worktree, target), 0o755);
      if (mutation === "root") chmodSync(join(world.canonical, ".git"), 0o700);
      if (mutation === "rename") renameSync(join(world.worktree, target), join(world.worktree, "core/src/policy/renamed.ts"));
      if (mutation === "ungranted") writeFileSync(join(world.worktree, other), "ungranted mutation\n");
      assert.throws(() => permission.enforce());
      assert.deepEqual(readFileSync(join(world.attemptDir, "journal.jsonl")), before);
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
}

test("A2 bootstrap cannot grant writes to the worktree implementing its running verifier", async () => {
  const world = await fixture();
  try {
    await assert.rejects(() => protectedGrantSubject({ config: world.config, configPath: resolve("awsf.config.yaml") },
      { ...world.status, worktree: resolve(".") }, "builder"), /bootstrap cannot authorize/);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("A2 consumed generations cannot be reissued, rebound to another reservation or cloned into authority", async () => {
  const world = await fixture();
  try {
    assert.throws(() => prepareProtectedConsumption(world.attemptDir, world.input.subject, "new-operation", "new-call"), /already consumed/);
    await assert.rejects(() => verifyProtectedWrite({ ...world.input, reservationId: "another-call" }), /exact unused activation/);
    await assert.rejects(() => verifyProtectedWrite({ ...world.input, operationId: "another-controller" }), /exact unused activation/);
    assert.equal(protectedExemptionAllows(JSON.parse(JSON.stringify(world.capability)), target), false);
    const path = join(world.attemptDir, "journal.jsonl");
    const rows = readFileSync(path, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    const event = rows.find(row => row.event.evidence?.type === "protected-grant").event.evidence;
    event.grant.generationId = "substituted-generation"; event.grant.digest = protectedFactDigest(event.grant);
    writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    assert.throws(() => readProtectedState(world.attemptDir), /binding mismatch/);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});
