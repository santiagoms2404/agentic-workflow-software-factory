import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const ROOT = repoRoot();
const COMMANDS = ["production-run.ts", "review-phase.ts", "rework.ts", "start.ts", "new.ts"];

/** Static/re-export, dynamic and require imports; resolves relative paths rather than counting ../. */
function importsAdvisory(file: string, source: string): boolean {
  const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;
  for (const match of source.matchAll(imports)) {
    const specifier = match[2]!;
    const path = specifier.startsWith(".") ? resolve(dirname(join(ROOT, file)), specifier) : resolve(ROOT, specifier);
    if (path.startsWith(join(ROOT, "core/src/metrics") + "/") || path === join(ROOT, "dashboard/shared/route-metrics.ts")) return true;
  }
  return false;
}

test("runner, review routing and workflow compilers never import metrics or route evidence", () => {
  const files = walkFiles(join(ROOT, "core/src")).map(relRepo);
  const scope = files.filter((file) => file.startsWith("core/src/workflow/") || file.startsWith("core/src/execution/") ||
    COMMANDS.some((name) => file.endsWith(`/${name}`)));
  for (const name of COMMANDS) assert.ok(scope.some((file) => file.endsWith(`/${name}`)), `${name} must remain fenced`);
  const offenders = scope.filter((file) => importsAdvisory(file, readFileSync(join(ROOT, file), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the advisory matcher bites on in-memory specimens, including alternate relative spellings", () => {
  const file = "core/src/workflow/shift/compile.ts";
  for (const source of [
    'import { read } from "../../metrics/payload.ts";',
    'export { recommend } from "../../../../dashboard/shared/route-metrics.ts";',
    'const read = import("../../metrics/../metrics/payload.ts");',
    'const read = require("core/src/metrics/payload.ts");',
    'import "../../metrics/payload.ts";',
  ]) assert.equal(importsAdvisory(file, source), true, source);
  assert.equal(importsAdvisory(file, 'import { compile } from "../compiler.ts";'), false);
  assert.equal(importsAdvisory(file, 'import type { MetricsResponse } from "../../../../dashboard/shared/types.ts";'), false);
});
