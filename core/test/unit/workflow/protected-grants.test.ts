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
import { assertProtectedExecutionProof, prepareProtectedConsumption, readProtectedState } from "../../../src/workflow/protected-grants.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { ProcessTransportBroker, resolveExecutable, runSystemCommand } from "../../../src/execution/transport-broker.ts";
import type { BarrierRecord } from "../../../src/execution/launcher-barrier.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { evaluatePathPolicy } from "../../../src/policy/path-policy.ts";
import { openPermissionSession } from "../../../src/policy/sandbox-broker.ts";
import { noProtectedPaths } from "../../../src/gates/git-diff.ts";

const target = "core/src/policy/example.ts";
const other = "core/src/policy/other.ts";
async function fixture(reservationId = "fixture-operation:1") {
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
  const operationId = "fixture-operation";
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

async function brokerExecutionProof(world: Awaited<ReturnType<typeof fixture>>) {
  const budget = new CallBudget({ taskId: "protected-local-proof", tier: 1 });
  const reservation = budget.reserve({ cost: 1 });
  assert.equal(reservation.id, world.consumption.reservationId);
  const phaseId = `${world.status.sessionId}:builder`;
  let status = world.status;
  const persist = async (evidence: AttemptEvidence) => {
    status = await persistAttempt(world.attemptDir, status.revision, { kind: "attempt.updated",
      next: nextRevision(status, { budget: budget.snapshot() }), evidence });
  };
  // Real sandbox descriptor, real broker resolution/barrier/spend, and a local
  // /usr/bin/true payload. No provider call or fabricated enforcement/success.
  mkdirSync(world.request.sessionRuntime, { recursive: true });
  const grant = openPermissionSession({ ...world.request,
    sandboxProbe: executable => runSystemCommand(executable, ["--version"], 5_000).status === 0,
  }).sandbox({ executable: "/usr/bin/true", argv: [], cwd: world.worktree,
    env: { PATH: process.env["PATH"] ?? "" }, stdin: "", shell: false });
  await persist({ type: "agent-start", phaseId, agent: "builder", adapterId: "local-proof", provider: "local",
    color: null, requestedModel: "none", sandboxBadge: grant.badge, sandboxMechanism: grant.mechanism,
    at: new Date().toISOString() });
  let record: BarrierRecord | undefined;
  const registeredAt = new Date().toISOString();
  let releasedAt: string | null = null;
  const processEvidence = (value: BarrierRecord, state: "REGISTERED" | "RUNNING"): Extract<AttemptEvidence, { type: "process" }> => ({
    type: "process", phaseId, adapterId: "local-proof", role: "builder", record: value, status: state,
    registeredAt, releasedAt, endedAt: null, exitCode: null, exitSignal: null,
  });
  const broker = new ProcessTransportBroker({ ledger: budget,
    phaseLaunchVerifier: { verify: registration => ({ ...registration, taskState: "RUNNING", phaseKind: "agent", launchAuthorization: "agent-phase" }) },
    register: async value => { record = value; await persist(processEvidence(value, "REGISTERED")); },
    onSpent: async value => {
      assert.equal(budget.reservation(value.reservationId)?.state, "spent");
      releasedAt = new Date().toISOString();
      await persist(processEvidence(value, "RUNNING"));
    },
  });
  const transport = await broker.startProcess({ kind: "agent-phase", runId: "local-bwrap-proof", taskSessionId: status.sessionId,
    workflowId: "local-proof", phaseId: "builder", phaseOrdinal: world.consumption.phaseOrdinal,
    reservationId: reservation.id, adapterId: "local-proof", role: "builder" }, grant.spec, new AbortController().signal);
  const drain = async (stream: AsyncIterable<Uint8Array>) => { for await (const _chunk of stream) { /* drain local output */ } };
  try {
    const [exit] = await Promise.all([transport.exit, drain(transport.stdout), drain(transport.stderr)]);
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.ok(record);
    await persist({ ...processEvidence(record, "RUNNING"), type: "process", status: "EXITED",
      endedAt: new Date().toISOString(), exitCode: exit.code, exitSignal: exit.signal });
    assert.equal(budget.callsSpent, 1);
    assert.equal(budget.callsReserved, 0);
    return readProtectedState(world.attemptDir);
  } finally { await transport.cancel("local execution proof test cleanup"); }
}

for (const installation of ["host", "symlink deployment"] as const) {
  test(`A2 accepts durable ${installation} broker-resolved Linux bwrap proof and refuses altered evidence`, async t => {
    if (process.platform !== "linux" || runSystemCommand("bwrap", ["--ro-bind", "/", "/", "--unshare-all", "--share-net", "--", "/usr/bin/true"], 5_000).status !== 0) {
      t.skip("a working Linux bwrap is required for genuine broker execution evidence"); return;
    }
    const originalPath = process.env["PATH"];
    const hostBwrap = resolveExecutable("bwrap", { PATH: originalPath ?? "" });
    const world = await fixture("r1");
    try {
      if (installation === "symlink deployment") {
        const bin = join(world.root, "deployment"); mkdirSync(bin);
        symlinkSync(hostBwrap, join(bin, "bwrap"));
        process.env["PATH"] = `${bin}:${originalPath ?? ""}`;
      }
      const state = await brokerExecutionProof(world);
      const proofPath = resolveExecutable("bwrap", { PATH: process.env["PATH"] ?? "" });
      const retained = readFileSync(join(world.attemptDir, "journal.jsonl"));
      const processRows = state.records.filter(row => row.event.evidence?.type === "process");
      assert.equal(processRows.length, 3);
      for (const row of processRows) {
        assert.equal(row.event.evidence?.type === "process" && row.event.evidence.record.command[0], proofPath);
      }
      assert.notEqual(proofPath, "bwrap", "the regression must exercise the broker's resolved path, not a bare-name fixture");
      assert.doesNotThrow(() => assertProtectedExecutionProof(state, world.consumption));

      // Mutations affect in-memory copies only, never the durable execution facts.
      const reject = (name: string, mutate: (events: AttemptEvidence[]) => void) => {
        const copy = structuredClone(state);
        const events = copy.records.map(row => row.event.evidence).filter((value): value is AttemptEvidence => value !== undefined);
        mutate(events);
        assert.throws(() => assertProtectedExecutionProof(copy, world.consumption), /original spent OS-enforced execution proof/, name);
      };
      const completion = (events: AttemptEvidence[]) => events.findLast(value => value.type === "process") as Extract<AttemptEvidence, { type: "process" }>;
      const spent = (events: AttemptEvidence[]) => events.find(value => value.type === "process" && value.status === "RUNNING") as Extract<AttemptEvidence, { type: "process" }>;
      const launch = (events: AttemptEvidence[]) => events.find(value => value.type === "agent-start") as Extract<AttemptEvidence, { type: "agent-start" }>;
      // Readonly production contracts are intentionally corrupted through assign.
      for (const command of [[], ["bwrap"], ["./bwrap"], ["/nonexistent/bwrap"], ["/usr/bin/true"]]) {
        reject(`untrusted executable ${JSON.stringify(command)}`, events => {
          Object.assign(completion(events).record, { command }); Object.assign(spent(events).record, { command });
        });
      }
      const impostor = join(world.root, "impostor"); mkdirSync(impostor);
      const impostorBwrap = join(impostor, "bwrap"); writeFileSync(impostorBwrap, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      reject("a runnable basename impostor is not the host-resolved executable", events => {
        Object.assign(completion(events).record, { command: [impostorBwrap] }); Object.assign(spent(events).record, { command: [impostorBwrap] });
      });
      reject("completion executable differs from original spend", events => Object.assign(spent(events).record, { command: [impostorBwrap] }));
      reject("completion argv differs from original spend", events => Object.assign(completion(events).record, { command: [proofPath, "--version"] }));
      for (const field of ["reservationId", "runId"] as const) {
        for (const value of ["", "wrong"]) reject(`completion ${field} ${value}`, events => Object.assign(completion(events).record, { [field]: value }));
      }
      for (const runId of ["", undefined]) {
        reject("no run identity in either process record", events => {
          Object.assign(completion(events).record, { runId }); Object.assign(spent(events).record, { runId });
        });
      }
      reject("missing completion", events => Object.assign(completion(events), { type: "agent" }));
      reject("missing launch", events => Object.assign(launch(events), { type: "agent" }));
      reject("missing spent evidence", events => Object.assign(spent(events), { status: "REGISTERED" }));
      reject("wrong spent reservation", events => Object.assign(spent(events).record, { reservationId: "wrong" }));
      reject("wrong spent run", events => Object.assign(spent(events).record, { runId: "wrong" }));
      for (const releasedAt of [null, undefined, ""]) {
        reject("unreleased spend", events => Object.assign(spent(events), { releasedAt }));
      }
      for (const event of [completion, spent, launch]) {
        for (const phaseId of ["", "other:builder", `${world.status.sessionId}:other`]) {
          reject(`missing or wrong phase ${phaseId}`, events => Object.assign(event(events), { phaseId }));
        }
      }
      for (const patch of [{ endedAt: null }, { endedAt: undefined }, { endedAt: "" }, { exitCode: null }, { exitCode: undefined },
        { exitCode: 1 }, { exitSignal: "SIGTERM" }, { status: undefined }, { status: "FAILED" }, { status: "CANCELLED" }]) {
        reject(`unsuccessful completion ${JSON.stringify(patch)}`, events => Object.assign(completion(events), patch));
      }
      for (const patch of [{ sandboxBadge: "tool-policy" }, { sandboxBadge: "unavailable" }, { sandboxMechanism: "adapter-tool-policy" }, { sandboxMechanism: "none" }]) {
        reject(`non-bwrap enforcement ${JSON.stringify(patch)}`, events => Object.assign(launch(events), patch));
      }
      // Ambient PATH is NOT historical proof. A different current resolver result
      // (even a runnable impostor) or missing installation must refuse the retained
      // launch, without reinterpreting or rewriting its original command.
      const launchPath = process.env["PATH"];
      for (const path of [impostor, ""]) {
        process.env["PATH"] = path;
        assert.throws(() => assertProtectedExecutionProof(state, world.consumption), /original spent OS-enforced execution proof/);
      }
      process.env["PATH"] = launchPath;
      assert.doesNotThrow(() => assertProtectedExecutionProof(state, world.consumption));
      assert.deepEqual(readFileSync(join(world.attemptDir, "journal.jsonl")), retained);
    } finally {
      if (originalPath === undefined) delete process.env["PATH"]; else process.env["PATH"] = originalPath;
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}
