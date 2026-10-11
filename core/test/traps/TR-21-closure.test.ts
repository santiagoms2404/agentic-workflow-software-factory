import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../../src/cli/main.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { selectedLanding } from "../fixtures/closure-readers.ts";
import { box, draft, prepare, refusals, assertRefusedBeforeSpend } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-21 refusal assertion", async () => {
  const world = box();
  try {
    const created = await draft(world);
    await prepare(world, created.attemptDir);
    // The landing arrives after a passing preflight: start must measure again.
    await selectedLanding(world);
    const errors: string[] = [];
    const code = await main({ argv: ["start", created.status.taskId, "--stub", "true", "--project", world.config.project.slug,
      "--state-root", world.stateRoot, "--config", world.configPath, "--worktree-root", world.worktreeRoot],
      cwd: world.repository, env: {}, writeOut: () => {}, writeError: line => errors.push(line) });
    const record = (await refusals(created.attemptDir)).at(-1);
    assertRefusedBeforeSpend({ id: "TR-21", expectedRefusal: "awsf.preflight-refused/v1", observedRefusal: record?.schema,
      status: await readAttempt(created.attemptDir), world, preparation: true });
    assert.equal(record?.field, "closure", "TR-21 refusal assertion: closure field");
    assert.match(record!.reason, /attempt .*\/selected-landing#1 landed after 2026-10-09T22:02:56Z .*owner closes it with awsf close selected-landing/u,
      "TR-21 refusal assertion: owner command");
    assert.equal(code, 1, "TR-21 refusal assertion: CLI exit");
    assert.match(errors.join("\n"), /K1 field closure:/u, "TR-21 refusal assertion: named CLI refusal");
  } finally { world.close(); }
});

ownMutant({ id: "TR-21", file: import.meta.filename });
