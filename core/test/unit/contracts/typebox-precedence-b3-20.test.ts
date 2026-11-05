// B3-20 — the emitter's options and the schema's own keys.
//
// toJsonSchema lets the schema's own $id, title and description win over the
// caller's options, so an option the schema contradicts never reaches the
// output. Five emitters passed an absolute $id that was silently dropped. The
// contract is now stated and tested: the schema's declared identity is the one
// emitted, and an option fills only the keys the schema leaves open. The
// contracts emitters no longer pass an option the schema overrides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Type } from "@sinclair/typebox";
import { toJsonSchema } from "../../../src/contracts/typebox.ts";
import { emitTicketJsonSchema } from "../../../src/contracts/ticket.ts";
import { emitShiftManifestJsonSchema } from "../../../src/contracts/shift-selection-record.ts";

test("a $id the schema declares is the identity emitted, whatever the caller passes (B3-20)", () => {
  const declared = Type.Object({ a: Type.String() }, { $id: "awsf.example/v1", title: "Example" });
  const emitted = toJsonSchema(declared, { $id: "https://awsf.local/schemas/awsf.example/v1", title: "Other" });
  assert.equal(emitted["$id"], "awsf.example/v1");
  assert.equal(emitted["title"], "Example");
});

test("an option fills the keys the schema leaves open (B3-20)", () => {
  const open = Type.Object({ a: Type.String() });
  const emitted = toJsonSchema(open, { $id: "https://awsf.local/schemas/awsf.example/v1", title: "Open", description: "Filled" });
  assert.equal(emitted["$id"], "https://awsf.local/schemas/awsf.example/v1");
  assert.equal(emitted["title"], "Open");
  assert.equal(emitted["description"], "Filled");
  assert.equal(emitted["$schema"], "https://json-schema.org/draft/2020-12/schema");
});

test("the contracts emitters report the identity their schemas declare (B3-20)", () => {
  assert.equal(emitTicketJsonSchema()["$id"], "awsf.ticket/v1");
  assert.equal(emitShiftManifestJsonSchema()["$id"], "awsf.shift-manifest/v1");
});
