import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { preflightCommand } from "../../src/cli/commands/preflight.ts";
import { assertRefusedBeforeSpend, box, draft, git, prepare, start } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

const id = "TR-23";
for (const boundary of ["preflight", "start"] as const) {
  test(`${id} refusal assertion: ${boundary}`, async () => {
    const world = box();
    try {
      const { attemptDir } = await draft(world);
      await prepare(world, attemptDir);
      git(world.repository, "config", "status.showUntrackedFiles", "no");
      for (let i = 1; i <= 7; i++) writeFileSync(join(world.repository, `owner ${i}.txt`), "Owner's work\n");
      let refusal: Error | undefined;
      try {
        if (boundary === "start") await start(world, attemptDir);
        else await preflightCommand({ attemptDir, stateRoot: world.stateRoot, configPath: world.configPath,
          worktreeRoot: world.worktreeRoot, where: ["core/src/example.ts"], read: [], consulted: [] });
      } catch (error) { refusal = error as Error; }
      assertRefusedBeforeSpend({ id, expectedRefusal: "CanonicalCheckoutNotClean", observedRefusal: refusal?.name,
        status: await readAttempt(attemptDir), world, preparation: true });
      for (let i = 1; i <= 5; i++) assert.ok(refusal!.message.includes(`owner ${i}.txt`), `${id} refusal assertion: path ${i}`);
      assert.match(refusal!.message, /2 more/u, `${id} refusal assertion: remaining paths counted`);
      assert.doesNotMatch(refusal!.message, /owner [67]\.txt/u, `${id} refusal assertion: at most five paths`);
    } finally { world.close(); }
  });
}

ownMutant({ id, file: import.meta.filename });
