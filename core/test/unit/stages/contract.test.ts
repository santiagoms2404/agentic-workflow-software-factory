import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENVELOPE_SCHEMAS } from "../../../src/contracts/registry.ts";
import { STAGES, STAGE_ORDER } from "../../../src/stages/contract.ts";
import { repoRoot } from "../meta/_walk.ts";

interface FixtureStage {
  readonly id: string;
  readonly ordinal: number;
  readonly owner: string;
  readonly producer: string;
  readonly granularity: string;
  readonly entryPrecondition: string;
}

function fixtureStages(): readonly FixtureStage[] {
  const fixture = JSON.parse(readFileSync(`${repoRoot()}/core/test/fixtures/stages/stages.json`, "utf8")) as {
    stages: FixtureStage[];
  };
  return fixture.stages;
}

test("stage contract records equal the captured stage list in order", () => {
  const captured = fixtureStages().map((stage) => ({
    id: stage.id,
    ordinal: stage.ordinal,
    owner: stage.owner,
    producer: stage.producer,
    granularity: stage.granularity,
    entryPrecondition: stage.entryPrecondition,
  }));
  const contract = STAGES.map((stage) => ({
    id: stage.id,
    ordinal: stage.ordinal,
    owner: stage.owner,
    producer: stage.producer,
    granularity: stage.granularity,
    entryPrecondition: stage.entryPrecondition,
  }));

  assert.deepEqual(contract, captured);
});

test("stage order and schema ids agree with the captured contract", () => {
  const captured = fixtureStages();

  assert.equal(STAGE_ORDER.length, 5);
  assert.deepEqual(STAGE_ORDER, captured.map((stage) => stage.id));
  assert.deepEqual(STAGES.map((stage) => stage.ordinal), captured.map((stage) => stage.ordinal));
  for (const stage of STAGES) {
    if (!stage.blocked) assert.ok(Object.hasOwn(ENVELOPE_SCHEMAS, stage.schemaId));
  }
});
