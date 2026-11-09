import assert from "node:assert/strict";
import { test } from "node:test";

import { credentialSafeCommandOutput } from "../../../src/cli/commands/production-run.ts";

test("configured command output with credential-shaped data is rejected without echoing it", () => {
  const token = "gh" + "p_" + "a".repeat(36);
  assert.equal(credentialSafeCommandOutput("ordinary gate output"), "ordinary gate output");
  assert.throws(
    () => credentialSafeCommandOutput(`gate output: ${token}`),
    (error: Error) => {
      assert.match(error.message, /credential-shaped data/u);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
});
