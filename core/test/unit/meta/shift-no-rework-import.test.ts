import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

// W17 task 11: rework is not a shift's recovery instrument, and the code is
// why. Every phase the rework path creates is `maxCorrections: 0`, so an owner
// raise buys no correction margin there. And that path REJECTS provider output
// matching a credential pattern (`credentialSafeText` in rework.ts), where a
// normal run scrubs it and carries on. A shift that reached for rework after a
// red ticket would trade the correction round it was compiled with for none,
// and could abort on output a normal run would have kept. A blocked shift
// surfaces as a ticket block and waits for its owner; it never retries itself
// into a corner.
//
// The fence covers every shift module (any file under core/src named for the
// shift or living under a `shift/` directory) and production-run.ts, the
// runner that executes a shift and writes its ticket block.
//
// W18 task 14 adds every prove module (`awsf prove` and anything under a
// `prove/` directory). A replay measures its arm under the correction round the
// `prove` recipe compiles, so a replay that reached for rework would be scored
// on a phase with none, and could abort on output its arm's normal run keeps.

const SRC = join(repoRoot(), "core", "src");
const PATTERN = /(['"])[^'"\n]*\/rework\.ts\1/;
const RUNNER = "core/src/cli/commands/production-run.ts";

function fenced(): string[] {
  return walkFiles(SRC)
    .map(relRepo)
    .filter((file) => file === RUNNER || file.split("/").includes("shift") || basename(file).startsWith("shift")
      || file.split("/").includes("prove") || basename(file) === "prove.ts");
}

test("the fence scope holds every shift module, every prove module and the runner", () => {
  const scope = fenced();
  for (const expected of [RUNNER, "core/src/cli/commands/shift.ts", "core/src/workflow/shift/bind.ts", "core/src/workflow/shift/compile.ts",
    "core/src/cli/commands/prove.ts", "core/src/workflow/prove/bind.ts", "core/src/workflow/prove/compile.ts", "core/src/workflow/prove/corpus.ts"]) {
    assert.ok(scope.includes(expected), `${expected} is fenced`);
  }
});

test("no shift module, no prove module and not the runner imports rework.ts", () => {
  const offenders = fenced().filter((file) => PATTERN.test(readFileSync(join(repoRoot(), file), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the detector sees the import when one is added", () => {
  assert.equal(PATTERN.test('import { reworkCommand } from "../../cli/commands/rework.ts";\n'), true);
  assert.equal(PATTERN.test("const { reworkCommand } = await import('./rework.ts');\n"), true);
});
