// The shadow owner's runner step (W19 task 5, DD5).
//
// Whenever a run stops: build the stop facts, ask stop-judgment through
// decide(), run the shadow policy, and append one delegate.proposal to the
// task's delegate.jsonl, whether or not a lease exists. Typed unavailable,
// refused or contract-error outcomes still record a proposal; failures to
// validate or durably append a decision propagate rather than misstate its audit record.
//
// It executes nothing, and it never changes lifecycle state, the ceiling or a
// checkpoint: it only reads the attempt and appends to two task-scoped files.

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readAttempt, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { JevTransport } from "../decision/jev-transport.ts";
import { readJevProjectSwitch } from "../decision/jev-project.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { scanJournal } from "../persistence/replay.ts";
import { appendTaskDelegateProposal, readTaskDelegateProposals } from "../persistence/task-delegate.ts";
import type { DecisionRecord } from "../contracts/decision-record.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { allowedActsFor, proposeAct, type JudgmentInput, type PhaseRoles, type PolicyLease, type Proposal, type QuotaPlan } from "./policy.ts";
import { DELEGATE_PROPOSAL_SCHEMA_ID, DELEGATE_PROPOSAL_TYPE, type DelegateProposalRecord } from "./proposal.ts";
import { buildStopFacts, type StopFacts, type StopFactsConfig } from "./stop-facts.ts";
import { judgeStop } from "./stop-judge.ts";

export interface ShadowInput {
  readonly attemptDir: string;
  /** The compiled phases and their roles (`stopFactsPhases` in production-run.ts). */
  readonly phases: () => Promise<{ readonly config: StopFactsConfig; readonly roles: PhaseRoles }>;
  /** The transport to ask; defaults to one built from the project switch and `env`. */
  readonly transport?: Pick<JevTransport, "ask">;
  /** Where the project switch is read when no transport is given; defaults to the attempt repository's awsf.project.yaml. */
  readonly catalogPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly quotaPlan?: QuotaPlan;
  readonly lease?: PolicyLease;
  readonly projectDecision?: (record: DecisionRecord) => void;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export type ShadowOutcome =
  | { readonly recorded: false; readonly reason: "not-at-stop" | "already-recorded" }
  | { readonly recorded: true; readonly record: DelegateProposalRecord };

async function attemptRecords(attemptDir: string): Promise<JournalRecord<AttemptEvent>[]> {
  const scanned = await scanJournal<AttemptEvent>(journalFilePath(attemptDir));
  if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey}`);
  return [...scanned.records];
}

function alreadyRecorded(existing: readonly DelegateProposalRecord[], status: AttemptStatus): boolean {
  return existing.some((record) => record.sessionId === status.sessionId && record.statusRevision === status.revision);
}

/**
 * Returns the deterministic proposal when policy does not consult Jev
 * judgment (DD5: Jev only refines judgment). Returns null when stop-judgment
 * is actually needed.
 */
function deterministicProposal(
  facts: StopFacts,
  config: StopFactsConfig,
  roles: PhaseRoles,
  quotaPlan?: QuotaPlan,
  lease?: PolicyLease,
): Proposal | null {
  try {
    return proposeAct({
      facts,
      judgment: null as unknown as JudgmentInput,
      config,
      roles,
      ...(quotaPlan === undefined ? {} : { quotaPlan }),
      ...(lease === undefined ? {} : { lease }),
    });
  } catch {
    return null;
  }
}

/** Records the shadow proposal for the stop the attempt is at, once per stop. */
export async function recordShadowProposal(input: ShadowInput): Promise<ShadowOutcome> {
  const status = await readAttempt(input.attemptDir);
  const records = await attemptRecords(input.attemptDir);
  const { config, roles } = await input.phases();
  const facts = buildStopFacts(status, records, config);
  if (facts === null) return { recorded: false, reason: "not-at-stop" };
  const taskRoot = dirname(input.attemptDir);
  if (alreadyRecorded(await readTaskDelegateProposals(taskRoot), status)) return { recorded: false, reason: "already-recorded" };

  const allowedActs = allowedActsFor(facts, input.lease);
  let proposal: Proposal | null = deterministicProposal(facts, config, roles, input.quotaPlan, input.lease);
  let decision: DelegateProposalRecord["decision"] = { recordId: null, outcome: "not-consulted" };

  if (proposal === null && allowedActs.length > 0) {
    const switchRead = await readJevProjectSwitch(input.catalogPath ?? join(status.repository, "awsf.project.yaml"));
    const transport = input.transport ?? new JevTransport({
      projectSwitch: switchRead.value,
      env: input.env ?? {},
    });
    const judged = await judgeStop(facts, {
      transport,
      taskRoot,
      caller: "stop",
      allowedActs,
      ...(input.projectDecision === undefined ? {} : { projectDecision: input.projectDecision }),
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.newId === undefined ? {} : { newId: input.newId }),
    });
    decision = judged.decision;
    proposal = proposeAct({
      facts, judgment: judged.judgment, config, roles,
      ...(input.quotaPlan === undefined ? {} : { quotaPlan: input.quotaPlan }),
      ...(input.lease === undefined ? {} : { lease: input.lease }),
    });
  } else if (proposal === null) {
    proposal = proposeAct({
      facts,
      judgment: { outcome: "numbers-only", result: null },
      config,
      roles,
      ...(input.quotaPlan === undefined ? {} : { quotaPlan: input.quotaPlan }),
      ...(input.lease === undefined ? {} : { lease: input.lease }),
    });
  }

  const record: DelegateProposalRecord = {
    schema: DELEGATE_PROPOSAL_SCHEMA_ID,
    type: DELEGATE_PROPOSAL_TYPE,
    id: (input.newId ?? randomUUID)(),
    project: status.project,
    taskId: status.taskId,
    attempt: status.attempt,
    sessionId: status.sessionId,
    statusRevision: status.revision,
    at: (input.now ?? (() => new Date().toISOString()))(),
    stopKind: facts.stopKind,
    edge: facts.edge,
    checkpointId: facts.checkpointId,
    leased: input.lease !== undefined,
    decision,
    proposal: { act: proposal.act, rationale: proposal.rationale, executable: proposal.executable },
    allowedActs: [...allowedActs],
    facts,
  };
  if (alreadyRecorded(await readTaskDelegateProposals(taskRoot), status)) return { recorded: false, reason: "already-recorded" };
  await appendTaskDelegateProposal(taskRoot, record);
  return { recorded: true, record };
}
