import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { assertClosureFiles, type ClosureSnapshot } from "../../../src/git/closure.ts";

test("closure refuses a registered file whose parent is a symbolic link", (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-closure-symlink-"));
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(root, "linked"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot: ClosureSnapshot = {
    tree: new Map([["linked/file.txt", Buffer.from("expected")]]),
    registry: { plans: [], lightTickets: new Map() }, modes: new Map(), blobs: new Map(),
  };

  assert.throws(() => assertClosureFiles(root, snapshot, ["linked/file.txt"]), /closure refuses symlink parent/u);
});
