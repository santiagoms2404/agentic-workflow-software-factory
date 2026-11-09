import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DRIVING_DOC_EXTS, DRIVING_TEXT_EXTS, drivingDir, drivingDocs, drivingTextFiles } from "./_driving.ts";
import { walkFiles } from "./_walk.ts";

// Exercise the actual sweep list on disk, not a copy of a fence's matcher.
// Harmless contents suffice: the defect is that the file never reaches a matcher.
for (const ext of [".md", ".txt", ".json", ".yaml", ".yml", ".sh", ".ts", ".mts", ".js", ".mjs", ".cjs", ".html", ".tsx", ".cts", ".vue"]) {
  test(`driving text sweep reaches nested ${ext} files`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "awsf-driving-coverage-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const nested = join(root, "marimba", "nested");
    mkdirSync(nested, { recursive: true });
    const file = join(nested, `helper${ext}`);
    writeFileSync(file, "fixture\n");
    assert.deepEqual(walkFiles(root, DRIVING_TEXT_EXTS), [file]);
  });
}

test("driving text coverage does not widen markdown parsing or include binary and backup files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-driving-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["guide.md", "helper.mjs", "page.html", "image.png", "helper.mjs.bak"]) {
    writeFileSync(join(root, name), "fixture\n");
  }
  assert.deepEqual(walkFiles(root, DRIVING_DOC_EXTS), [join(root, "guide.md")]);
  assert.deepEqual(walkFiles(root, DRIVING_TEXT_EXTS).sort(),
    ["guide.md", "helper.mjs", "page.html"].map((name) => join(root, name)).sort());
});

test("driving entry points use the shared lists without changing their root", () => {
  const docs = drivingDocs();
  assert.ok(docs.length > 0, "the real driving tree must not be vacuous");
  assert.deepEqual(docs, walkFiles(drivingDir(), DRIVING_DOC_EXTS));
  assert.deepEqual(drivingTextFiles(), walkFiles(drivingDir(), DRIVING_TEXT_EXTS));
});
