import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../../src/config/load.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { evaluatePathPolicy } from "../../../src/policy/path-policy.ts";
import { InvalidPhaseDescription, compileWorkflow } from "../../../src/workflow/compiler.ts";
import { intakeWorkflow } from "../../../src/workflow/recipes/intake.ts";

function intakeAgent() {
  const config = loadConfig(readFileSync("awsf.config.yaml", "utf8"));
  const agent = config.agents.find((candidate) => candidate.name === "intake");
  assert.ok(agent);
  return agent;
}

test("intake is one T0 call and its Ticket schema is compiler-injected", () => {
  const compiled = compileWorkflow(intakeWorkflow, 0);
  assert.equal(compiled.minimumCalls, 1);
  const phase = compiled.phases[1];
  assert.equal(phase?.kind, "agent");
  if (phase?.kind !== "agent") return;
  assert.match(phase.promptTemplate, /"ticket"/);
  assert.match(phase.promptTemplate, /"acceptance"/);
  assert.doesNotMatch(phase.promptTemplate, /\{output_schema\}/);

  const secondAgent = { ...intakeWorkflow.phases[1]!, id: "second-intake", description: "Challenge the first ticket against its stated evidence" };
  assert.throws(() => compileWorkflow({ ...intakeWorkflow, phases: [...intakeWorkflow.phases, secondAgent] }, 0), /calls are already committed/i);
  assert.throws(
    () => compileWorkflow({ ...intakeWorkflow, phases: [intakeWorkflow.phases[0]!, { ...intakeWorkflow.phases[1]!, description: "The intake" }] }, 0),
    InvalidPhaseDescription,
  );
});

test("invalid intake output is retained as violations rather than accepted as a Ticket", () => {
  const parsed = parseEnvelope(JSON.stringify({
    schema: "awsf.intake-output/v1",
    producerStatus: "success",
    summary: "invalid ticket",
    artifacts: [],
    notesForNextPhase: "",
    ticket: { id: "not-an-id" },
  }), "awsf.intake-output/v1");
  assert.equal(parsed.valid, false);
  if (parsed.valid) return;
  assert.ok(parsed.violations.some((violation) => violation.path.startsWith("/ticket")));
});

test("T17 path policy, not prompt wording, confines intake to specs/tickets/**", () => {
  const agent = intakeAgent();
  assert.deepEqual(agent.writes, ["specs/tickets/**"]);
  assert.deepEqual(evaluatePathPolicy(["specs/tickets/T37.md"], { writes: agent.writes, protectedPaths: [] }), []);
  const violations = evaluatePathPolicy(["README.md", "core/src/a.ts"], { writes: agent.writes, protectedPaths: [] });
  assert.deepEqual(violations.map((violation) => violation.path), ["README.md", "core/src/a.ts"]);
});
