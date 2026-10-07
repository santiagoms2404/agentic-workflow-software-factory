import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { assertRefusedBeforeSpend, box, draft, ReplayStub } from "../../traps/_harness.ts";

test("INV-1 helper accepts a named DRAFT refusal and bites on every spend/state/tree defect", async () => {
  const world = box();
  try {
    const created = await draft(world);
    const status = await readAttempt(created.attemptDir);
    const options = { id: "TR-01", expectedRefusal: "DemoRefused", observedRefusal: "DemoRefused", status, world, preparation: true };
    assert.doesNotThrow(() => assertRefusedBeforeSpend(options));
    assert.throws(() => assertRefusedBeforeSpend({ ...options, observedRefusal: null }), /TR-01 refusal assertion: expected/u);
    for (const field of ["callsReserved", "callsSpent"] as const) {
      assert.throws(() => assertRefusedBeforeSpend({ ...options, status: { ...status, budget: { ...status.budget, [field]: 1 } } }),
        new RegExp(`TR-01 refusal assertion: ${field}`, "u"));
    }
    assert.throws(() => assertRefusedBeforeSpend({ ...options, status: { ...status, lifecycleState: "RUNNING" } }), /DRAFT or PREPARED/u);
    assert.doesNotThrow(() => assertRefusedBeforeSpend({ ...options, preparation: false, status: { ...status, lifecycleState: "PREPARED" } }));
    assert.throws(() => assertRefusedBeforeSpend({ ...options, status: { ...status, lifecycleState: "PREPARED" } }), /preparation stays DRAFT/u);
    assert.throws(() => assertRefusedBeforeSpend({ ...options, status: { ...status, worktree: join(world.worktreeRoot, "attempt") } }), /no attempt worktree/u);
    const adapter = new ReplayStub("codex");
    adapter.launches = 1;
    world.adapters.push(adapter);
    assert.throws(() => assertRefusedBeforeSpend(options), /stub adapter invocations/u);
    world.adapters.length = 0;
    // This helper tests observation, not the shape of a broker registration.
    world.calls.push({} as (typeof world.calls)[number]);
    assert.throws(() => assertRefusedBeforeSpend(options), /broker GO invocations/u);
    world.calls.length = 0;
    mkdirSync(join(world.worktreeRoot, "awsf-baseline-example"), { recursive: true });
    assert.doesNotThrow(() => assertRefusedBeforeSpend(options));
    mkdirSync(join(world.worktreeRoot, "attempt"));
    assert.throws(() => assertRefusedBeforeSpend(options), /no attempt tree on disk/u);
  } finally { world.close(); }
});
