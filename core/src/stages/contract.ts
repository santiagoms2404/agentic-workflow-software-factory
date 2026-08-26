// The five observed stages and the facts that define each.
//
// This file says WHAT each stage is, never HOW to run one. Every field is a
// value already captured by the ladder run; this layer never reads a fixture,
// touches I/O, or goes and looks.

import { ENVELOPE_SCHEMAS } from "../contracts/registry.ts";

export const STAGE_ORDER = [
  "init",
  "project-register",
  "design-to-plan",
  "build",
  "publish",
] as const;

export type StageId = (typeof STAGE_ORDER)[number];
type EnvelopeSchemaId = keyof typeof ENVELOPE_SCHEMAS;

interface StageFacts {
  readonly id: StageId;
  readonly ordinal: number;
  readonly owner: string;
  readonly producer: string;
  readonly granularity: string;
  readonly entryPrecondition: string;
}

export type StageRecord = StageFacts & (
  | {
    readonly blocked: false;
    readonly schemaId: EnvelopeSchemaId;
  }
  | {
    readonly blocked: true;
    readonly schemaId?: never;
  }
);

export const STAGES = [
  {
    id: "init",
    ordinal: 1,
    owner: "host",
    producer: "awsf init",
    granularity: "command",
    entryPrecondition: "The target path is an empty directory or does not exist yet.",
    blocked: true,
  },
  {
    id: "project-register",
    ordinal: 2,
    owner: "host",
    producer: "awsf project register",
    granularity: "command",
    entryPrecondition: "An awsf.project.yaml catalog exists and names this project's slug; every repository id the catalog declares receives an explicit --repository <id>=<absolute-path>; no placement is already registered for the slug.",
    blocked: true,
  },
  {
    id: "design-to-plan",
    ordinal: 3,
    owner: "host",
    producer: "design-to-plan",
    granularity: "task",
    entryPrecondition: "S2's placement exists for the slug; the loaded config's workflows.enabled includes design-to-plan; the config declares designer, architecture-reviewer and planner on an adapter the host can build; each role's system prompt resolves relative to the config path; the attempt worktree is inside the worktreeRoot the placement resolves to.",
    blocked: false,
    schemaId: "awsf.document-output/v1",
  },
  {
    id: "build",
    ordinal: 4,
    owner: "host",
    producer: "plan-build-test",
    granularity: "task",
    entryPrecondition: "S3's rendered plan and tickets are on the repository's default branch (the owner ran `awsf land`); the same registry, config, prompt and worktree preconditions as S3.",
    blocked: false,
    schemaId: "awsf.test-output/v1",
  },
  {
    id: "publish",
    ordinal: 5,
    owner: "host",
    producer: "awsf publish",
    granularity: "command",
    entryPrecondition: "The attempt is LANDED; the catalog declares a publish block for the resolved repository; the named remote and branch are both allowlisted there; HEAD is at the candidate; the checkout is clean; the update is a fast-forward or a branch creation.",
    blocked: true,
  },
] as const satisfies readonly StageRecord[];
