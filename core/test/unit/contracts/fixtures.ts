import type {
  BuildOutput,
  DocumentOutput,
  PlanOutput,
  ReviewOutput,
  ScoutOutput,
  TestOutput,
} from "../../../src/contracts/index.ts";

const SHA_A = "a".repeat(40);

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

/** Every envelope fixture, keyed by schema id — so suites can iterate all six uniformly. */
export const VALID_ENVELOPES = {
  "awsf.plan-output/v1": validPlanOutput,
  "awsf.build-output/v1": validBuildOutput,
  "awsf.test-output/v1": validTestOutput,
  "awsf.review-output/v1": validReviewOutput,
  "awsf.document-output/v1": validDocumentOutput,
  "awsf.scout-output/v1": validScoutOutput,
} as const;
