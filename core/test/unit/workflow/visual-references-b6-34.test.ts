import assert from "node:assert/strict";
import { test } from "node:test";

import { assertVisualRoute, VisualReferenceRefused } from "../../../src/workflow/visual-references.ts";

function refusal(adapterId: string, requestedModel: string): unknown {
  try {
    assertVisualRoute({
      phaseId: "builder",
      adapterId,
      model: { supportsImages: true, requestedModel },
      profile: "readonly",
      tools: ["read"],
    });
  } catch (error) {
    return error;
  }
  return null;
}

// B6-34: the demonstrated-route table was read with plain property lookups, so
// Object.prototype names counted as measured routes and passed the check.
for (const selector of ["toString", "constructor", "valueOf"]) {
  test(`B6-34: model selector ${selector} is an unsupported route, not an inherited measurement`, () => {
    const error = refusal("claude-code", selector);
    assert.ok(error instanceof VisualReferenceRefused, `expected a refusal, got ${String(error)}`);
    assert.equal(error.code, "route-unsupported");
  });
}

test("B6-34: an inherited adapter name cannot supply a demonstrated model", () => {
  // Object.prototype.constructor is Object, so Object.name is a value; the adapter level must be own too.
  const error = refusal("constructor", "name");
  assert.ok(error instanceof VisualReferenceRefused, `expected a refusal, got ${String(error)}`);
  assert.equal(error.code, "route-unsupported");
});

test("B6-34: a measured route is still admitted", () => {
  assert.equal(refusal("claude-code", "opus"), null);
});
