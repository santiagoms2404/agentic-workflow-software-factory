import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const PROVE_MODULES = ["core/src/cli/commands/prove.ts"] as const;
const PROVE_DIRECTORY = join(repoRoot(), "core", "src", "workflow", "prove");

function proveFiles(): string[] {
  return [...PROVE_MODULES, ...walkFiles(PROVE_DIRECTORY).map(relRepo)].sort();
}

test("no prove module imports raise.ts", () => {
  const scope = proveFiles();
  for (const file of PROVE_MODULES) assert.ok(existsSync(join(repoRoot(), file)), `${file} is gone; update the fence`);
  for (const file of ["bind.ts", "compile.ts", "corpus.ts"]) assert.ok(scope.includes(`core/src/workflow/prove/${file}`), `prove/${file} is fenced`);
  const offenders = scope.filter((f) => PATTERN.test(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the detector sees the import when one is added", () => {
  const offender = 'import { raiseCommand } from "../../cli/commands/raise.ts";\n';
  assert.equal(PATTERN.test(offender), true);
});
