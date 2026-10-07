import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { resolveExecutable, runSystemCommand } from "../../../src/execution/transport-broker.ts";
import { readAttempt, nextRevision, persistAttempt } from "../../../src/cli/commands/attempt.ts";
import { StartPreflightRefused } from "../../../src/cli/commands/start.ts";
import { reworkCommand } from "../../../src/cli/commands/rework.ts";
import { grantCommand } from "../../../src/cli/commands/grant.ts";
import { adoptCommand } from "../../../src/cli/commands/adopt.ts";
import { readProtectedState } from "../../../src/workflow/protected-grants.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { baselineWorktreeName } from "../../../src/preflight/baseline-worktree.ts";
import { prepareBaselineWorktree } from "../../../src/preflight/baseline-worktree.ts";
import { SEEDS, type Seed } from "../../../src/traps/seeds.ts";
import { k1Request, refusals } from "../../fixtures/k1-preflight.ts";
import { AT, OWNER, ReplayStub, assertCalled, box, commit, draft, git, prepare, run, start, update, type Box } from "./fixture.ts";

async function assertNoCall(b: Box, attemptDir: string, lifecycleState = "DRAFT") {
  const status = await readAttempt(attemptDir);
  assert.equal(status.lifecycleState, lifecycleState);
  assert.equal(status.budget.callsReserved, 0);
  assert.equal(status.budget.callsSpent, 0);
  assert.equal(b.calls.length, 0);
  assert.equal(b.adapters.reduce((n, adapter) => n + adapter.launches, 0), 0);
  if (lifecycleState === "DRAFT") assert.equal(status.worktree, null);
}

async function k1(seed: Seed) {
  const b = box();
  try {
    const request = seed.replay === "protected-paths"
      ? k1Request("read core/src/execution/transport-broker.ts before deciding whether to change it", "core/src/example.ts")
      : k1Request("replay DrvFs mode storage", "core/src/example.ts");
    const created = await draft(b, request);
    await prepare(b, created.attemptDir);
    if (seed.replay === "git-storage") {
      const common = git(b.repository, "rev-parse", "--path-format=absolute", "--git-common-dir");
      for (const path of [join(common, "HEAD"), join(common, "config"), b.worktreeRoot]) chmodSync(path, 0o777);
    }
    await assert.rejects(start(b, created.attemptDir), StartPreflightRefused);
    const record = (await refusals(created.attemptDir)).at(-1)!;
    assert.equal(record.refusal, "field-failed");
    assert.equal(record.field, seed.replay);
    assert.match(record.reason, seed.replay === "protected-paths" ? /protected.*unclassified/u : /DrvFs/u);
    await assertNoCall(b, created.attemptDir);
    assert.ok(readdirSync(b.worktreeRoot).every(name => name.startsWith("awsf-baseline-")));
  } finally { b.close(); }
}

async function launch() {
  const b = box();
  try {
    // Exact availability behaviour from the real launch adapter; no live CLI,
    // credentials or owner's PATH are read. The execution half remains stubbed.
    const executable = "synthetic-missing-claude";
    const availability = new ClaudeCodeAdapter({ executable });
    assert.throws(() => resolveExecutable(executable, { PATH: b.root }), /ExecutableNotFound/u);
    assert.deepEqual(await availability.isAvailable(), { status: "available" });
    const created = await draft(b, k1Request("replay missing claude in the launch environment", "core/src/example.ts"), "simple-sdlc");
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    const status = await run(b, created.attemptDir, { ...b.infrastructure,
      adapterFor: (_entry, id) => {
        const adapter = new class extends ReplayStub {
          override isAvailable() { return availability.isAvailable(); }
          override buildSpec(request: Parameters<ReplayStub["buildSpec"]>[0]) {
            return { ...super.buildSpec(request), executable, env: { PATH: b.root } };
          }
        }(id);
        b.adapters.push(adapter);
        return adapter;
      } });
    assertCalled(b, status);
    assert.ok("edge" in b.calls[0]!);
    assert.equal(b.calls[0]!.edge, "L4");
    // KNOWN GAP T08: resolving this executable before L4 must replace today's GO.
  } finally { b.close(); }
}

async function quota() {
  const b = box(config => {
    config.routing.quota_stop = { default: { minutes: 30, probe_timeout_ms: 1000 } };
    const builder = config.agents.find(agent => agent.name === "builder")!;
    const planner = config.agents.find(agent => agent.name === "planner")!;
    builder.harness.adapter = "claude";
    builder.model = planner.model;
  });
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    let probes = 0;
    // Existing canned probe data is not owner runtime output. Make all windows
    // exhausted locally; the test's question is whether the FIRST GO checks it.
    const data = JSON.parse(readFileSync("core/test/fixtures/quota-axi/derived-exhausted-now.json", "utf8"));
    data.generatedAt = AT;
    // Reset is far away although usable allowance is already zero. Today's
    // threshold compares time-to-reset, not the exhausted percentage.
    for (const provider of data.providers) for (const window of provider.windows) window.resetsAt = "2026-10-08T12:00:00Z";
    const command: typeof runSystemCommand = (executable, argv) => {
      assert.equal(executable, "/synthetic/quota-axi");
      if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29", stderr: "", error: null };
      probes++;
      return { status: 0, stdout: JSON.stringify(data), stderr: "", error: null };
    };
    const status = await runProductionWithQuota(b, created.attemptDir, command);
    assertCalled(b, status);
    assert.equal(probes, 1, "the request-to-builder boundary probes but does not refuse exhausted allowance");
    const snapshots = (await readAttemptEvidence(created.attemptDir)).filter(entry => entry.type === "quota-snapshot");
    assert.ok(snapshots.some(entry => entry.type === "quota-snapshot" && entry.effectivePercentRemaining === 0));
    // KNOWN GAP T09: exhausted-at-start and configured threshold refuse before L4.
  } finally { b.close(); }
}
// Keep the infrastructure typed by the production API rather than widening the fixture seam.
async function runProductionWithQuota(b: Box, attemptDir: string, command: typeof runSystemCommand) {
  const { runProductionCommand } = await import("../../../src/cli/commands/production-run.ts");
  return runProductionCommand({ attemptDir, stateRoot: b.stateRoot, config: b.config, configPath: b.configPath,
    projectRecord: b.projection.project, infrastructure: { ...b.infrastructure,
      resolveExecutable: () => "/synthetic/quota-axi", runCommand: command } });
}

async function shift() {
  const b = box();
  try {
    const created = await draft(b, k1Request("run the selected ticket", "core/src/example.ts"), "shift", true);
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    const status = await run(b, created.attemptDir);
    assertCalled(b, status);
    const prompt = (await readAttemptEvidence(created.attemptDir)).find(entry => entry.type === "compiled-prompt" && entry.name === "user");
    assert.ok(prompt && prompt.type === "compiled-prompt");
    assert.match(prompt.text, /Write specs\/synthetic.html/u);
    // KNOWN GAP T10: the ticket's required plan write is outside the shift's
    // boundary although the outer request's Where passed K1.
  } finally { b.close(); }
}

test("S27 partial refusal: its original one-line request cannot prepare a shift", async () => {
  const b = box();
  try {
    const created = await draft(b, "Run the selected milestone and change its plan", "shift", true);
    const prepared = await prepare(b, created.attemptDir);
    assert.equal(prepared.record.fields.find(field => field.id === "request-shape")!.passed, false);
    await assert.rejects(start(b, created.attemptDir), StartPreflightRefused);
    assert.equal((await refusals(created.attemptDir)).at(-1)!.refusal, "field-failed");
    await assertNoCall(b, created.attemptDir);
  } finally { b.close(); }
});

async function interruptedStart() {
  const b = box();
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    // The untracked-directory half of the documented interruption. Create only
    // in this test root; no tree is cleared to make the real start succeed.
    const tree = join(b.worktreeRoot, created.status.sessionId);
    mkdirSync(tree);
    writeFileSync(join(tree, "retained.txt"), "interrupted seeding evidence\n");
    await assert.rejects(start(b, created.attemptDir), { name: "AttemptWorktreeExists" });
    assert.equal(readFileSync(join(tree, "retained.txt"), "utf8"), "interrupted seeding evidence\n");
    await assertNoCall(b, created.attemptDir);
  } finally { b.close(); }
}

async function continuity() {
  const b = box();
  try {
    const created = await draft(b);
    const store = join(b.root, "host-owned-session-store");
    mkdirSync(store);
    assert.throws(() => new PiCodexAdapter().assertResumable({ providerSessionId: "synthetic-unknown-session", storeDir: store },
      { cwd: b.repository }), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "E_BACKEND_FAILURE");
      assert.match(error.message, /no session in the host-owned store/u);
      return true;
    });
    await assertNoCall(b, created.attemptDir);
  } finally { b.close(); }
}

async function configuration() {
  const b = box();
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    const prepared = await start(b, created.attemptDir);
    await update(b, created.attemptDir, { lifecycleState: "AWAITING_OWNER", candidateSha: prepared.baseSha });
    const changed = structuredClone(b.config);
    changed.observability.poll_ms += 1;
    await assert.rejects(reworkCommand({ attemptDir: created.attemptDir, stateRoot: b.stateRoot,
      config: changed, configPath: b.configPath, defect: "remove duplicate whitespace in core/src/example.ts", terminal: OWNER,
      infrastructure: b.infrastructure }), { name: "ProductionConfigSnapshotMismatch" });
    await assertNoCall(b, created.attemptDir, "AWAITING_OWNER");
  } finally { b.close(); }
}

async function cwd() {
  const b = box();
  try {
    const created = await draft(b);
    assert.equal(created.status.repository, b.repository);
    await assertNoCall(b, created.attemptDir);
    // G07 is not a run-stopping fault. Caller intent about a different directory
    // is not machine evidence; no known-gap provider-call pin is claimed here.
  } finally { b.close(); }
}

async function baseline() {
  const b = box(config => { config.runtime.seed_paths = ["node_modules"]; });
  try {
    const seed = join(b.repository, "node_modules");
    mkdirSync(seed);
    writeFileSync(join(seed, "base-result.txt"), "green");
    const baseSha = git(b.repository, "rev-parse", "HEAD");
    const request = { repository: b.repository, root: b.worktreeRoot, project: b.config.project.slug, baseSha,
      seedPaths: ["node_modules"], protectedPaths: b.config.policy.protected_paths };
    await prepareBaselineWorktree(request);
    writeFileSync(join(seed, "base-result.txt"), "red");
    const kept = await prepareBaselineWorktree(request);
    assert.deepEqual(kept.seeded, []);
    assert.equal(readFileSync(join(kept.path, "node_modules/base-result.txt"), "utf8"), "green");
    assert.equal(readFileSync(join(seed, "base-result.txt"), "utf8"), "red");
    const created = await draft(b);
    let measurements = 0;
    await prepare(b, created.attemptDir, { runCommand: (_executable, _argv, options) => {
      measurements++;
      assert.ok(typeof options !== "number");
      assert.equal(options.cwd, join(b.worktreeRoot, baselineWorktreeName(b.config.project.slug)));
      const bytes = readFileSync(join(options.cwd, "node_modules/base-result.txt"), "utf8");
      return { status: bytes === "green" ? 0 : 1, stdout: "", stderr: "", error: null };
    } });
    assert.equal(measurements, 1);
    await start(b, created.attemptDir);
    assertCalled(b, await run(b, created.attemptDir));
    // KNOWN GAP T12: stale ignored seeds can falsely measure a passing base.
    // T14 reporting alone cannot turn this GO into a pre-spend refusal.
  } finally { b.close(); }
}

async function laterGrant() {
  const b = box();
  try {
    const created = await draft(b, k1Request("build the module; only read docs/driving/example.md", "core/src/example.ts"), "simple-sdlc");
    await prepare(b, created.attemptDir, { read: ["docs/driving/example.md"] });
    await start(b, created.attemptDir);
    const granted = await grantCommand({ attemptDir: created.attemptDir, stateRoot: b.stateRoot, config: b.config,
      configPath: b.configPath, phase: "documenter", files: ["docs/driving/example.md"],
      reason: "Synthetic later-phase scope", terminal: OWNER, sandboxProbe: () => true, projectRecord: b.projection.project });
    assert.equal(granted.confirmed, true);
    assert.equal(granted.status.lifecycleState, "PREPARED");
    assert.equal(granted.status.budget.callsReserved, 0);
    assert.equal(b.calls.length, 0);
    assert.equal(readProtectedState(created.attemptDir).grants[0]!.subject.phaseKey, "documenter");
    assertCalled(b, await run(b, created.attemptDir, { ...b.infrastructure, sandboxProbe: () => true }));
    assert.equal(readProtectedState(created.attemptDir).consumptions.length, 0, "the later grant was not consumed by the first phase");
    // KNOWN GAP T12: refuse a later-phase grant at PREPARED, not a live owner grant.
  } finally { b.close(); }
}

async function adoption() {
  const b = box();
  try {
    const created = await draft(b, k1Request("make a synthetic donor", "core/src/example.ts"), "build-review");
    await prepare(b, created.attemptDir);
    const prepared = await start(b, created.attemptDir);
    mkdirSync(join(prepared.worktree!, "core/src"), { recursive: true });
    writeFileSync(join(prepared.worktree!, "core/src/example.ts"), "export const example = true;\n");
    const candidateSha = commit(prepared.worktree!, "test: synthetic donor candidate");
    const phaseId = `${prepared.sessionId}:builder`;
    const completed = await persistAttempt(created.attemptDir, prepared.revision, { kind: "attempt.updated",
      next: nextRevision(prepared, { candidateSha, gatesPass: true }), evidence: {
        type: "transition", id: "synthetic-l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host",
        edgeId: "L7", reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: AT,
      } }, b.projection.project);
    const donor = completed;
    await persistAttempt(created.attemptDir, donor.revision, { kind: "attempt.updated", next: nextRevision(donor, {
      lifecycleState: "CANCELLED", blocker: { code: "phase-abort", detail: "synthetic sealed donor", source: "record", ahead: null, behind: null },
    }), evidence: {
      type: "agent", phaseId, agent: "builder", adapterId: "codex", provider: "openai-codex", color: null,
      requestedModel: "synthetic-model", resolvedModel: "synthetic-model", modelProvenance: "route-attributed", contextWindow: null,
      usageAuthority: "provider", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        reasoningTokens: 0, reasoningRelation: "unknown" }, contextTokens: 2, costUsd: null, costAuthority: "unavailable", at: AT,
    } }, b.projection.project);
    const adopted = await adoptCommand({ sourceAttemptDir: created.attemptDir, stateRoot: b.stateRoot,
      targetTaskId: "synthetic-target", request: "one line, deliberately not K1's four-line owner request",
      worktreeRoot: b.worktreeRoot, config: b.config, configPath: b.configPath, terminal: OWNER,
      projectRecord: b.projection.project, infrastructure: { ...b.infrastructure, pidIsLive: () => false } });
    assert.ok(adopted.status && adopted.attemptDir);
    assert.equal(b.calls.length, 2, "today mandatory review retries its unavailable stub once");
    assert.equal(adopted.status.budget.callsSpent, 2);
    assert.equal(adopted.status.budget.callsReserved, 0);
    assert.equal(b.adapters.reduce((count, adapter) => count + adapter.launches, 0), 2);
    assert.equal(adopted.status.blocker?.code, "review-unavailable");
    assert.equal((await readAttemptEvidence(adopted.attemptDir)).filter(entry => entry.type === "driver-preflight").length, 0);
    // KNOWN GAP T12: adoption's fresh target reaches a review without K1.
  } finally { b.close(); }
}

const REPLAYS: Record<string, (seed: Seed) => Promise<void>> = {
  "protected-paths": k1, "git-storage": k1, launch, quota, shift, configuration, continuity,
  "interrupted-start": interruptedStart, cwd, baseline, "later-grant": laterGrant, adoption,
};
for (const seed of SEEDS.filter(seed => seed.replay !== null)) {
  test(`${seed.id}: ${seed.outcome === "gap" ? `KNOWN GAP ${seed.pendingTask}` : seed.outcome} — ${seed.replay}`, async () => {
    const replay = REPLAYS[seed.replay!];
    assert.ok(replay, `missing replay for ${seed.id}`);
    await replay(seed);
  });
}

test("every refusal and gap has a registered replay; no accidental skipped or todo pin", () => {
  assert.equal(SEEDS.filter(seed => seed.outcome === "refused" || seed.outcome === "gap").length, 12);
  for (const seed of SEEDS) if (seed.outcome === "refused" || seed.outcome === "gap") assert.ok(seed.replay && REPLAYS[seed.replay], seed.id);
});
