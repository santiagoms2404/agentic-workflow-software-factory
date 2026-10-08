import assert from "node:assert/strict";
import { test } from "node:test";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { ProtectedGrantRefused } from "../../src/cli/commands/production-run.ts";
import { assertRefusedBeforeSpend, box, draft, k1Request, prepare, run, start, refusalAssertion } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

// S34's complementary run-time shape: K1 plans the declared protected write,
// but the first writing phase has no grant. No protected content is changed.
test("TR-09 refusal assertion", async () => {
  const world = box(config => { config.policy.protected_paths.push("core/src/example.ts"); });
  const label = refusalAssertion("TR-09");
  try {
    const created = await draft(world, k1Request("build a protected module", "core/src/example.ts"), "build-review");
    await prepare(world, created.attemptDir);
    const prepared = await start(world, created.attemptDir);
    let failure: unknown;
    try { await run(world, created.attemptDir); } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    assertRefusedBeforeSpend({ id: "TR-09", expectedRefusal: "ProtectedGrantRefused",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world });
    assert.ok(failure instanceof ProtectedGrantRefused, label);
    assert.equal(failure.boundary, "before-l4", `${label}: boundary`);
    assert.equal(failure.phase, "builder", `${label}: phase`);
    assert.deepEqual(failure.paths, ["core/src/example.ts"], `${label}: paths`);
    assert.equal(status.lifecycleState, "PREPARED", `${label}: stays PREPARED`);
    assert.equal(status.revision, prepared.revision + 1, `${label}: one refusing update`);
    const evidence = await readAttemptEvidence(created.attemptDir);
    const records = evidence.flatMap(entry => entry.type === "grant-refused" ? [entry.record] : []);
    assert.equal(records.length, 1, `${label}: one refusal record`);
    assert.equal(records[0]!.boundary, "before-l4", `${label}: recorded boundary`);
    assert.equal(records[0]!.callsSpent, 0, `${label}: recorded spend`);
    assert.equal(evidence.some(entry => entry.type === "transition" && entry.from === "PREPARED"), false, `${label}: no L4`);
  } finally { world.close(); }
});

ownMutant({ id: "TR-09", file: import.meta.filename });
