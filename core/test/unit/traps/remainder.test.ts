import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { adoptCommand } from "../../../src/cli/commands/adopt.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { prepareBaselineWorktree } from "../../../src/preflight/baseline-worktree.ts";
import { box, git, OWNER } from "../../fixtures/trap-world.ts";
import { syntheticDonor } from "../../fixtures/trap-remainder.ts";
import { k1Request, prepareK1 } from "../../fixtures/k1-preflight.ts";

for (const scenario of ["malformed request", "missing confirmation"] as const) {
  test(`adoption K1 refuses ${scenario} on a measured fresh target before a tree or review`, async () => {
    const world = box();
    try {
      const donor = await syntheticDonor(world);
      const options = { sourceAttemptDir: donor.attemptDir, stateRoot: world.stateRoot, targetTaskId: "fresh-target",
        request: scenario === "malformed request" ? "one line" : k1Request("continue the donor", "core/src/**"),
        worktreeRoot: world.worktreeRoot, config: world.config, configPath: world.configPath, terminal: OWNER,
        projectRecord: world.projection.project, infrastructure: { ...world.infrastructure, pidIsLive: () => false } };
      await assert.rejects(adoptCommand(options), { name: "StartPreflightRefused", refusal: "no-record" });
      const attemptDir = join(world.stateRoot, "projects", world.config.project.slug, "tasks", "fresh-target", "1");
      const measured = await prepareK1({ attemptDir, configPath: world.configPath, worktreeRoot: world.worktreeRoot, confirm: false,
        projectRecord: world.projection.project });
      if (scenario === "malformed request") assert.equal(measured.record.fields.find(field => field.id === "request-shape")?.passed, false);
      await assert.rejects(adoptCommand(options), { name: "StartPreflightRefused", field:
        scenario === "malformed request" ? "write-boundary" : "confirmation" });
      const status = await readAttempt(attemptDir);
      assert.equal(status.lifecycleState, "DRAFT");
      assert.equal(status.worktree, null);
      assert.equal(status.budget.callsSpent, 0);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(world.calls.length, 0);
    } finally { world.close(); }
  });
}

test("an identical ignored seed permits baseline reuse; nested byte drift refuses without refreshing", async () => {
  const world = box();
  try {
    const seed = join(world.repository, "node_modules/nested");
    mkdirSync(seed, { recursive: true });
    writeFileSync(join(seed, "value.txt"), "original");
    const options = { repository: world.repository, root: world.worktreeRoot, project: world.config.project.slug,
      baseSha: git(world.repository, "rev-parse", "HEAD"), seedPaths: ["node_modules"], protectedPaths: world.config.policy.protected_paths };
    await prepareBaselineWorktree(options);
    assert.equal((await prepareBaselineWorktree(options)).created, false);
    writeFileSync(join(seed, "value.txt"), "changed");
    await assert.rejects(prepareBaselineWorktree(options), { name: "BaselineSeedStale" });
  } finally { world.close(); }
});
