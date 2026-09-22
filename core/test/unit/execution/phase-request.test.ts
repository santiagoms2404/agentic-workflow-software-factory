import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { StubAdapter } from "../../../src/adapters/stub.ts";
import { isContinuityCapable } from "../../../src/adapters/interface.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { buildEffectiveConfig } from "../../../src/config/effective-config.ts";
import { ContinuityStore } from "../../../src/execution/continuity-store.ts";
import { buildPhaseRequest, openRetainedColdTurn, phasePersistenceEvidence, phasePersistenceMode, redactPhaseProcess } from "../../../src/execution/phase-request.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { writeSystemPromptFile } from "../../../src/adapters/system-prompt-file.ts";

const configPath = resolve(import.meta.dirname, "../../../..", "awsf.config.yaml");
const config = loadConfig(await readFile(configPath, "utf8"));

for (const configured of config.agents) {
  test(`${configured.name}: retention consent is separate from correction and uses the composed phase system prompt`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "awsf-phase-request-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const agent = structuredClone(configured);
    const adapter = agent.harness.adapter === "codex" ? new PiCodexAdapter() : new ClaudeCodeAdapter();
    const store = new ContinuityStore({ path: join(root, "continuity.json") });
    const prompts = await composePromptBundle({ configPath, agent });
    const systemPromptPath = await writeSystemPromptFile(prompts.systemPrompt, root);
    const input = { agent, prompt: "fixture input", systemPromptPath, cwd: root, env: { PATH: "fixture-path" } };
    const baseline = adapter.buildSpec(buildPhaseRequest(input));
    assert.equal(baseline.stdin, "fixture input");
    assert.ok(baseline.argv.includes(systemPromptPath));
    assert.equal(await readFile(systemPromptPath, "utf8"), prompts.systemPrompt);
    // The shipped configuration opts NO role into original-turn retention:
    // while no installed route supports continuation, retention is a privacy
    // and storage cost with nothing to redeem it. The retention mechanism
    // itself is still exercised below, under an explicit role-scoped opt-in.
    assert.equal(agent.harness.interrupted_turn, false);
    assert.equal(buildEffectiveConfig(config).agents.find((entry) => entry.name === agent.name)!.harness.interrupted_turn, false);
    assert.equal(phasePersistenceMode(agent, adapter), agent.name === "intake" ? "conversation-correction" : "ephemeral");
    agent.harness.interrupted_turn = true;
    assert.equal(agent.harness.continuity, agent.name === "intake" ? "same-session" : "none");
    if (agent.name === "intake") {
      assert.equal(phasePersistenceMode(agent, adapter), "conversation-correction");
      assert.equal(await openRetainedColdTurn({ agent, adapter, store, phaseKey: agent.name, round: 0, runtimeDir: root }), null);
      return;
    }
    assert.equal(phasePersistenceMode(agent, adapter), "interrupted-turn-retention");
    const first = await openRetainedColdTurn({ agent, adapter, store, phaseKey: agent.name, round: 0, runtimeDir: root });
    const second = await openRetainedColdTurn({ agent, adapter, store, phaseKey: agent.name, round: 1, runtimeDir: root });
    assert.ok(first !== null && second !== null);
    assert.notEqual(first.ref.providerSessionId, second.ref.providerSessionId);
    assert.throws(() => store.assertCorrectable(first.handle, { adapter: adapter.id,
      provider: (adapter.id === "claude-code" ? "anthropic" : "openai-codex"), model: agent.model }), /no completed turn/);
    const retained = adapter.buildSpec(buildPhaseRequest({ ...input, continuity: { ref: first.ref, turn: "open" } }));
    assert.ok(retained.argv.includes("--session-id"));
    assert.equal(retained.argv.includes("--resume"), false);
    assert.equal(retained.argv.includes("--no-session"), false);
    assert.equal(retained.argv.includes("--no-session-persistence"), false);
    assert.equal(retained.stdin, baseline.stdin);
    assert.deepEqual(retained.env, baseline.env);
    if (adapter.id === "pi-codex") {
      for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) assert.ok(retained.argv.includes(flag));
    }
    const evidence = phasePersistenceEvidence(agent, adapter, first.handle, retained, prompts.systemPrompt);
    assert.equal(evidence.rescue, "proof-unavailable");
    assert.equal(JSON.stringify(evidence).includes(first.ref.providerSessionId), false);
    const redacted = redactPhaseProcess({ identity: { pid: 1, pgid: 1, startIdentity: "fixture", startIdentitySource: "fixture" },
      runId: "fixture", edge: null, reservationId: "fixture:r1", command: [...retained.argv, `prefix/${first.ref.providerSessionId}/tail`], cwd: root }, store);
    assert.equal(JSON.stringify(redacted).includes(first.ref.providerSessionId), false);
    if (first.ref.storeDir !== null) assert.equal(JSON.stringify(redacted).includes(first.ref.storeDir), false);
    delete agent.harness.interrupted_turn;
    assert.equal(phasePersistenceMode(agent, adapter), "ephemeral");
    assert.equal(await openRetainedColdTurn({ agent, adapter, store, phaseKey: "disabled", round: 0, runtimeDir: root }), null);
    assert.deepEqual(adapter.buildSpec(buildPhaseRequest(input)), baseline);
    assert.equal(phasePersistenceEvidence(agent, adapter, null, baseline, prompts.systemPrompt).rescue, "continuity-not-enabled");
  });
}

for (const Adapter of [ClaudeCodeAdapter, PiCodexAdapter]) {
  for (const member of ["supportsSameSessionCorrection", "continuityStoreDir", "assertResumable", "assertSameSession"]) {
    test(`${Adapter.name}: missing ${member} refuses retention before creating a private record`, async t => {
      const root = await mkdtemp(join(tmpdir(), "awsf-missing-retention-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const adapter = new Adapter();
      Object.defineProperty(adapter, member, { value: member === "supportsSameSessionCorrection" ? false : undefined });
      // Opted in explicitly: this asserts the capability refusal, which only
      // arises once a role has asked for retention. The shipped config asks for
      // none, so taking the agent as-is would short-circuit to `ephemeral` and
      // the refusal under test would never be reached.
      const agent = { ...config.agents.find(candidate => candidate.name === "builder")!,
        harness: { ...config.agents.find(candidate => candidate.name === "builder")!.harness, interrupted_turn: true } };
      const path = join(root, "continuity.json");
      const store = new ContinuityStore({ path });
      assert.equal(isContinuityCapable(adapter), false);
      assert.equal(phasePersistenceMode(agent, adapter), "unavailable");
      await assert.rejects(openRetainedColdTurn({ agent, adapter, store, phaseKey: "builder", round: 0, runtimeDir: root }), /complete continuity transport/);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    });
  }
}

test("unsupported persistence remains explicit and cannot claim interrupted-turn proof", () => {
  const base = config.agents.find((entry) => entry.name === "builder")!;
  const agent = { ...base, harness: { ...base.harness, interrupted_turn: true } };
  assert.equal(phasePersistenceMode(agent, new StubAdapter({ providerPath: resolve(import.meta.dirname, "../../fixtures/providers/stub/stub-provider.mjs"), sideEffectPath: join(tmpdir(), "unused-phase-request-effect") })), "unavailable");
});
