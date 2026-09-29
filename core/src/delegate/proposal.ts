// delegate.proposal: the record the shadow owner leaves at every stop
// (W19 task 5, DD5). One line per stop in the task's delegate.jsonl, lease or
// not. It is a record of what the Delegate would have done. Nothing reads it
// to act; tasks 6 and 11 read it to measure agreement and to drive.

import { PROPOSED_ACT_NAMES, RATIONALE_CODES, type ProposedAct, type RationaleCode } from "./policy.ts";
import { STOP_KINDS, type StopFacts, type StopKind } from "./stop-facts.ts";

export const DELEGATE_PROPOSAL_TYPE = "delegate.proposal";
export const DELEGATE_PROPOSAL_SCHEMA_ID = "awsf.delegate-proposal/v1";

export interface DelegateProposalRecord {
  readonly schema: typeof DELEGATE_PROPOSAL_SCHEMA_ID;
  readonly type: typeof DELEGATE_PROPOSAL_TYPE;
  readonly id: string;
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly sessionId: string;
  /** The attempt status revision the stop was read at; one proposal per stop. */
  readonly statusRevision: number;
  readonly at: string;
  readonly stopKind: StopKind;
  readonly edge: string | null;
  readonly checkpointId: string | null;
  /** Task 9 adds leases. Until then every proposal is recorded without one. */
  readonly leased: boolean;
  /** The stop-judgment call behind the proposal, or null when none was journaled. */
  readonly decision: { readonly recordId: string | null; readonly outcome: string };
  readonly proposal: {
    readonly act: ProposedAct;
    readonly rationale: RationaleCode;
    readonly executable: boolean;
  };
  readonly allowedActs: readonly string[];
  readonly facts: StopFacts;
}

function fail(detail: string): never {
  throw new Error(`delegate proposal record is invalid: ${detail}`);
}

export function assertDelegateProposal(value: unknown): asserts value is DelegateProposalRecord {
  if (typeof value !== "object" || value === null) fail("not an object");
  const record = value as Record<string, unknown>;
  if (record.schema !== DELEGATE_PROPOSAL_SCHEMA_ID || record.type !== DELEGATE_PROPOSAL_TYPE) fail("schema or type");
  for (const key of ["id", "project", "taskId", "sessionId", "at"] as const) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) fail(key);
  }
  if (!Number.isInteger(record.attempt) || !Number.isInteger(record.statusRevision)) fail("attempt or statusRevision");
  if (!(STOP_KINDS as readonly unknown[]).includes(record.stopKind)) fail("stopKind");
  if (typeof record.leased !== "boolean") fail("leased");
  const proposal = record.proposal as Record<string, unknown> | undefined;
  const act = proposal?.act as Record<string, unknown> | undefined;
  if (proposal === undefined || act === undefined || !(PROPOSED_ACT_NAMES as readonly unknown[]).includes(act.act)) fail("proposal.act");
  if (!(RATIONALE_CODES as readonly unknown[]).includes(proposal.rationale)) fail("proposal.rationale");
  // INV-3: no record may claim land-shadow or wait-for-owner is executable.
  if (typeof proposal.executable !== "boolean" || (proposal.executable && (act.act === "land-shadow" || act.act === "wait-for-owner"))) {
    fail("proposal.executable");
  }
  if (!Array.isArray(record.allowedActs) || typeof record.facts !== "object" || record.facts === null) fail("allowedActs or facts");
}
