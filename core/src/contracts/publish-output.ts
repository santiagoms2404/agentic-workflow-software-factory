import { Type, type Static } from "@sinclair/typebox";
import { PUBLISH_OUTCOMES } from "../publish/argv.ts";
import { phaseEnvelope } from "./envelope-base.ts";
import { CandidateSeedSchema } from "./candidate-seed.ts";
import { PhaseRecoverySchema } from "./phase-recovery.ts";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion } from "./typebox.ts";

export const PUBLISH_OUTPUT_SCHEMA_ID = "awsf.publish-output/v1";
export const PUBLISH_OUTPUT_KIND = "host command result — the terminal lines the command wrote, plus its PublishCommandResult";

const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const NullableShaSchema = Type.Union([Type.String({ pattern: SHA_PATTERN }), Type.Null()]);

const BudgetSchema = Type.Object(
  {
    attempt: Type.Integer({ minimum: 1 }),
    callsSpent: Type.Integer({ minimum: 0 }),
    callsReserved: Type.Integer({ minimum: 0 }),
    correctionsAuto: Type.Integer({ minimum: 0 }),
    correctionsOwner: Type.Integer({ minimum: 0 }),
    ownerReentries: Type.Integer({ minimum: 0 }),
    allowance: Type.Object(
      {
        auto: Type.Integer({ minimum: 0 }),
        owner: Type.Integer({ minimum: 0 }),
        ownerReentries: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    ceiling: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const CeilingGrantSchema = Type.Object(
  {
    calls: Type.Integer({ minimum: 1 }),
    ceiling: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
    at: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const LandingApprovalSchema = Type.Object(
  {
    candidateSha: Type.String({ pattern: SHA_PATTERN }),
    summary: Type.String({ minLength: 1 }),
    approvedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const BlockerSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    detail: Type.String({ minLength: 1 }),
    ahead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    behind: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

const PhaseMeterSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 }),
    round: Type.Integer({ minimum: 0 }),
    maximumRounds: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PublishedAttemptStatusSchema = Type.Object(
  {
    schema: Type.Literal("awsf/attempt-status/v1"),
    sessionId: Type.String({ minLength: 1 }),
    project: Type.String({ minLength: 1 }),
    taskId: Type.String({ minLength: 1 }),
    continuesTask: NullableStringSchema,
    seed: Type.Optional(Type.Union([CandidateSeedSchema, Type.Null()])),
    recovery: Type.Optional(Type.Union([PhaseRecoverySchema, Type.Null()])),
    activeOperation: Type.Optional(NullableStringSchema),
    attempt: Type.Integer({ minimum: 1 }),
    repository: Type.String({ minLength: 1 }),
    worktree: NullableStringSchema,
    workflow: Type.String({ minLength: 1 }),
    tier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    request: Type.String({ minLength: 1 }),
    configSnapshotJson: Type.String(),
    lifecycleState: Type.Literal("PUBLISHED"),
    baseSha: NullableShaSchema,
    candidateSha: NullableShaSchema,
    phase: Type.Union([PhaseMeterSchema, Type.Null()]),
    budget: BudgetSchema,
    ceilingGrants: Type.Array(CeilingGrantSchema),
    model: Type.Union([
      Type.Object(
        {
          resolved: Type.String({ minLength: 1 }),
          provenance: stringUnion(["stream-authoritative", "route-attributed", "unknown"] as const),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    lastActivityAt: Type.String({ minLength: 1 }),
    lastActivity: Type.String({ minLength: 1 }),
    nextAction: Type.String({ minLength: 1 }),
    gatesPass: Type.Boolean(),
    requiredReviewPresent: Type.Boolean(),
    journeyApproved: Type.Boolean(),
    protectedApprovalsValid: Type.Boolean(),
    process: Type.Null(),
    landingApproval: Type.Union([LandingApprovalSchema, Type.Null()]),
    blocker: Type.Union([BlockerSchema, Type.Null()]),
    revision: Type.Integer({ minimum: 1 }),
    lastSourceSeq: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const PublishResultSchema = Type.Object(
  {
    outcome: Type.Literal("published"),
    status: PublishedAttemptStatusSchema,
    outcomes: Type.Array(stringUnion(PUBLISH_OUTCOMES)),
  },
  { additionalProperties: false },
);

export const PublishOutputSchema = phaseEnvelope(
  PUBLISH_OUTPUT_SCHEMA_ID,
  {
    kind: Type.Literal(PUBLISH_OUTPUT_KIND),
    terminalLines: Type.Array(Type.String(), { minItems: 1 }),
    result: PublishResultSchema,
    finalStatusBytes: Type.String({ minLength: 1 }),
  },
  "Validated result stored by the awsf publish host command inside the published attempt.",
);

export type PublishOutput = Static<typeof PublishOutputSchema>;
