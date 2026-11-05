import assert from "node:assert/strict";
import { test } from "node:test";
import { publicApiValue } from "../../../src/api/responses.ts";
import { REDACTED_VALUE } from "../../../src/policy/redaction.ts";

test("public API scrubbing removes private references and redacts in one detached projection", () => {
  const credential = `AK${"IA"}${"A".repeat(16)}`;
  const input = {
    visible: `request contained ${credential}`,
    configuration: { api_key: "not a recognized shape" },
    nested: [{ journal_path: "/private/journal", result: `Bearer ${"opaque".repeat(6)}` }],
  };

  const output = publicApiValue(input) as Record<string, unknown>;
  assert.deepEqual(output, {
    visible: `request contained ${REDACTED_VALUE}`,
    configuration: { api_key: REDACTED_VALUE },
    nested: [{ result: REDACTED_VALUE }],
  });
  assert.notEqual(output, input);
  assert.equal(Object.hasOwn(input.nested[0]!, "journal_path"), true);
  assert.equal(input.visible.includes(credential), true);
});
