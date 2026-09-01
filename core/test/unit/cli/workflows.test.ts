import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { loadConfig } from "../../../src/config/load.ts";
import { selectWorkflow, workflowsCommand } from "../../../src/cli/commands/workflows.ts";

const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));

test("workflows reports every enabled recipe from the live catalogue", () => {
  const lines = workflowsCommand(config);
  assert.match(lines[0] ?? "", /^Tier ceilings: T0=/);
  for (const id of config.workflows.enabled) {
    assert.equal(lines.filter((line) => line.startsWith(`${id}:`)).length, 1, id);
  }
  assert.match(lines.find((line) => line.startsWith("simple-sdlc:")) ?? "", /T2, 4 provider call\(s\), ceiling 5/);
  assert.match(lines.find((line) => line.startsWith("simple-sdlc:")) ?? "", /planner\[agent:planner\].*reviewer\[agent:reviewer\]/);
});

test("workflow selection adopts the recipe tier and rejects unknown, disabled, or mismatched choices", () => {
  assert.deepEqual(selectWorkflow(config, "build"), { workflow: "build", tier: 1 });
  assert.deepEqual(selectWorkflow(config, "simple-sdlc", "T2"), { workflow: "simple-sdlc", tier: 2 });
  assert.throws(() => selectWorkflow(config, "simple-sdlc", "1"), /requires --tier T2; got T1/);
  assert.throws(() => selectWorkflow(config, "missing", undefined), /no shipped recipe/);
  assert.throws(
    () => selectWorkflow({ ...config, workflows: { enabled: ["build"] } }, "simple-sdlc"),
    /is not enabled/,
  );
});
