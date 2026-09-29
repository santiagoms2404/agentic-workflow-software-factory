// The shadow owner's runner step (W19 task 5, DD5).
//
// Whenever a run stops: build the stop facts, ask stop-judgment through
// decide(), run the shadow policy, and append one delegate.proposal to the
// task's delegate.jsonl, whether or not a lease exists. An unavailable,
// refused or broken decision still records a proposal (wait-for-owner,
// jev-unavailable).
//
// It executes nothing, and it never changes lifecycle state, the ceiling or a
// checkpoint: it only reads the attempt and appends to two task-scoped files.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readAttempt, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { decide } from "../decision/decide.ts";
import { JevTransport } from "../decision/jev-transport.ts";
import { STOP_JUDGMENT } from "../decision/question-sets/stop-judgment.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { scanJournal } from "../persistence/replay.ts";
import { appendTaskDelegateProposal, readTaskDelegateProposals } from "../persistence/task-delegate.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { jevSwitchOf, type JevSwitch } from "../registry/catalog-schema.ts";
import type { DecisionRecord } from "../contracts/decision-record.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { allowedActsFor, proposeAct, type JudgmentInput, type PhaseRoles, type PolicyLease, type QuotaPlan } from "./policy.ts";
import { DELEGATE_PROPOSAL_SCHEMA_ID, DELEGATE_PROPOSAL_TYPE, type DelegateProposalRecord } from "./proposal.ts";
import { buildStopFacts, type StopFactsConfig } from "./stop-facts.ts";

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

/** A missing catalog is the switch's default ("on"); an unreadable or invalid one turns Jev off here. */
async function projectSwitch(catalogPath: string | undefined): Promise<JevSwitch> {
  if (catalogPath === undefined) return "on";
  let text: string;
  try {
    text = await readFile(catalogPath, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "on" : "off";
  }
  try {
    return jevSwitchOf(loadCatalog(text));
  } catch {
    return "off";
  }
}

async function attemptRecords(attemptDir: string): Promise<JournalRecord<AttemptEvent>[]> {
  const scanned = await scanJournal<AttemptEvent>(journalFilePath(attemptDir));
  if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey}`);
  return [...scanned.records];
}

function alreadyRecorded(existing: readonly DelegateProposalRecord[], status: AttemptStatus): boolean {
  return existing.some((record) => record.sessionId === status.sessionId && record.statusRevision === status.revision);
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
  const transport = input.transport ?? new JevTransport({
    projectSwitch: await projectSwitch(input.catalogPath ?? join(status.repository, "awsf.project.yaml")),
    ...(input.env === undefined ? {} : { env: input.env }),
  });
  let judgment: JudgmentInput;
  let decision: DelegateProposalRecord["decision"];
  try {
    const decided = await decide(STOP_JUDGMENT, { stop: facts }, {
      transport, taskRoot, project: status.project, taskId: status.taskId, attempt: status.attempt,
      caller: { kind: "stop", name: facts.stopKind }, params: { allowedActs },
      ...(input.projectDecision === undefined ? {} : { projectDecision: input.projectDecision }),
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.newId === undefined ? {} : { newId: input.newId }),
    });
    judgment = { outcome: decided.outcome, result: decided.policyResult };
    decision = { recordId: decided.recordId, outcome: decided.outcome };
  } catch {
    // A decision that could not even be journaled is still no answer: the stop waits for the owner.
    judgment = { outcome: "unavailable", result: null };
    decision = { recordId: null, outcome: "unavailable" };
  }

  const proposal = proposeAct({
    facts, judgment, config, roles,
    ...(input.quotaPlan === undefined ? {} : { quotaPlan: input.quotaPlan }),
    ...(input.lease === undefined ? {} : { lease: input.lease }),
  });
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
  await appendTaskDelegateProposal(taskRoot, record);
  return { recorded: true, record };
}
