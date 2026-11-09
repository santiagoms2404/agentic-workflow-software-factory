import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkflow } from "../../../src/workflow/recipes/build.ts";
import { loadUserPrompt } from "../../../src/workflow/recipe-support.ts";

// B6-28: the shipped recipes read their prompt files while the object literals
// were evaluated, so importing the catalog read them even though production
// replaces every prompt with the configured text. The prompt is now an accessor,
// so nothing is read until a caller asks for it.
test("B6-28: a shipped recipe's prompt is a lazy accessor, so importing the catalog reads no prompt file", () => {
  const builder = buildWorkflow.phases.find((phase) => phase.id === "builder") as { prompt?: string } | undefined;
  assert.ok(builder, "the build recipe has a builder phase");
  const descriptor = Object.getOwnPropertyDescriptor(builder, "prompt");
  assert.equal(typeof descriptor?.get, "function", "the prompt is read on access, not when the literal is evaluated");
  assert.equal(builder.prompt, loadUserPrompt("builder"), "the value is unchanged for callers that read it");
});
