import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { adoptCommand } from "../../src/cli/commands/adopt.ts";
import { readAttempt, nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import { grantCommand } from "../../src/cli/commands/grant.ts";
import { resumeProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readProtectedState } from "../../src/workflow/protected-grants.ts";
import { ContinuityStore } from "../../src/execution/continuity-store.ts";
import { continuityFilePath } from "../../src/persistence/platform-paths.ts";
import { prepareBaselineWorktree } from "../../src/preflight/baseline-worktree.ts";
import { k1Request, refusals } from "./k1-preflight.ts";
import { assertRefusedBeforeSpend, refusalAssertion } from "../traps/_harness.ts";
import { AT, OWNER, box, commit, draft, git, prepare, start } from "./trap-world.ts";

export async function baselineRefusal() {
  const world = box(config => { config.runtime.seed_paths = ["node_modules"]; });
  const label = refusalAssertion("TR-18");
  try {
    const seed = join(world.repository, "node_modules");
    mkdirSync(seed);
    writeFileSync(join(seed, "base-result.txt"), "green");
    const retained = await prepareBaselineWorktree({ repository: world.repository, root: world.worktreeRoot,
      project: world.config.project.slug, baseSha: git(world.repository, "rev-parse", "HEAD"), seedPaths: ["node_modules"],
      protectedPaths: world.config.policy.protected_paths });
    writeFileSync(join(seed, "base-result.txt"), "red");
    const created = await draft(world);
    let measurements = 0;
    await prepare(world, created.attemptDir, { runCommand: () => {
      measurements++;
      return { status: 0, stdout: "", stderr: "", error: null };
    } });
    let failure: unknown;
    try { await start(world, created.attemptDir); } catch (error) { failure = error; }
    assertRefusedBeforeSpend({ id: "TR-18", expectedRefusal: "awsf.preflight-refused/v1",
      observedRefusal: (await refusals(created.attemptDir)).at(-1)?.schema,
      status: await readAttempt(created.attemptDir), world, preparation: true });
    assert.ok(failure instanceof Error, label);
    const record = (await refusals(created.attemptDir)).at(-1)!;
    assert.equal(record.field, "suite", `${label}: suite`);
    assert.match(record.reason, /BaselineSeedStale/u, `${label}: stale seed`);
    assert.equal(measurements, 0, `${label}: no gate measured stale bytes`);
    assert.equal(readFileSync(join(retained.path, "node_modules/base-result.txt"), "utf8"), "green", label);
  } finally { world.close(); }
}

export async function laterGrantRefusal() {
  const world = box();
  const label = refusalAssertion("TR-20");
  try {
    const created = await draft(world, k1Request("build the module; only read docs/driving/example.md", "core/src/example.ts"), "simple-sdlc");
    await prepare(world, created.attemptDir, { read: ["docs/driving/example.md"] });
    await start(world, created.attemptDir);
    let failure: unknown;
    try { await grantCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot, config: world.config,
      configPath: world.configPath, phase: "documenter", files: ["docs/driving/example.md"],
      reason: "Synthetic later-phase scope", terminal: OWNER, sandboxProbe: () => true,
      projectRecord: world.projection.project }); } catch (error) { failure = error; }
    assertRefusedBeforeSpend({ id: "TR-20", expectedRefusal: "ProtectedGrantBoundaryRefused",
      observedRefusal: failure instanceof Error ? failure.name : null,
      status: await readAttempt(created.attemptDir), world });
    assert.equal(readProtectedState(created.attemptDir).grants.length, 0, `${label}: no grant recorded`);
  } finally { world.close(); }
}

export async function syntheticDonor(world: ReturnType<typeof box>) {
  const created = await draft(world, k1Request("make a synthetic donor", "core/src/example.ts"), "build-review");
  await prepare(world, created.attemptDir);
  const prepared = await start(world, created.attemptDir);
  mkdirSync(join(prepared.worktree!, "core/src"), { recursive: true });
  writeFileSync(join(prepared.worktree!, "core/src/example.ts"), "export const example = true;\n");
  const candidateSha = commit(prepared.worktree!, "test: synthetic donor candidate");
  const donor = await persistAttempt(created.attemptDir, prepared.revision, { kind: "attempt.updated",
    next: nextRevision(prepared, { candidateSha, gatesPass: true }), evidence: {
      type: "transition", id: "synthetic-l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host",
      edgeId: "L7", reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: AT,
    } }, world.projection.project);
  await persistAttempt(created.attemptDir, donor.revision, { kind: "attempt.updated", next: nextRevision(donor, {
    lifecycleState: "CANCELLED", blocker: { code: "phase-abort", detail: "synthetic sealed donor", source: "record", ahead: null, behind: null },
  }), evidence: {
    type: "agent", phaseId: `${prepared.sessionId}:builder`, agent: "builder", adapterId: "codex", provider: "openai-codex", color: null,
    requestedModel: "synthetic-model", resolvedModel: "synthetic-model", modelProvenance: "route-attributed", contextWindow: null,
    usageAuthority: "provider", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, reasoningRelation: "unknown" }, contextTokens: 2, costUsd: null, costAuthority: "unavailable", at: AT,
  } }, world.projection.project);
  return created;
}

export async function adoptionRefusal() {
  const world = box();
  const label = refusalAssertion("TR-19");
  try {
    const donor = await syntheticDonor(world);
    let failure: unknown;
    try { await adoptCommand({ sourceAttemptDir: donor.attemptDir, stateRoot: world.stateRoot,
      targetTaskId: "synthetic-target", request: "one line, deliberately not K1's four-line owner request",
      worktreeRoot: world.worktreeRoot, config: world.config, configPath: world.configPath, terminal: OWNER,
      projectRecord: world.projection.project, infrastructure: { ...world.infrastructure, pidIsLive: () => false } });
    } catch (error) { failure = error; }
    const targetDir = join(world.stateRoot, "projects", world.config.project.slug, "tasks", "synthetic-target", "1");
    // The donor is retained evidence, not the target's attempt tree.
    const status = await readAttempt(targetDir);
    assertRefusedBeforeSpend({ id: "TR-19", expectedRefusal: "StartPreflightRefused",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world });
    assert.equal(status.lifecycleState, "DRAFT", label);
    assert.equal(status.worktree, null, `${label}: no target tree`);
    assert.equal(existsSync(join(world.worktreeRoot, status.sessionId)), false, `${label}: no target tree on disk`);
    assert.equal((await refusals(targetDir)).at(-1)?.refusal, "no-record", label);
  } finally { world.close(); }
}

export async function continuityRefusal() {
  const world = box();
  const label = refusalAssertion("TR-11");
  try {
    const created = await draft(world);
    // A retained pre-GO locator, rebuilt synthetically. The store exists but
    // carries no matching session, the condition proved by the marked resume check.
    const storeDir = join(world.root, "synthetic-session-store");
    mkdirSync(storeDir);
    const store = new ContinuityStore({ path: continuityFilePath(created.attemptDir),
      newSessionId: () => "synthetic-unknown-session" });
    await store.open({ phaseId: "builder", adapter: "pi-codex", provider: "openai-codex",
      model: world.config.agents.find(agent => agent.name === "builder")!.model, storeDir });
    let failure: unknown;
    try { await resumeProductionCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot,
      config: world.config, configPath: world.configPath, reason: "inspect retained continuity", terminal: OWNER,
      projectRecord: world.projection.project, infrastructure: { ...world.infrastructure,
        adapterFor: () => new PiCodexAdapter() } }); } catch (error) { failure = error; }
    assertRefusedBeforeSpend({ id: "TR-11", expectedRefusal: "E_BACKEND_FAILURE",
      observedRefusal: failure instanceof Error && "code" in failure ? String(failure.code) : null,
      status: await readAttempt(created.attemptDir), world, preparation: true });
    assert.ok(failure instanceof Error, label);
    assert.match(failure.message, /no session in the host-owned store/u, label);
  } finally { world.close(); }
}
