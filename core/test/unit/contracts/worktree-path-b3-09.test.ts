// B3-09 — a newline blinded the traversal lookaheads.
//
// The worktree-relative path rules use `.*` inside their lookaheads, and `.`
// does not match a newline, while `^` and `$` anchor only the whole string. So
// "x\n../../etc/passwd" passed the structural floor that refuses
// "../../etc/passwd". The same lookahead shape sits in the shift manifest and
// closure record paths, and all three are checked here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import { WorktreeRelativePath } from "../../../src/contracts/envelope-base.ts";
import { ShiftManifestTicketSchema } from "../../../src/contracts/shift-selection-record.ts";
import { ClosureRecordSchema } from "../../../src/contracts/closure-record.ts";

const closureBlobPath = ClosureRecordSchema.properties.blobs.items.properties.path;

const TRAVERSAL_WITH_NEWLINE = [
  "x\n../../../etc/passwd",
  "x\n/../../../etc/passwd",
  "specs/x.md\n../../etc/passwd",
  "x\n//y",
  "x\nspecs/y/",
];

test("the worktree-relative path refuses traversal and doubled separators after a newline (B3-09)", () => {
  assert.equal(Value.Check(WorktreeRelativePath, "../../../etc/passwd"), false, "the baseline refusal holds");
  for (const path of TRAVERSAL_WITH_NEWLINE) {
    assert.equal(Value.Check(WorktreeRelativePath, path), false, `${JSON.stringify(path)} must be refused`);
  }
  assert.equal(Value.Check(WorktreeRelativePath, "specs/ticket.md"), true);
});

test("a name that contains a line break stays a valid path, as git allows it (B3-09)", () => {
  for (const path of ["specs/unusual\nname.md", "specs/x\r.md", "specs/x\u2028.md"]) {
    assert.equal(Value.Check(WorktreeRelativePath, path), true, `${JSON.stringify(path)} is a literal name`);
  }
});

test("the shift manifest ticket path refuses the same newline bypass (B3-09)", () => {
  const ticket = { id: "T01", digest: "a".repeat(64) };
  assert.equal(Value.Check(ShiftManifestTicketSchema, { ...ticket, path: "plans/tickets/T01.md" }), true);
  for (const path of ["x\n../../secret.md", "x\n/../../secret.md", "../../secret.md"]) {
    assert.equal(Value.Check(ShiftManifestTicketSchema, { ...ticket, path }), false, `${JSON.stringify(path)} must be refused`);
  }
});

test("the closure record blob path refuses the same newline bypass (B3-09)", () => {
  assert.equal(Value.Check(closureBlobPath, "specs/x.md"), true);
  // The closure rule is the traversal rule alone; it never refused doubled separators.
  for (const path of ["x\n../../secret", "../../secret"]) {
    assert.equal(Value.Check(closureBlobPath, path), false, `${JSON.stringify(path)} must be refused`);
  }
});
