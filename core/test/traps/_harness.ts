import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import type { AttemptStatus } from "../../src/cli/commands/attempt.ts";
import type { Box } from "../fixtures/trap-world.ts";

export { box, draft, prepare, start, run, update, git, commit, OWNER, AT, ReplayStub } from "../fixtures/trap-world.ts";
export type { Box } from "../fixtures/trap-world.ts";
export { k1Request, prepareK1, recordedGates, refusals, scriptedOwner } from "../fixtures/k1-preflight.ts";
export { fakeBroker } from "../fixtures/recording-broker.ts";

/** Stable assertion label: a mutant must fail THIS assertion, not merely crash. */
export function refusalAssertion(id: string): string {
  return `${id} refusal assertion`;
}

/** INV-1, shared by preparation-time and run-before-L4 traps.
 * observedRefusal is the actual error.name, record schema, or adapter error code;
 * field-specific traps assert their record.field/reason separately with this label.
 */
export function assertRefusedBeforeSpend(options: {
  id: string;
  expectedRefusal: string;
  observedRefusal: string | null | undefined;
  status: AttemptStatus;
  world: Box;
  preparation?: boolean;
}): void {
  const { id, expectedRefusal, observedRefusal, status, world, preparation = false } = options;
  const label = refusalAssertion(id);
  assert.equal(observedRefusal, expectedRefusal, `${label}: expected ${expectedRefusal}`);
  assert.equal(status.budget.callsReserved, 0, `${label}: callsReserved`);
  assert.equal(status.budget.callsSpent, 0, `${label}: callsSpent`);
  assert.equal(world.calls.length, 0, `${label}: broker GO invocations`);
  assert.equal(world.adapters.reduce((sum, adapter) => sum + adapter.launches, 0), 0, `${label}: stub adapter invocations`);
  assert.ok(status.lifecycleState === "DRAFT" || status.lifecycleState === "PREPARED", `${label}: DRAFT or PREPARED`);
  if (preparation) {
    assert.equal(status.lifecycleState, "DRAFT", `${label}: preparation stays DRAFT`);
    assert.equal(status.worktree, null, `${label}: no attempt worktree`);
    const trees = existsSync(world.worktreeRoot)
      ? readdirSync(world.worktreeRoot).filter(name => !name.startsWith("awsf-baseline-")) : [];
    assert.deepEqual(trees, [], `${label}: no attempt tree on disk`);
  }
}
