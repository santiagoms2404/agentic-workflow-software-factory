import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { newCommand } from "../../src/cli/commands/new.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { StartPlacementRefused } from "../../src/cli/commands/start.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { placementFilePath } from "../../src/persistence/platform-paths.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { assertRefusedBeforeSpend, refusalAssertion } from "../traps/_harness.ts";
import { k1RequestFor } from "./k1-preflight.ts";
import { box, prepare, start } from "./trap-world.ts";

export async function placementRefusal(condition: "missing" | "unreadable" | "invalid" = "missing"): Promise<void> {
  const world = box(config => { config.risk.call_ceiling.T1 = 6; });
  const label = refusalAssertion("TR-17");
  try {
    const created = await newCommand({ stateRoot: world.stateRoot, project: world.config.project.slug,
      taskId: "synthetic-placement", repository: world.repository, workflow: "design-to-plan", tier: 1,
      request: k1RequestFor("design a synthetic plan", "design-to-plan", world.config.agents),
      callCeilings: { 0: 1, 1: 6, 2: 5 },
      configSnapshotJson: toConfigSnapshotJson(world.config), projectRecord: world.projection.project });
    await prepare(world, created.attemptDir);
    const path = placementFilePath(world.stateRoot, world.config.project.slug);
    if (condition === "unreadable") mkdirSync(path); // EISDIR, even when tests run as root.
    if (condition === "invalid") writeFileSync(path, "version: not-a-placement\n");
    const before = await readAttempt(created.attemptDir);
    let failure: unknown;
    try { await start(world, created.attemptDir); } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    assertRefusedBeforeSpend({ id: "TR-17", expectedRefusal: "StartPlacementRefused",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world, preparation: true });
    assert.ok(failure instanceof StartPlacementRefused, label);
    assert.match(failure.message, /placement\.yaml.*missing or unreadable/u, label);
    assert.deepEqual(status, before, `${label}: attempt unchanged`);
    if (condition === "missing" || condition === "invalid") {
      await writePlacement(world.stateRoot, world.config.project.slug, { version: "awsf.placement/v1",
        project: world.config.project.slug, repositories: { primary: { path: world.repository } } });
      assert.equal((await start(world, created.attemptDir)).lifecycleState, "PREPARED", `${label}: repaired input admits start`);
      assert.equal(world.calls.length, 0);
    }
  } finally { world.close(); }
}
