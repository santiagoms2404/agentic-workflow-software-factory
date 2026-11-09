import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

// INV-5: a shift never widens its own ceiling. `awsf raise` requires an
// interactive owner terminal by design, so a running shift structurally
// cannot reach it — and that absence must be mechanical, not remembered. The
// fence is scoped to core/src/workflow/shift/, the compiled shift's own
// mechanism; the CLI's `awsf shift plan` readout (core/src/cli/commands/shift.ts)
// imports raise.ts for one constant (MAX_GRANT_CALLS) only, to phrase its
// recommendation in the units the owner's own raise act already uses — it
// never calls raiseCommand, and it sits outside this fence's scope.

const SCOPE = join(repoRoot(), "core", "src", "workflow", "shift");
const PATTERN = /(['"])[^'"\n]*\/raise\.ts\1/;

test("no module under core/src/workflow/shift/ imports raise.ts", () => {
  const offenders = walkFiles(SCOPE)
    .map(relRepo)
    .filter((f) => PATTERN.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});

// W18 task 14: a replay is measured at the ceiling it was created with. The
// scorer names a replay that paused at its ceiling `paused-at-ceiling` and
// drops its pair, so a prove module that could widen the ceiling would turn
// that pause into spend no other arm was given. `awsf prove` and the compiled
// `prove` workflow are fenced the same way the shift is.
const PROVE_COMMANDS = join(repoRoot(), "core", "src", "cli", "commands");
const PROVE_DIRECTORY = join(repoRoot(), "core", "src", "workflow", "prove");

/** Every prove command module, found on disk: `prove.ts` and any sibling such as `prove-readout.ts`. */
function proveCommandModules(): string[] {
  return readdirSync(PROVE_COMMANDS)
    .filter((name) => /^prove(?:[.-][\w.-]*)?\.ts$/u.test(name))
    .map((name) => `core/src/cli/commands/${name}`);
}

function proveFiles(): string[] {
  return [...proveCommandModules(), ...walkFiles(PROVE_DIRECTORY).map(relRepo)].sort();
}

test("no prove module imports raise.ts", () => {
  const scope = proveFiles();
  assert.ok(scope.includes("core/src/cli/commands/prove.ts"), "prove.ts is fenced");
  for (const file of ["bind.ts", "compile.ts", "corpus.ts"]) assert.ok(scope.includes(`core/src/workflow/prove/${file}`), `prove/${file} is fenced`);
  const offenders = scope.filter((f) => PATTERN.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the detector sees the import when one is added", () => {
  const offender = 'import { raiseCommand } from "../../cli/commands/raise.ts";\n';
  assert.equal(PATTERN.test(offender), true);
});
