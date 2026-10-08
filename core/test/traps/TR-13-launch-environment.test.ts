import assert from "node:assert/strict";
import { test } from "node:test";
import { launchEnvironmentRefusal } from "../fixtures/launch-environment.ts";
import { refusalAssertion } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-13 refusal assertion: first phase's shell PATH is not its launch PATH", async () => {
  assert.deepEqual(await launchEnvironmentRefusal(), ["claude"], refusalAssertion("TR-13"));
});

test("TR-13 refusal assertion: unavailable review refuses before the builder reserves", async () => {
  assert.deepEqual(await launchEnvironmentRefusal("build-review", "claude", "reviewer"), ["codex", "claude"], refusalAssertion("TR-13"));
});

test("TR-13 refusal assertion: the pi route also resolves before L4", async () => {
  assert.deepEqual(await launchEnvironmentRefusal("build-review", "codex", "builder"), ["codex"], refusalAssertion("TR-13"));
});

ownMutant({ id: "TR-13", file: import.meta.filename });
