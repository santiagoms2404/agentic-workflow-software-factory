import assert from "node:assert/strict";
import { test } from "node:test";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { reworkCommand } from "../../src/cli/commands/rework.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { assertRefusedBeforeSpend, box, draft, OWNER, prepare, start, update, refusalAssertion } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

// G02: exactly the same effective-config comparison guards both owner rework
// and run. Use its PREPARED run-time half for INV-1; owner rework requires
// AWAITING_OWNER, which must not be fabricated as DRAFT/PREPARED in the helper.
test("TR-10 refusal assertion: changed configuration before L4", async () => {
  const world = box();
  const label = refusalAssertion("TR-10");
  try {
    const created = await draft(world);
    await prepare(world, created.attemptDir);
    const prepared = await start(world, created.attemptDir);
    const changed = structuredClone(world.config);
    changed.observability.poll_ms += 1;
    let failure: unknown;
    try {
      await runProductionCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot,
        config: changed, configPath: world.configPath, projectRecord: world.projection.project, infrastructure: world.infrastructure });
    } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    assertRefusedBeforeSpend({ id: "TR-10", expectedRefusal: "ProductionConfigSnapshotMismatch",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world });
    assert.deepEqual(status, prepared, `${label}: no attempt update`);
  } finally { world.close(); }
});

test("TR-10 refusal assertion: gotcha 2 owner rework retains its anchor", async () => {
  const world = box();
  const label = refusalAssertion("TR-10");
  try {
    const created = await draft(world);
    await prepare(world, created.attemptDir);
    const prepared = await start(world, created.attemptDir);
    // Synthetic owner-act anchor as in T01's replay. No provider output or
    // owner runtime data is imported, and no owner act is performed on AWSF.
    await update(world, created.attemptDir, { lifecycleState: "AWAITING_OWNER", candidateSha: prepared.baseSha });
    const before = await readAttempt(created.attemptDir);
    const changed = structuredClone(world.config);
    changed.observability.poll_ms += 1;
    let failure: unknown;
    try {
      await reworkCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot,
        config: changed, configPath: world.configPath, defect: "remove duplicate whitespace in core/src/example.ts",
        terminal: OWNER, infrastructure: world.infrastructure });
    } catch (error) { failure = error; }
    assert.equal(failure instanceof Error ? failure.name : null, "ProductionConfigSnapshotMismatch", `${label}: owner-act error`);
    assert.deepEqual(await readAttempt(created.attemptDir), before, `${label}: owner anchor unchanged`);
    assert.equal(before.budget.callsReserved, 0, `${label}: callsReserved`);
    assert.equal(before.budget.callsSpent, 0, `${label}: callsSpent`);
    assert.equal(world.calls.length, 0, `${label}: GO invocations`);
    assert.equal(world.adapters.reduce((sum, adapter) => sum + adapter.launches, 0), 0, `${label}: adapter invocations`);
  } finally { world.close(); }
});

ownMutant({ id: "TR-10", file: import.meta.filename });
