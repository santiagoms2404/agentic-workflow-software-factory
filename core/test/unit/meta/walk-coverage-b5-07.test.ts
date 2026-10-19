import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { walkFiles } from "./_walk.ts";

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

test("a missing directory still yields no files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-walk-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(walkFiles(join(root, "absent")), []);
});
