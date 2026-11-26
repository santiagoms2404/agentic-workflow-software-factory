import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkInvariants, INVARIANTS } from "./_invariants.ts";
import { parseTestSource, registeredTestNames } from "./_test-audit.ts";
import { repoRoot } from "./_walk.ts";

test("AGENTS invariants are covered by named tests or an explicit partial row", () => {
  const root = repoRoot();
  const cache = new Map<string, ReadonlySet<string>>();
  checkInvariants(readFileSync(join(root, "AGENTS.md"), "utf8"), INVARIANTS, file => {
    const path = join(root, file);
    if (!cache.has(file)) cache.set(file, existsSync(path) ? registeredTestNames(parseTestSource(path, readFileSync(path, "utf8"))) : new Set());
    return cache.get(file)!;
  });
});

test("the invariant table refuses a new invariant and a vanished named test", () => {
  const rows = { 3: { tests: [{ file: "planted.test.ts", title: "proves three" }] } };
  const agents = "3. **Existing rule.**\n";
  const tests = (body: string) => registeredTestNames(parseTestSource("planted.test.ts", body));
  const live = tests('import { test } from "node:test"; test("proves three", () => { throw Error(); });');
  assert.doesNotThrow(() => checkInvariants(agents, rows, () => live));
  assert.throws(() => checkInvariants(`${agents}14. **New invariant.**\n`, rows, () => live), /invariant 14 has no row/u);
  assert.throws(() => checkInvariants(agents, rows, () => tests('// test("proves three", () => {});')), /invariant 3: missing test planted\.test\.ts — proves three/u);
  assert.throws(() => checkInvariants("", rows, () => live), /empty AGENTS\.md invariant list/u);
});
