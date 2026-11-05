import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sourceImportCandidates, walkFiles } from "./_walk.ts";

for (const ext of [".ts", ".tsx", ".vue", ".mts", ".cts", ".js", ".mjs", ".cjs"]) {
  test(`default walker reaches nested ${ext} code`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "awsf-walk-coverage-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const nested = join(root, "src", "nested");
    mkdirSync(nested, { recursive: true });
    const file = join(nested, `module${ext}`);
    writeFileSync(file, "export const fixture = 1;\n");
    assert.deepEqual(walkFiles(root), [file]);
  });
}

test("default walker preserves directory exclusions and exact code suffix matching", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-walk-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["src", "src/node_modules", "src/dist", "src/.git"]) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "module.mjs"), "export const fixture = 1;\n");
  }
  for (const name of ["guide.md", "page.html", "data.json", "module.mjs.bak"]) {
    writeFileSync(join(root, name), "fixture\n");
  }
  assert.deepEqual(walkFiles(root), [join(root, "src", "module.mjs")]);
});

test("explicit extensions replace defaults and remain in force during recursion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-walk-explicit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "nested"));
  for (const name of ["module.ts", "module.mts", "module.mjs", "guide.md"]) {
    writeFileSync(join(root, "nested", name), "fixture\n");
  }
  // A default expansion must not silently broaden markdown fences or override
  // a caller's explicit TypeScript-only scope. Those callers need their own fix.
  assert.deepEqual(walkFiles(root, [".ts"]), [join(root, "nested", "module.ts")]);
  assert.deepEqual(walkFiles(root, [".md"]), [join(root, "nested", "guide.md")]);
  assert.deepEqual(walkFiles(root, [".mts", ".mjs"]).sort(),
    ["module.mts", "module.mjs"].map((name) => join(root, "nested", name)).sort());
  assert.deepEqual(walkFiles(root, []), []);
});

test("a missing scan root refuses unless the caller marks it optional", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-walk-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const absent = join(root, "absent");
  assert.throws(() => walkFiles(absent), { code: "ENOENT" });
  assert.deepEqual(walkFiles(absent, undefined, undefined, { allowMissingRoot: true }), []);
});

test("source import candidates cover every walked suffix and preserve explicit paths", () => {
  const base = join(tmpdir(), "awsf-import-candidates", "module");
  const candidates = sourceImportCandidates(base);
  assert.ok(candidates.includes(`${base}.vue`));
  assert.ok(candidates.includes(`${base}.mts`));
  assert.ok(candidates.includes(join(base, "index.ts")));
  assert.deepEqual(sourceImportCandidates(`${base}.mts`), [`${base}.mts`]);
});

test("the walker follows file and directory links while pruning ordinary directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-walk-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "target"));
  writeFileSync(join(root, "target", "module.ts"), "export const fixture = 1;\n");
  symlinkSync(join(root, "target", "module.ts"), join(root, "linked.ts"));
  symlinkSync(join(root, "target"), join(root, "linked-dir"), "dir");
  assert.deepEqual(walkFiles(root).sort(), [join(root, "linked.ts"), join(root, "linked-dir", "module.ts"), join(root, "target", "module.ts")].sort());
});
