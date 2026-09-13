import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../../src/config/load.ts";
import { renderProductionRolePrompt } from "../../../src/cli/commands/production-run.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { continuityDigest } from "../../../src/contracts/interrupted-turn.ts";
import { prepareRoleProbe } from "../../live/support/phase-parity.ts";
import { createRoleFixture, snapshotRoleFixture } from "../../live/support/role-fixture.ts";

const configPath = resolve(import.meta.dirname, "../../../../awsf.config.yaml");
const config = loadConfig(await readFile(configPath, "utf8"));

for (const configured of config.agents) {
  test(`${configured.name}: external fixture uses the configured phase prompt, tools and retention descriptor without a provider launch`, async t => {
    const root = await mkdtemp(join(tmpdir(), "awsf-role-parity-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fixture = await createRoleFixture(root, configured.name, "fixture-challenge");
    const input = { config, configPath, workflow: fixture.workflow, role: configured.name,
      selection: "proof-low" as const, previous: fixture.previous, designContext: fixture.designContext,
      recordedRequest: fixture.request, canonical: fixture.canonical, worktree: fixture.worktree,
      stateRoot: fixture.stateRoot, runtime: fixture.runtime, env: { ...fixture.env, OMIT_UNDEFINED: undefined } };
    const prepared = await prepareRoleProbe(input);
    const registration = prepared.registrationFor("fixture-run", "fixture-reservation", "fixture-session");
    assert.equal(registration.adapterId, configured.harness.adapter);
    if (["builder", "documenter", "architecture-reviewer"].includes(configured.name)) {
      assert.equal(registration.kind, "agent-phase");
      if (registration.kind === "agent-phase") {
        assert.equal(registration.phaseOrdinal, prepared.evidence.ordinal);
        assert.equal(registration.phaseId, prepared.phase.id);
      }
    } else {
      assert.notEqual(registration.kind, "agent-phase");
      if (registration.kind !== "agent-phase") assert.equal(registration.edge, configured.name === "reviewer" ? "L11" : "L4");
    }
    const prompts = await composePromptBundle({ configPath, agent: configured });
    assert.equal(await readFile(prepared.request.systemPromptPath!, "utf8"), prompts.systemPrompt);
    assert.equal(prepared.request.prompt, renderProductionRolePrompt(prepared.phase, fixture.previous, fixture.designContext, fixture.request, configured));
    assert.equal(prepared.request.prompt.includes(fixture.request), true);
    assert.deepEqual(prepared.request.tools, configured.tools.allow);
    assert.equal(prepared.request.profile, configured.tools.profile);
    assert.deepEqual(prepared.agent.writes, configured.writes);
    assert.equal(prepared.agent.harness.continuity, configured.harness.continuity);
    assert.equal(prepared.request.continuity?.turn, "open");
    assert.equal("OMIT_UNDEFINED" in prepared.request.env, false);
    assert.equal(prepared.evidence.releaseEligible, false);
    assert.equal(prepared.evidence.persistence.rescue, "proof-unavailable");
    assert.equal(prepared.evidence.configuredEffort, configured.thinking);
    assert.equal(prepared.evidence.selectedEffort, "low");
    assert.equal(prepared.evidence.configDigest, continuityDigest(config));
    assert.ok(prepared.grant.spec.argv.includes("--session-id"));
    assert.equal(prepared.grant.spec.argv.includes("--resume"), false);
    if (configured.harness.adapter === "codex") {
      for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
        assert.ok(prepared.grant.spec.argv.includes(flag));
      }
    }
    assert.deepEqual(prepared.permission.enforce().changedPaths, []);
    if (configured.name === "documenter") {
      assert.ok(prepared.request.prompt.includes(`Exact repository write boundary: ${configured.writes.join(", ")}`));
      assert.ok(prepared.request.prompt.includes("the host writes it outside the repository"));
    }
    if (configured.name === "architecture-reviewer") {
      assert.ok(prepared.request.prompt.includes(fixture.worktree));
      const { designContext: _removed, ...withoutContext } = input;
      await assert.rejects(prepareRoleProbe(withoutContext), /original host repository context/);
    }
    const before = await snapshotRoleFixture(fixture.worktree, fixture.gitControlPaths);
    await writeFile(join(fixture.worktree, "unexpected.txt"), "unlisted retained partial output");
    const changed = await snapshotRoleFixture(fixture.worktree, fixture.gitControlPaths);
    assert.notEqual(changed, before);
    assert.equal(await snapshotRoleFixture(fixture.worktree, fixture.gitControlPaths), changed);
    await symlink(join(root, "absent-outside-target"), join(fixture.worktree, "do-not-follow"));
    assert.notEqual(await snapshotRoleFixture(fixture.worktree, fixture.gitControlPaths), changed);
    const disabled = structuredClone(config);
    disabled.agents.find(agent => agent.name === configured.name)!.harness.interrupted_turn = false;
    await assert.rejects(prepareRoleProbe({ ...input, config: disabled }), /not opted into/);
  });
}
