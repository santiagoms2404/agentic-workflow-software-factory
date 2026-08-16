import type {
  BuildOutput,
  DocumentOutput,
  IntakeOutput,
  PlanOutput,
  ReviewContext,
  ReviewOutput,
  ScoutOutput,
  TestOutput,
} from "../../../src/contracts/index.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

export function validPlanOutput(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "Plan the envelope contracts.",
    artifacts: [{ path: "docs/plan.md", kind: "plan", description: "The written plan." }],
    notesForNextPhase: "Start with envelope-base.ts.",
    goals: ["One schema definition per envelope."],
    nonGoals: ["A second YAML workflow format."],
    implementationSteps: [
      {
        id: "S1",
        title: "Define EnvelopeBase",
        files: ["core/src/contracts/envelope-base.ts"],
        acceptanceCriteria: ["Unknown fields are rejected."],
      },
    ],
    testStrategy: ["Unit tests under core/test/unit/contracts/."],
    risks: [{ risk: "Schema drift", mitigation: "Emit from one definition." }],
    openQuestions: [],
  };
}

export function validBuildOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "Implemented the contracts directory.",
    artifacts: [{ path: "core/src/contracts/index.ts", kind: "source", description: "Barrel module." }],
    notesForNextPhase: "Run the unit suite.",
    changedFiles: ["core/src/contracts/index.ts"],
    implementationNotes: ["Used TypeBox composition rather than $ref."],
    commandsRun: [{ argv: ["npm", "run", "test:unit"], exitCode: 0 }],
    proposedCommitMessage: "T3: envelope and event contracts",
  };
}

export function validTestOutput(): TestOutput {
  return {
    schema: "awsf.test-output/v1",
    producerStatus: "success",
    summary: "All unit tests passed.",
    artifacts: [],
    notesForNextPhase: "",
    passed: true,
    candidateSha: SHA_A,
    commands: [
      {
        gateId: "test",
        argv: ["npm", "run", "test:unit"],
        exitCode: 0,
        durationMs: 4210,
        outputRef: "attempt://1/gates/test.log",
      },
    ],
    failures: [],
    outputTail: "",
  };
}

export function validReviewOutput(): ReviewOutput {
  return {
    schema: "awsf.review-output/v1",
    producerStatus: "success",
    summary: "Reviewed the contracts change.",
    artifacts: [],
    notesForNextPhase: "",
    verdict: "concern",
    reviewedSha: SHA_A,
    findings: [
      {
        id: "F1",
        severity: "medium",
        file: "core/src/contracts/parse-envelope.ts",
        line: 42,
        title: "Outermost-object scan is not brace-balanced",
        detail: "A trailing prose brace would widen the slice.",
        evidence: "trimmed.lastIndexOf('}')",
      },
    ],
    limitations: ["Did not execute the test suite."],
  };
}

export function validReviewContext(): ReviewContext {
  return {
    schema: "awsf.review-context/v1",
    producerStatus: "success",
    summary: "Candidate against base: 1 file, +2/-1.",
    artifacts: [],
    notesForNextPhase: "Judge this candidate against the recorded request.",
    request: "Reject unknown envelope fields at every depth.",
    goals: ["Unknown fields are rejected."],
    nonGoals: ["A second YAML workflow format."],
    acceptanceCriteria: ["Unknown fields are rejected at every depth."],
    testStrategy: ["Unit tests under core/test/unit/contracts/."],
    baseSha: SHA_B,
    candidateSha: SHA_A,
    changedFiles: ["core/src/contracts/index.ts"],
    insertions: 2,
    deletions: 1,
    stat: " core/src/contracts/index.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)\n",
    diff: [
      "diff --git a/core/src/contracts/index.ts b/core/src/contracts/index.ts",
      "--- a/core/src/contracts/index.ts",
      "+++ b/core/src/contracts/index.ts",
      "@@ -1,2 +1,3 @@",
      " export * from \"./typebox.ts\";",
      "-export * from \"./old.ts\";",
      "+export * from \"./envelope-base.ts\";",
      "+export * from \"./registry.ts\";",
      "",
    ].join("\n"),
    diffTruncated: false,
    diffOmittedChars: 0,
    diffOmittedFiles: [],
    diffSha256: "c".repeat(64),
    diffRef: `raw/review-context-${SHA_A}.diff`,
    testOutput: validTestOutput(),
  };
}

export function validDocumentOutput(): DocumentOutput {
  return {
    schema: "awsf.document-output/v1",
    producerStatus: "success",
    summary: "Documented the contracts directory.",
    artifacts: [{ path: "README.md", kind: "documentation", description: "Updated overview." }],
    notesForNextPhase: "",
    changedFiles: ["README.md"],
    documentedAreas: [{ subject: "contracts", documentPath: "README.md" }],
    proposedCommitMessage: "docs: describe the envelope contracts",
  };
}

export function validScoutOutput(): ScoutOutput {
  return {
    schema: "awsf.scout-output/v1",
    producerStatus: "success",
    summary: "Surveyed the config loader.",
    artifacts: [],
    notesForNextPhase: "Reuse the credential patterns.",
    findings: [{ file: "core/src/config/load.ts", note: "Holds the credential-shaped pattern set." }],
  };
}

export function validIntakeOutput(): IntakeOutput {
  return {
    schema: "awsf.intake-output/v1",
    producerStatus: "success",
    summary: "Refined one bounded ticket.",
    artifacts: [{ path: "specs/tickets/T32.md", kind: "documentation", description: "The validated ticket." }],
    notesForNextPhase: "Inspect the ticket candidate before landing.",
    ticket: {
      id: "T32",
      title: "The intake recipe and awsf ticket",
      milestone: "M9",
      tier: 1,
      state: "todo",
      depends_on: ["T31"],
      workflow: "plan-build-test",
      outcome: "Vague intent becomes one validated ticket.",
      context: ["The file-backed ticket store already exists."],
      acceptance: ["The generated ticket validates against TicketSchema."],
      non_goals: ["A dashboard backlog."],
    },
  };
}

/** Every envelope fixture, keyed by schema id — so suites can iterate all eight uniformly. */
export const VALID_ENVELOPES = {
  "awsf.plan-output/v1": validPlanOutput,
  "awsf.build-output/v1": validBuildOutput,
  "awsf.test-output/v1": validTestOutput,
  "awsf.review-output/v1": validReviewOutput,
  "awsf.review-context/v1": validReviewContext,
  "awsf.document-output/v1": validDocumentOutput,
  "awsf.scout-output/v1": validScoutOutput,
  "awsf.intake-output/v1": validIntakeOutput,
} as const;
