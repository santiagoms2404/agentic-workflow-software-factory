// Regression test for B2-10:
// jevFenceStatus() lets a readFile failure on any single core/src .ts file escape,
// although a readdir failure is reported as 'unchecked', so jevDoctorRow rejects
// and awsf doctor prints an error instead of its report.

import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { JEV_TRANSPORT_FILE, jevDoctorRow, jevFenceStatus } from "../../../src/decision/jev-doctor.ts";

function scratch(label: string): { root: string; close: () => void; write: (file: string, text: string) => string } {
  const root = mkdtempSync(join(tmpdir(), `awsf-jev-doctor-b2-10-${label}-`));
  return {
    root,
    close: () => rmSync(root, { recursive: true, force: true }),
    write: (file, text) => {
      const full = join(root, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, "utf8");
      return full;
    },
  };
}

test("B2-10: an unreadable .ts file in sourceRoot reports unchecked rather than escaping readFile", async () => {
  const box = scratch("unreadable");
  try {
    box.write(`src/${JEV_TRANSPORT_FILE}`, 'export const ok = true;');
    const unreadableFile = box.write("src/workflow/unreadable.ts", "export const value = 42;");
    chmodSync(unreadableFile, 0);

    const status = await jevFenceStatus(join(box.root, "src"));
    assert.equal(status.state, "unchecked");
    assert.match(status.detail, /cannot read workflow\/unreadable\.ts/);

    const row = await jevDoctorRow({
      catalogPath: join(box.root, "none.yaml"),
      env: {},
      sourceRoot: join(box.root, "src"),
    });
    assert.match(row.line, /fence unchecked/);
    assert.match(row.line, /cannot read workflow\/unreadable\.ts/);
    assert.equal(row.finding, null);
  } finally {
    try {
      chmodSync(join(box.root, "src/workflow/unreadable.ts"), 0o666);
    } catch {}
    box.close();
  }
});

test("B2-10 triangulation: intact fence when readable, and unchecked detail cites the failed file", async () => {
  const box = scratch("triangulate");
  try {
    box.write(`src/${JEV_TRANSPORT_FILE}`, 'export const ok = true;');
    box.write("src/workflow/clean.ts", "export const clean = 1;");
    const statusClean = await jevFenceStatus(join(box.root, "src"));
    assert.deepEqual(statusClean, { state: "intact", files: 2 });

    const secondFile = box.write("src/cli/blocked.ts", "export const blocked = 2;");
    chmodSync(secondFile, 0);
    const statusBlocked = await jevFenceStatus(join(box.root, "src"));
    assert.equal(statusBlocked.state, "unchecked");
    assert.match(statusBlocked.detail, /cannot read cli\/blocked\.ts/);
  } finally {
    try {
      chmodSync(join(box.root, "src/cli/blocked.ts"), 0o666);
    } catch {}
    box.close();
  }
});
