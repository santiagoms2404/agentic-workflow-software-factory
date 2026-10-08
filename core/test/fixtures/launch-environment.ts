import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { ProductionExecutableUnavailable } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { assertRefusedBeforeSpend, refusalAssertion } from "../traps/_harness.ts";
import { box, draft, prepare, run, start, ReplayStub } from "./trap-world.ts";
import { k1Request } from "./k1-preflight.ts";

/** S11/S17: a CLI resolves for a shell but not for the descriptor's launch PATH. */
export async function launchEnvironmentRefusal(workflow = "simple-sdlc", missingId = "claude", phase = "planner") {
  const world = box();
  const label = refusalAssertion("TR-13");
  try {
    const shellPath = join(world.root, "shell-bin");
    const launchPath = join(world.root, "launch-bin");
    mkdirSync(shellPath);
    mkdirSync(launchPath);
    // Deliberately not a runnable provider program: no test may spawn it.
    writeFileSync(join(shellPath, "claude"), "resolution fixture\n", { mode: 0o700 });
    writeFileSync(join(shellPath, "pi"), "resolution fixture\n", { mode: 0o700 });
    const missing = missingId === "claude" ? new ClaudeCodeAdapter() : new PiCodexAdapter();
    assert.equal((await missing.isAvailable(undefined, { PATH: shellPath })).status, "available", label);
    const asked: string[] = [];
    const created = await draft(world, k1Request("replay the launch environment", "core/src/example.ts"), workflow);
    await prepare(world, created.attemptDir);
    const prepared = await start(world, created.attemptDir);
    let failure: unknown;
    try {
      await run(world, created.attemptDir, { ...world.infrastructure,
        adapterFor: (_entry, id) => {
          const adapter = new class extends ReplayStub {
            override async isAvailable(_signal?: AbortSignal, env = process.env) {
              asked.push(id);
              // The runner supplies its launch source, never the shell fixture's PATH.
              assert.equal(env.PATH, process.env.PATH);
              return id === missingId ? missing.isAvailable(undefined, this.buildSpec({
                model: "synthetic", prompt: "preflight", cwd: world.repository, env: {},
              }).env) : super.isAvailable();
            }
            override buildSpec(request: Parameters<ReplayStub["buildSpec"]>[0]) {
              return { ...super.buildSpec(request), env: { PATH: launchPath } };
            }
          }(id);
          world.adapters.push(adapter);
          return adapter;
        } });
    } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    assertRefusedBeforeSpend({ id: "TR-13", expectedRefusal: "ProductionExecutableUnavailable",
      observedRefusal: failure instanceof Error ? failure.name : null, status, world });
    assert.ok(failure instanceof ProductionExecutableUnavailable, label);
    assert.equal(failure.adapterId, missingId, `${label}: adapter`);
    assert.equal(failure.phase, phase, `${label}: phase`);
    assert.equal(failure.path, launchPath, `${label}: launch PATH`);
    assert.match(failure.message, /executable .* is not runnable/u, label);
    assert.deepEqual(status, prepared, `${label}: PREPARED unchanged`);
    const evidence = await readAttemptEvidence(created.attemptDir);
    assert.equal(evidence.some(row => row.type === "transition" && row.from === "PREPARED"), false, `${label}: no L4`);
    return asked;
  } finally { world.close(); }
}
