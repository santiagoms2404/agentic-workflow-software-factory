import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../../src/config/load.ts";
import { EDGE_BLOCKER_CODES } from "../../../src/state/errors.ts";
import { BLOCKER_COVERAGE, PENDING, TRAPS, type TrapEntry } from "../../../src/traps/catalogue.ts";
import { assertCatalogueFence, markerPairs, PROTECTED_TRAP_PATHS, treeFiles, type SourceFile } from "../../fixtures/trap-fence.ts";
import { runMutant } from "../../traps/_mutate.ts";
import { repoRoot } from "./_walk.ts";

const ROOT = repoRoot();
// T02 describes these existing refusals; T03 may not adopt real traps.
// T04 MUST remove this exact bootstrap list when it adds their tests/markers.
// It is NOT a pending-gap allowance: PENDING is restricted to M4 task ids.
const T04_ADOPTION = ["TR-01", "TR-02", "TR-03", "TR-04", "TR-05", "TR-06", "TR-07", "TR-08", "TR-09", "TR-10", "TR-11", "TR-12"];

test("trap catalogue, source markers, test files and blocker vocabulary agree", () => {
  const protectedPaths = loadConfig(readFileSync(join(ROOT, "awsf.config.yaml"), "utf8")).policy.protected_paths;
  assertCatalogueFence({ traps: TRAPS, pending: PENDING, sources: treeFiles(ROOT, "core/src"),
    tests: treeFiles(ROOT, "core/test/traps").map(file => file.path).filter(path => /\/TR-.*\.test\.ts$/u.test(path)),
    blockers: EDGE_BLOCKER_CODES, coverage: BLOCKER_COVERAGE, protectedPaths: [...PROTECTED_TRAP_PATHS, ...protectedPaths],
    awaitingAdoption: T04_ADOPTION });
});

const trap: TrapEntry = { id: "TR-01", family: "demo", title: "Test-only refusal", seeds: [],
  refusalPoint: "start", refusal: "DemonstrationRefused" };
const source: SourceFile = { path: "core/src/demo.ts", text: [
  "export function refuse() {", "// trap-refusal-begin TR-01", "return 'DemonstrationRefused';",
  "// trap-refusal-end TR-01", "return null;", "}", "",
].join("\n") };
function planted() {
  return { traps: [trap], pending: [], sources: [source], tests: ["core/test/traps/TR-01-demo.test.ts"],
    blockers: { L2: ["preflight-failed"] },
    coverage: [{ edge: "L2", code: "preflight-failed", target: { family: "demo" }, evidence: "test fixture" }] };
}

test("the strict fence accepts a complete demonstration and refuses a duplicate id", () => {
  assert.doesNotThrow(() => assertCatalogueFence(planted()));
  assert.throws(() => assertCatalogueFence({ ...planted(), traps: [trap, trap] }), /duplicate trap id/u);
});
test("the fence refuses a marker with no entry and an entry with no test", () => {
  assert.throws(() => assertCatalogueFence({ ...planted(), traps: [] }), /marker with no entry/u);
  assert.throws(() => assertCatalogueFence({ ...planted(), tests: [] }), /entry with 0 tests/u);
  // Even T03's bootstrap may not admit an invented entry lacking a test.
  assert.throws(() => assertCatalogueFence({ ...planted(), traps: [trap, { ...trap, id: "TR-02" }], awaitingAdoption: ["TR-01"] }), /entry with 0 tests: TR-02/u);
});
test("the fence refuses an unmarked test and a newly uncovered blocker pair", () => {
  assert.throws(() => assertCatalogueFence({ ...planted(), sources: [] }), /entry with 0 marker pairs/u);
  assert.throws(() => assertCatalogueFence({ ...planted(), blockers: { L2: ["preflight-failed", "new-code"] } }), /uncovered blocker code: L2:new-code/u);
  assert.throws(() => assertCatalogueFence({ ...planted(), pending: [{ task: "T04" as "T12", seeds: [] }] }), /pending trap outside M4/u);
});
test("the fence refuses duplicate tests, duplicate pairs and invalid coverage targets", () => {
  const input = planted();
  assert.throws(() => assertCatalogueFence({ ...input, tests: [...input.tests, "core/test/traps/TR-01-other.test.ts"] }), /entry with 2 tests/u);
  assert.throws(() => assertCatalogueFence({ ...input, sources: [source, { ...source, path: "core/src/other.ts" }] }), /entry with 2 marker pairs/u);
  assert.throws(() => assertCatalogueFence({ ...input, coverage: [{ ...input.coverage[0]!, target: { family: "absent" } }] }), /unknown coverage family/u);
  assert.throws(() => assertCatalogueFence({ ...input, coverage: [input.coverage[0]!, input.coverage[0]!] }), /duplicate blocker coverage/u);
});

test("markers must be balanced, non-nested, nonempty and outside protected paths", () => {
  const begin = "// trap-refusal-begin TR-01";
  const end = "// trap-refusal-end TR-01";
  for (const [text, reason] of [[`${begin}\nreturn;`, /unclosed/u], [end, /unbalanced/u],
    [`${begin}\n${begin}\nreturn;\n${end}`, /nested/u], [`${begin}\n${end}`, /empty/u],
    ["// trap-refusal-begin TR-X", /malformed/u]] as const) {
    assert.throws(() => markerPairs([{ path: source.path, text }]), reason);
  }
  for (const path of ["core/src/state/demo.ts", "core/src/policy/demo.ts", "core/src/execution/transport-broker.ts",
    "core/src/observability/migrations/demo.ts"]) assert.throws(() => markerPairs([{ ...source, path }]), /protected trap marker/u);
});

function demonstration() {
  const root = mkdtempSync(join(tmpdir(), "awsf-trap-demo-"));
  for (const path of ["core/src", "core/test/fixtures", "core/test/traps/_harness.ts", "core/test/traps/_mutate.ts",
    "dashboard/shared", "prompts", "package.json", "awsf.config.yaml"]) {
    cpSync(join(ROOT, path), join(root, path), { recursive: true });
  }
  symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
  const demoSource = join(root, source.path);
  // TR-00 cannot be a real contiguous catalogue id, so T04's adopted
  // TR-01 markers in the copied production source cannot collide with this demo.
  writeFileSync(demoSource, source.text.replaceAll("TR-01", "TR-00"));
  const file = join(root, "core/test/traps/TR-00-demo.test.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `import { test } from 'node:test';
import { readAttempt } from '../../src/cli/commands/attempt.ts';
import { refuse } from '../../src/demo.ts';
import { box, draft, assertRefusedBeforeSpend } from './_harness.ts';
import { ownMutant } from './_mutate.ts';
test('TR-00 refusal assertion', async () => {
  const world = box();
  try {
    const created = await draft(world);
    assertRefusedBeforeSpend({ id: 'TR-00', expectedRefusal: 'DemonstrationRefused',
      observedRefusal: refuse(), status: await readAttempt(created.attemptDir), world, preparation: true });
  } finally { world.close(); }
});
ownMutant({ id: 'TR-00', file: import.meta.filename });
`);
  return { root, file, demoSource, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("a test-only trap is green; its last test runs a red source mutant", context => {
  const demo = demonstration();
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", demo.file], {
      cwd: demo.root, env, encoding: "utf8", timeout: 120_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.error, undefined, output);
    assert.equal(result.status, 0, output);
    assert.match(output, /ok 2 - TR-00 own mutant/u);
    assert.match(output, /TR-00 mutant wall time:/u);
    context.diagnostic(output.match(/TR-00 mutant wall time: [\d.]+ ms/u)?.[0] ?? "mutant timing missing");
    assert.equal(readFileSync(demo.demoSource, "utf8"), source.text.replaceAll("TR-01", "TR-00"), "mutation never changes its source tree");
  } finally { demo.close(); }
});

test("a planted unmarked refusal keeps its mutant green and is rejected", () => {
  const demo = demonstration();
  try {
    // The markers are balanced but surround irrelevant code, not the refusal.
    writeFileSync(demo.demoSource, `export function refuse() {
return 'DemonstrationRefused';
// trap-refusal-begin TR-00
void 0;
// trap-refusal-end TR-00
}
`);
    assert.throws(() => runMutant({ id: "TR-00", file: demo.file, sourceRoot: demo.root }), /mutant stayed green/u);
    writeFileSync(demo.demoSource, "export function refuse() { return 'DemonstrationRefused'; }\n");
    assert.throws(() => runMutant({ id: "TR-00", file: demo.file, sourceRoot: demo.root }), /expected exactly one refusal marker pair/u);
  } finally { demo.close(); }
});

test("a loader failure is not evidence of a failing refusal assertion", () => {
  const demo = demonstration();
  try {
    writeFileSync(demo.file, "import './missing-module.ts';\n");
    assert.throws(() => runMutant({ id: "TR-00", file: demo.file, sourceRoot: demo.root }), /did not fail its refusal assertion/u);
    assert.ok(existsSync(demo.demoSource));
  } finally { demo.close(); }
});
