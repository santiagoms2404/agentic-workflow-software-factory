import assert from "node:assert/strict";
import { test } from "node:test";
import { BuildOutputSchema } from "../../../src/contracts/build-output.ts";
import { OUTPUT_SCHEMA_PLACEHOLDER, PREVIOUS_ENVELOPE_PLACEHOLDER } from "../../../src/contracts/json-schema.ts";
import {
  InvalidPhaseDescription,
  MissingPreviousEnvelopePlaceholder,
  compilePhase,
  compileWorkflow,
} from "../../../src/workflow/compiler.ts";
import { PhaseExecution, type AgentPhaseDefinition } from "../../../src/workflow/phase.ts";

function phase(overrides: Partial<AgentPhaseDefinition> = {}): AgentPhaseDefinition {
  return {
    id: "builder",
    kind: "agent",
    owner: "build-agent",
    description: "Implement the accepted change and report host-observable evidence",
    schemaId: "awsf.build-output/v1",
    outputSchema: BuildOutputSchema,
    maxCorrections: 1,
    gates: [],
    prompt: `Prior output:\n${PREVIOUS_ENVELOPE_PLACEHOLDER}\n\n${OUTPUT_SCHEMA_PLACEHOLDER}`,
    ...overrides,
  };
}

test("earned descriptions reject blank and normalized name restatements at compilation", () => {
  assert.throws(() => compilePhase(phase({ description: "   " })), InvalidPhaseDescription);
  assert.throws(
    () => compilePhase(phase({ id: "commit_plan", description: "Commit the plan" })),
    (error: Error) => error instanceof InvalidPhaseDescription && error.message.includes("restates"),
  );
});

test("phase success must be earned through validation and abnormal exits fail", () => {
  const successful = new PhaseExecution("builder");
  assert.throws(() => successful.succeed(), /not earned/);
  successful.running();
  successful.validating();
  successful.succeed();
  assert.equal(successful.state, "SUCCEEDED");

  const abnormal = new PhaseExecution("reviewer");
  abnormal.running();
  abnormal.fail();
  assert.equal(abnormal.state, "FAILED");
});

test("agent compilation injects TypeBox JSON Schema and host-renders previous envelope", () => {
  const compiled = compilePhase(phase());
  assert.equal(compiled.kind, "agent");
  if (compiled.kind !== "agent") return;
  const previous = {
    schema: "awsf.build-output/v1",
    producerStatus: "success" as const,
    summary: "prior",
    artifacts: [],
    notesForNextPhase: "none",
  };
  const prompt = compiled.renderPrompt(previous);
  assert.ok(prompt.includes('"$id": "https://awsf.local/schemas/awsf.build-output/v1"'));
  assert.ok(prompt.includes('"producerStatus"'));
  assert.ok(prompt.includes('"summary": "prior"'));
  assert.ok(!prompt.includes(OUTPUT_SCHEMA_PLACEHOLDER));
  assert.ok(!prompt.includes(PREVIOUS_ENVELOPE_PLACEHOLDER));

  const noHandoff = compilePhase(phase({ prompt: OUTPUT_SCHEMA_PLACEHOLDER }));
  if (noHandoff.kind !== "agent") throw new Error("expected agent phase");
  assert.throws(() => noHandoff.renderPrompt(previous), MissingPreviousEnvelopePlaceholder);
});

test("workflow admission counts only agent calls and rejects a recipe above its tier", () => {
  const local = {
    ...phase({ id: "tests", description: "Run the configured quality command against the candidate" }),
    kind: "code" as const,
    execute: async () => ({
      schema: "awsf.build-output/v1" as const,
      producerStatus: "success" as const,
      summary: "host",
      artifacts: [],
      notesForNextPhase: "",
      changedFiles: [],
      implementationNotes: [],
      commandsRun: [],
      proposedCommitMessage: "test: host output",
    }),
  };
  const compiled = compileWorkflow({ id: "one-call", phases: [phase(), local] }, 0);
  assert.equal(compiled.minimumCalls, 1);
  assert.throws(
    () => compileWorkflow({ id: "two-calls", phases: [phase(), phase({ id: "reviewer", description: "Audit the candidate against its acceptance criteria" })] }, 0),
    /calls are already committed/i,
  );
});
