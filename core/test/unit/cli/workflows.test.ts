import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { loadConfig } from "../../../src/config/load.ts";
import { correctionHeadroom, selectWorkflow, workflowsCommand } from "../../../src/cli/commands/workflows.ts";
import { correctionsFundableFor, workflowRecipe } from "../../../src/workflow/catalog.ts";
import { callCeilingsOf } from "../../../src/state/tiers.ts";

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

test("every row states its correction headroom, and a zero says so in words", () => {
  const lines = workflowsCommand(config);
  for (const id of config.workflows.enabled) {
    const row = lines.find((line) => line.startsWith(`${id}:`)) ?? "";
    assert.match(row, /corrections fundable: (?:-?\d+ \(none\)|[1-9]\d*)/u, id);
  }
  // The three routes that cannot pay for the round they declare. These are the
  // measured numbers, not a restatement of the formula: `ceiling − minimumCalls`
  // is 0 on each, and every agent on them is `continuity: none`.
  for (const id of ["scout", "plan", "design-to-plan"]) {
    assert.match(lines.find((line) => line.startsWith(`${id}:`)) ?? "", /corrections fundable: 0 \(none\)/u, id);
  }
  assert.match(lines.find((line) => line.startsWith("simple-sdlc:")) ?? "", /corrections fundable: 1 —/u);
  assert.match(lines.find((line) => line.startsWith("build-review:")) ?? "", /corrections fundable: 3 —/u);
});

test("correction headroom reads continuity, so a warm route needs no spare call", () => {
  const scout = workflowRecipe("scout")!;
  const intake = workflowRecipe("intake")!;
  assert.equal(correctionsFundableFor(scout, callCeilingsOf(config.risk.call_ceiling)), 0);
  assert.equal(correctionsFundableFor(intake, callCeilingsOf(config.risk.call_ceiling)), 0);

  // Same zero headroom, opposite verdict: `intake` re-asks inside the call it
  // already bought, so its declared round costs nothing extra.
  assert.equal(correctionHeadroom(config, scout).unfundable, true);
  assert.equal(correctionHeadroom(config, intake).unfundable, false);
  assert.deepEqual([...correctionHeadroom(config, scout).coldCorrectingPhases], ["scout"]);
  assert.equal(correctionHeadroom(config, scout).callsNeeded, 1);

  // One granted call lifts it, which is what the start refusal names.
  assert.equal(correctionHeadroom(config, scout, 2).unfundable, false);
  assert.equal(correctionHeadroom(config, scout, 2).fundable, 1);
});
