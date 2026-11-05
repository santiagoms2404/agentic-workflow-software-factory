import assert from "node:assert/strict";
import { test } from "node:test";

import { outputOwnershipCheck } from "../../../src/workflow/output-ownership.ts";
import { validDocumentOutput } from "../contracts/fixtures.ts";

// B6-35: the ownership table was indexed with a plain property read, so a phase
// id that names an Object.prototype member returned that member instead of the
// no-declaration refusal. `constructor` then threw a TypeError on `.outputs`.
for (const phaseId of ["constructor", "toString", "__proto__"]) {
  test(`B6-35: phase ${phaseId} has no ownership declaration, not an inherited one`, () => {
    const check = outputOwnershipCheck(phaseId, { ...validDocumentOutput(), artifacts: [] });
    assert.equal(check.ok, false);
    assert.equal(check.note, `phase ${JSON.stringify(phaseId)} has no ownership declaration`);
  });
}
