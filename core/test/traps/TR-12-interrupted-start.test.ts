import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { AttemptWorktreeExists } from "../../src/git/worktrees.ts";
import { assertRefusedBeforeSpend, box, draft, prepare, start, refusalAssertion } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

// G11: interrupted start left an unregistered attempt tree. The guard names
// it and retains it; deleting the guard must not pass merely because Git
// also refuses the nonempty path with a different error.
test("TR-12 refusal assertion", async () => {
  const world = box();
  const label = refusalAssertion("TR-12");
  try {
    const created = await draft(world);
    await prepare(world, created.attemptDir);
    const tree = join(world.worktreeRoot, created.status.sessionId);
    mkdirSync(tree);
    writeFileSync(join(tree, "retained.txt"), "synthetic interrupted seeding evidence\n");
    const before = await readAttempt(created.attemptDir);
    let failure: unknown;
    try { await start(world, created.attemptDir); } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    // Not preparation:true: this shape deliberately already HAS an attempt
    // directory, unlike the eight K1 preparation refusals.
    assertRefusedBeforeSpend({ id: "TR-12", expectedRefusal: "AttemptWorktreeExists",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world });
    assert.ok(failure instanceof AttemptWorktreeExists, label);
    assert.equal(failure.path, tree, `${label}: path`);
    assert.equal(failure.registered, false, `${label}: unregistered`);
    assert.deepEqual(status, before, `${label}: attempt unchanged`);
    assert.equal(status.lifecycleState, "DRAFT", `${label}: stays DRAFT`);
    assert.equal(status.worktree, null, `${label}: tree not adopted`);
    assert.equal(readFileSync(join(tree, "retained.txt"), "utf8"), "synthetic interrupted seeding evidence\n", `${label}: evidence retained`);
  } finally { world.close(); }
});

ownMutant({ id: "TR-12", file: import.meta.filename });
