import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the detector sees the import when one is added", () => {
  const offender = 'import { raiseCommand } from "../../cli/commands/raise.ts";\n';
  assert.equal(PATTERN.test(offender), true);
});
