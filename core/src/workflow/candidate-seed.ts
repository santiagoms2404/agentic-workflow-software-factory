import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { AwsfConfig } from "../config/schema.ts";
import { toConfigSnapshotJson } from "../config/effective-config.ts";
import { assertCandidateSeed, type CandidateSeed } from "../contracts/candidate-seed.ts";
import { CandidateAdoptionEvidenceSchema, type CandidateAdoptionEvidence, type ShiftAdoptionSource } from "../contracts/candidate-adoption.ts";
import { canonicalJson, sha256 } from "../contracts/owner-amendment.ts";
import type { AcceptedPhase } from "../contracts/phase-recovery.ts";
import type { ProcessIdentity } from "../execution/launcher-barrier.ts";
import { groupMembers } from "../execution/process-controller.ts";
import { noProtectedPaths, writesWithinGlobs } from "../gates/git-diff.ts";
import { riskTierSufficient } from "../gates/risk.ts";
import { assertClean, runGit, systemGitRunner } from "../git/changes.ts";
import { HOST_AUTHOR } from "../git/commit.ts";
import { IntegrationRefused, planIntegration, verifyIntegrationCommit } from "../git/integration.ts";
import type { AttemptEvidence } from "../observability/attempt-evidence.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { readAttempt, withLegacyDefaults, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { compiledWorkflow, workflowRecipe } from "./catalog.ts";
import type { WorkflowRecipe } from "./compiler.ts";
import { isCompiledWorkflowId } from "./compiled-ids.ts";
import { composePromptBundle } from "./prompt-composition.ts";
import { candidatePathsBetween } from "./review-evidence.ts";
import { bindShiftRecipeAt, shiftPhaseRole, shiftTicketOf } from "./shift/bind.ts";

export class CandidateSeedRejected extends Error {
  readonly detail: string;
  constructor(detail: string) { super(`candidate seed rejected: ${detail}`); this.name = "CandidateSeedRejected"; this.detail = detail; }
}
export type ProcessQuiescence = (identity: ProcessIdentity) => "quiescent" | "live" | "unknown";
export const observeQuiescence: ProcessQuiescence = (identity) => {
  if (identity.startIdentity === null) return "unknown";
  try { return groupMembers(identity).length === 0 ? "quiescent" : "live"; }
  catch { return "unknown"; }
};

/** Refuse stale/torn projections without repairing or writing a sealed source. */
export async function readVerifiedAttempt(dir: string) {
  const text = await readFile(join(dir, "journal.jsonl"), "utf8");
  if (!text.endsWith("\n")) throw new CandidateSeedRejected("journal has a torn tail");
  const records = text.trimEnd().split("\n").map((line) => JSON.parse(line) as JournalRecord<AttemptEvent>);
  const status = await readAttempt(dir);
  for (const [index, record] of records.entries()) {
    if (record.source_seq !== index + 1 || record.event?.next?.revision !== index + 1 || record.event.next.lastSourceSeq !== index + 1 ||
        record.event.next.sessionId !== status.sessionId || record.event.next.taskId !== status.taskId || record.event.next.project !== status.project || record.event.next.attempt !== status.attempt) {
      throw new CandidateSeedRejected("journal identity/revision chain is inconsistent");
    }
  }
  const final = records.at(-1)?.event.next;
  if (final === undefined || canonicalJson(withLegacyDefaults(final)) !== canonicalJson(status)) {
    throw new CandidateSeedRejected("status does not equal the final journal revision");
  }
  return { status, records, journalDigest: sha256(text) };
}

type AttemptRecords = readonly JournalRecord<AttemptEvent>[];
type ProcessEvidence = Extract<NonNullable<AttemptEvent["evidence"]>, { type: "process" }>;

/** Read a sealed attempt without writing it: exact path and identity, no writer, no unsettled call or process. */
async function readSealedAttempt(dir: string, repository: string, expected: { project: string; taskId: string; attempt: number }) {
  if (await realpath(dir) !== resolve(dir)) throw new CandidateSeedRejected("source attempt path contains a symlink");
  if (existsSync(join(dir, "attempt.lock"))) throw new CandidateSeedRejected("source has an unresolved writer lock");
  const read = await readVerifiedAttempt(dir);
  const source = read.status;
  if (source.project !== expected.project || source.taskId !== expected.taskId || source.attempt !== expected.attempt ||
      await realpath(source.repository) !== await realpath(repository)) throw new CandidateSeedRejected("source task/attempt/repository mismatch");
  if (source.lifecycleState !== "BLOCKED" && source.lifecycleState !== "CANCELLED") throw new CandidateSeedRejected("source is not sealed BLOCKED/CANCELLED");
  if (source.budget.callsReserved !== 0 || source.process !== null) throw new CandidateSeedRejected("source retains unsettled calls or a process");
  return read;
}

function processesOf(records: AttemptRecords): readonly ProcessEvidence[] {
  const processes = new Map<string, ProcessEvidence>();
  for (const record of records) {
    const evidence = record.event.evidence;
    if (evidence?.type === "process") processes.set(evidence.record.runId, evidence);
  }
  return [...processes.values()];
}

function settledCallsOf(processes: readonly ProcessEvidence[]): number {
  return new Set(processes.map((entry) => entry.record.reservationId)).size;
}

/**
 * The host-completed L7 binding: the last L7 is the host's RUNNING to GATING on
 * exactly `candidateSha` over the attempt's base, every builder phase before it
 * succeeded, and a recorded process accounts for every call spent.
 */
function assertL7Binding(records: AttemptRecords, source: AttemptStatus, candidateSha: string, processes: readonly ProcessEvidence[]): void {
  const l7 = records.filter((record) => record.event.evidence?.type === "transition" && record.event.evidence.edgeId === "L7").at(-1);
  const transition = l7?.event.evidence;
  if (transition?.type !== "transition" || transition.from !== "RUNNING" || transition.to !== "GATING" || transition.actor !== "host" ||
      transition.reasonSource !== "git" || l7?.event.next.lifecycleState !== "GATING" || l7.event.next.candidateSha !== candidateSha ||
      source.candidateSha !== candidateSha || source.baseSha === null || l7.event.next.baseSha !== source.baseSha) {
    throw new CandidateSeedRejected("no exact host-completed L7 candidate binding");
  }
  const producerPhases = new Map<string, string>();
  for (const record of records) {
    const evidence = record.event.evidence;
    if (record.source_seq < l7.source_seq && (evidence?.type === "phase" || evidence?.type === "phase-accepted" || evidence?.type === "resume-activation") && evidence.phase?.owner === "builder") {
      if (evidence.type === "phase-accepted" && (evidence.accepted.phaseKey !== evidence.phase.key ||
          evidence.accepted.ordinal !== evidence.phase.ordinal || evidence.phase.status !== "SUCCEEDED" ||
          evidence.accepted.round !== evidence.phase.correctionCount)) throw new CandidateSeedRejected("accepted builder binding is inconsistent");
      producerPhases.set(evidence.phase.phaseId, evidence.phase.status);
    }
  }
  if (![...producerPhases.values()].includes("SUCCEEDED") || [...producerPhases.values()].some((state) => state !== "SUCCEEDED") || processes.length === 0 || source.budget.callsSpent < settledCallsOf(processes)) {
    throw new CandidateSeedRejected("missing completed builder or settled call evidence");
  }
}

/**
 * The completed part of a sealed shift: the tickets, in run order, whose build
 * was accepted and whose gate phase then accepted that build's commit, and the
 * commit the last of them made.
 *
 * A shift's L7 comes only after its last ticket, so a shift stopped at ticket 5
 * never records one, and the generic rule would call its first four tickets
 * partial work. They are not: each accepted gate phase is the host's durable
 * statement that the ticket's own commit passed the configured gates, which is
 * what L7 states for a single builder. The first ticket without that statement
 * ends the completed run, and its commit, if it made one, is not adopted.
 *
 * The recipe is rebuilt from the ticket blobs of the source's recorded base,
 * the bytes the run compiled from, so a ticket rewritten on canonical HEAD
 * since then neither refuses a true prefix nor admits a changed one. Adoption
 * admits a shift source by this rule and a seed through that adoption proves it
 * again, so both hold one definition; `refuse` is the caller's own refusal.
 */
export async function completedShift(source: AttemptStatus, evidence: readonly AttemptEvidence[], refuse: (detail: string) => Error): Promise<{
  readonly sourceRecipe: WorkflowRecipe;
  readonly shift: ShiftAdoptionSource;
  readonly candidateSha: string;
}> {
  const manifest = source.shift;
  if (manifest == null) throw refuse(`source workflow ${JSON.stringify(source.workflow)} records no shift selection`);
  if (source.baseSha === null) throw refuse("source shift records no base to rebuild its selection from");
  let sourceRecipe: WorkflowRecipe;
  try {
    // Membership comes from the recipe the selection rebuilds, never from the
    // shape of a phase id. The prompts shape no membership, so none are read.
    sourceRecipe = bindShiftRecipeAt(source.repository, manifest, source.baseSha, { prompts: { builder: "", reviewer: "" } });
  } catch (error) {
    throw refuse(`the source shift cannot be rebuilt from its recorded selection at its base: ${error instanceof Error ? error.message : String(error)}`);
  }
  const accepted = new Map<string, AcceptedPhase>();
  for (const record of evidence) if (record.type === "phase-accepted") accepted.set(record.accepted.phaseKey, record.accepted);
  const phases = sourceRecipe.phases;
  const completedTickets: string[] = [];
  let candidateSha: string | null = null;
  for (const ticket of manifest.tickets) {
    const own = phases.filter((phase) => shiftTicketOf(phases, phase.id) === ticket.id);
    const build = own.find((phase) => shiftPhaseRole(phases, phase.id) === "builder");
    const tests = own.find((phase) => shiftPhaseRole(phases, phase.id) === "tests");
    const built = build === undefined ? undefined : accepted.get(build.id);
    const measured = tests === undefined ? undefined : accepted.get(tests.id);
    if (built?.candidateSha == null || measured === undefined) break;
    if (measured.candidateSha !== built.candidateSha) {
      throw refuse(`ticket ${ticket.id}'s gates accepted ${String(measured.candidateSha)}, not its build's commit ${built.candidateSha}`);
    }
    completedTickets.push(ticket.id);
    candidateSha = built.candidateSha;
  }
  if (candidateSha === null) {
    throw refuse("source shift completed no ticket; partial work is never adopted");
  }
  return {
    sourceRecipe,
    candidateSha,
    shift: {
      plan: manifest.plan,
      milestones: [...manifest.milestones],
      completedTickets,
      remainingTickets: manifest.tickets.map((ticket) => ticket.id).slice(completedTickets.length),
    },
  };
}

/**
 * The binding a sealed shift holds in place of L7: its completed ticket prefix,
 * recomputed from its own accepted records, is exactly the run and commit the
 * adoption recorded; every phase through that run's last gate phase was
 * accepted in order, succeeded, and names its own phase and round; and a
 * recorded process accounts for every call spent. A ticket whose gate
 * acceptance is gone ends the run early, so the recorded pair no longer holds.
 */
async function assertShiftPrefixBinding(records: AttemptRecords, source: AttemptStatus, adoption: CandidateAdoptionEvidence,
  processes: readonly ProcessEvidence[]): Promise<void> {
  const evidence = records.flatMap((record) => record.event.evidence === undefined ? [] : [record.event.evidence]);
  const completed = await completedShift(source, evidence, (detail) => new CandidateSeedRejected(detail));
  if (completed.candidateSha !== adoption.candidateSha || canonicalJson(completed.shift) !== canonicalJson(adoption.shift ?? null)) {
    throw new CandidateSeedRejected("the completed ticket prefix is not the exact one the adoption recorded");
  }
  const phases = completed.sourceRecipe.phases;
  const lastTicket = completed.shift.completedTickets.at(-1);
  const through = phases.findIndex((phase) => shiftTicketOf(phases, phase.id) === lastTicket && shiftPhaseRole(phases, phase.id) === "tests");
  if (through < 0) throw new CandidateSeedRejected(`the rebuilt recipe has no gate phase for ticket ${String(lastTicket)}`);
  const accepted = new Map<string, Extract<AttemptEvidence, { type: "phase-accepted" }>>();
  for (const record of evidence) if (record.type === "phase-accepted") accepted.set(record.accepted.phaseKey, record);
  for (const [index, phase] of phases.slice(0, through + 1).entries()) {
    const entry = accepted.get(phase.id);
    if (entry === undefined || entry.phase.key !== phase.id || entry.phase.ordinal !== index + 1 || entry.accepted.ordinal !== index + 1 ||
        entry.phase.status !== "SUCCEEDED" || entry.accepted.round !== entry.phase.correctionCount) {
      throw new CandidateSeedRejected(`accepted ticket binding is missing or inconsistent at ${phase.id}`);
    }
  }
  if (processes.length === 0 || source.budget.callsSpent < settledCallsOf(processes)) {
    throw new CandidateSeedRejected("missing completed builder or settled call evidence");
  }
}

/**
 * Every recorded process ended, is bound to a start identity, and has no live
 * group member now. The census is the liveness proof; an exit status is not.
 * The host records a turn whose stream failed or lost its terminal as FAILED
 * with neither code nor signal, so those two may lack one. EXITED without
 * either contradicts itself and refuses.
 */
function assertProcessesSettled(processes: readonly ProcessEvidence[], quiescence: ProcessQuiescence): void {
  for (const entry of processes) {
    if (!["EXITED", "FAILED", "CANCELLED"].includes(entry.status) || entry.endedAt === null ||
        (entry.status === "EXITED" && entry.exitCode === null && entry.exitSignal === null) ||
        entry.record.identity.startIdentity === null || quiescence(entry.record.identity) !== "quiescent") {
      throw new CandidateSeedRejected("source process is live or its settlement/survivors are unknown");
    }
  }
}

/**
 * The integrated target's own source as it stands now: the exact sealed
 * revision the adoption recorded, a sibling of the target, whose own
 * host-completed L7 still binds the recorded source pair, or, for a shift,
 * whose completed ticket prefix still does. Its base is not canonical HEAD, so
 * no Git pin is read here; the merge carries that.
 */
async function assertIntegrationSource(targetDir: string, adoption: CandidateAdoptionEvidence, repository: string, quiescence: ProcessQuiescence): Promise<void> {
  const tasks = dirname(dirname(targetDir));
  const dir = join(tasks, adoption.sourceTaskId, String(adoption.sourceAttempt));
  try {
    if (dirname(dirname(dir)) !== tasks || !existsSync(dir)) throw new CandidateSeedRejected("no such sealed attempt beside the target");
    const read = await readSealedAttempt(dir, repository, { project: adoption.sourceProject, taskId: adoption.sourceTaskId, attempt: adoption.sourceAttempt });
    const source = read.status;
    if (source.sessionId !== adoption.sourceSessionId || source.revision !== adoption.sourceRevision ||
        source.lifecycleState !== adoption.sourceLifecycle || source.baseSha !== adoption.baseSha) {
      throw new CandidateSeedRejected("not the exact sealed revision the adoption recorded");
    }
    const processes = processesOf(read.records);
    if (isCompiledWorkflowId(source.workflow)) await assertShiftPrefixBinding(read.records, source, adoption, processes);
    else assertL7Binding(read.records, source, adoption.candidateSha, processes);
    assertProcessesSettled(processes, quiescence);
  } catch (error) {
    if (!(error instanceof CandidateSeedRejected)) throw error;
    throw new CandidateSeedRejected(`integration source ${adoption.sourceTaskId} attempt ${String(adoption.sourceAttempt)}: ${error.detail}`);
  }
}

/**
 * The L7-equivalent binding of a sealed integrated adoption target. The host
 * creates such a target already GATING on its own two-parent merge, so the
 * binding is that one atomic creation record, the pair held unchanged through
 * every later record, the host's recorded fresh gates passing on it, the merge
 * recomputed byte for byte from the recorded source pair, and that pair still
 * being the recorded source's own exact L7 binding, or its completed ticket
 * prefix when the source is a shift. Neither the target's status nor the
 * merge's bytes admit it alone. An equal-base target carries its
 * source's candidate unchanged, so its source is the seed source.
 */
async function assertIntegratedAdoption(dir: string, target: AttemptStatus, records: AttemptRecords, candidateSha: string,
  repository: string, quiescence: ProcessQuiescence): Promise<void> {
  const created = records[0]?.event;
  const evidence = created?.evidence;
  if (created === undefined || evidence?.type !== "candidate-adoption" || !Value.Check(CandidateAdoptionEvidenceSchema, evidence.adoption) ||
      records.filter((record) => record.event.evidence?.type === "candidate-adoption").length !== 1) {
    throw new CandidateSeedRejected("adoption evidence is not exactly one valid host creation record");
  }
  const adoption = evidence.adoption;
  const integration = adoption.integration;
  if (integration === undefined) {
    throw new CandidateSeedRejected(`adoption target carries its source's candidate unchanged; seed from ${adoption.sourceTaskId} attempt ${String(adoption.sourceAttempt)} instead`);
  }
  const opened = created.next;
  if (created.kind !== "attempt.created" || opened.lifecycleState !== "GATING" || opened.gatesPass || opened.continuesTask !== adoption.sourceTaskId ||
      opened.budget.callsSpent !== 0 || opened.budget.callsReserved !== 0 ||
      adoption.sourceProject !== target.project || adoption.targetTaskId !== target.taskId || adoption.sourceTaskId !== target.continuesTask ||
      integration.integratedCandidateSha !== candidateSha || integration.integrationBaseSha !== target.baseSha ||
      records.some((record) => record.event.next.baseSha !== integration.integrationBaseSha || record.event.next.candidateSha !== candidateSha)) {
    throw new CandidateSeedRejected("no exact host-created integration candidate binding");
  }
  // The host's recorded measurement, not the status it left: the adoption-tests
  // phase succeeded, and every gate it recorded before that, the configured
  // commands among them, passed on the merge.
  const phaseId = `${target.sessionId}:adoption-tests`;
  const succeeded = records.findIndex((record) => {
    const phase = record.event.evidence;
    return phase?.type === "phase" && phase.phase.phaseId === phaseId && phase.phase.owner === "host" && phase.phase.status === "SUCCEEDED";
  });
  const gates = records.slice(0, Math.max(succeeded, 0)).flatMap((record) => {
    const gate = record.event.evidence;
    return gate?.type === "gate" && gate.phaseId === phaseId ? [gate] : [];
  });
  if (succeeded < 0 || records[succeeded]!.event.next.gatesPass !== true || !gates.some((gate) => gate.gateId === "commands_pass") ||
      gates.some((gate) => !gate.passed || gate.candidateSha !== candidateSha)) {
    throw new CandidateSeedRejected("integration candidate never passed its fresh adoption gates");
  }
  try {
    verifyIntegrationCommit(repository, planIntegration(repository, {
      sourceBaseSha: adoption.baseSha, sourceCandidateSha: adoption.candidateSha, integrationBaseSha: integration.integrationBaseSha,
    }), integration);
  } catch (error) {
    if (!(error instanceof IntegrationRefused)) throw error;
    throw new CandidateSeedRejected(`recorded integration is not the host's exact merge: ${error.message}`);
  }
  await assertIntegrationSource(dir, adoption, repository, quiescence);
}

export async function inspectSeedSource(dir: string, repository: string, expected: {
  project: string; taskId: string; attempt: number; candidateSha: string;
}, quiescence: ProcessQuiescence = observeQuiescence) {
  if (!/^[a-f0-9]{40}$/.test(expected.candidateSha)) throw new CandidateSeedRejected("selection requires an exact full commit SHA");
  const read = await readSealedAttempt(dir, repository, expected);
  const source = read.status;
  const processes = processesOf(read.records);
  if (read.records[0]?.event.evidence?.type === "candidate-adoption") {
    // An adoption target runs no builder, so it has no L7 and may have no process.
    await assertIntegratedAdoption(dir, source, read.records, expected.candidateSha, repository, quiescence);
    if (source.budget.callsSpent < settledCallsOf(processes)) throw new CandidateSeedRejected("missing settled call evidence");
  } else {
    assertL7Binding(read.records, source, expected.candidateSha, processes);
  }
  if (source.baseSha === null) throw new CandidateSeedRejected("source records no base");
  assertProcessesSettled(processes, quiescence);
  const git = systemGitRunner(repository);
  assertClean(repository, "before", git);
  if (!/^[a-f0-9]{40}$/.test(source.baseSha) || runGit(git, ["rev-parse", "HEAD"]).trim() !== source.baseSha ||
      runGit(git, ["rev-parse", `${expected.candidateSha}^{commit}`]).trim() !== expected.candidateSha ||
      source.baseSha === expected.candidateSha || git(["merge-base", "--is-ancestor", source.baseSha, expected.candidateSha]).status !== 0) {
    throw new CandidateSeedRejected("candidate/base mismatch or canonical HEAD moved");
  }
  const identities = runGit(git, ["log", "--format=%an <%ae>|%cn <%ce>", `${source.baseSha}..${expected.candidateSha}`]).trim().split("\n");
  if (identities.some((identity) => identity !== `${HOST_AUTHOR}|${HOST_AUTHOR}`)) throw new CandidateSeedRejected("candidate range contains a non-owner commit identity");
  return { ...read, baseSha: source.baseSha, candidateSha: expected.candidateSha };
}

/**
 * A seed binds one builder phase fixed before the run. A compiled workflow has
 * no phase list until its selection is bound, and then one builder per ticket,
 * so it is refused by name rather than as an unknown recipe.
 */
function refuseCompiledSeedTarget(workflow: string): void {
  if (compiledWorkflow(workflow) !== null) {
    throw new CandidateSeedRejected(`target ${JSON.stringify(workflow)} is compiled per selection and has no single builder phase to seed`);
  }
}

export function validateInheritedSeed(repository: string, seed: Pick<CandidateSeed, "workflow" | "integrationBaseSha" | "seedCandidateSha">, config: AwsfConfig): readonly string[] {
  refuseCompiledSeedTarget(seed.workflow);
  const recipe = workflowRecipe(seed.workflow);
  if (recipe === null || recipe.tier !== 2 || !["build-review", "simple-sdlc"].includes(recipe.id) || !config.workflows.enabled.includes(recipe.id)) {
    throw new CandidateSeedRejected("target must use an enabled T2 build/review workflow");
  }
  const owners = new Set(recipe.phases.filter((phase) => phase.kind === "agent" && phase.owner !== "reviewer").map((phase) => phase.owner));
  const writes = [...owners].flatMap((owner) => {
    const agent = config.agents.find((entry) => entry.name === owner);
    if (agent === undefined) throw new CandidateSeedRejected(`missing target writer ${owner}`);
    return agent.writes;
  });
  const paths = candidatePathsBetween(repository, seed.integrationBaseSha, seed.seedCandidateSha);
  if (paths.length === 0) throw new CandidateSeedRejected("inherited diff is empty");
  for (const report of [noProtectedPaths(paths, config.policy.protected_paths), writesWithinGlobs(paths, writes), riskTierSufficient(paths, 2, config.risk, "inherited candidate changes")]) {
    if (!report.passed) throw new CandidateSeedRejected(`${report.gateId}: ${report.checks.filter((check) => !check.ok).map((check) => check.note).join(", ")}`);
  }
  return paths;
}

export async function builderSeedBinding(config: AwsfConfig, configPath: string, workflow: string) {
  refuseCompiledSeedTarget(workflow);
  const recipe = workflowRecipe(workflow);
  const index = recipe?.phases.findIndex((phase) => phase.kind === "agent" && phase.owner === "builder") ?? -1;
  const phase = recipe?.phases[index];
  const agent = config.agents.find((entry) => entry.name === "builder");
  if (index < 0 || phase === undefined || agent === undefined) throw new CandidateSeedRejected("target has no builder");
  const bundle = await composePromptBundle({ configPath, agent });
  return { builderPhaseKey: phase.id, builderPhaseOrdinal: index + 1, builderPromptBundleDigest: sha256(canonicalJson(bundle)) };
}

export function assertSeedTarget(status: AttemptStatus): CandidateSeed | null {
  const seed = status.seed ?? null;
  if (seed === null) return null;
  assertCandidateSeed(seed);
  if (seed.target.project !== status.project || seed.target.taskId !== status.taskId || seed.target.attempt !== status.attempt || seed.target.sessionId !== status.sessionId ||
      seed.workflow !== status.workflow || status.tier !== 2 || seed.requestDigest !== sha256(status.request) || seed.configDigest !== sha256(status.configSnapshotJson) ||
      status.baseSha !== seed.integrationBaseSha || status.continuesTask !== seed.source.taskId) throw new CandidateSeedRejected("seed target binding changed");
  return seed;
}

/** Detect removed/substituted seed state, including a stale status after creation. */
export async function verifiedTargetSeed(dir: string, status: AttemptStatus): Promise<CandidateSeed | null> {
  const read = await readVerifiedAttempt(dir);
  if (canonicalJson(read.status) !== canonicalJson(status)) throw new CandidateSeedRejected("target changed during seed validation");
  const first = read.records[0]?.event.evidence;
  const journalSeed = first?.type === "candidate-seed" ? first.seed : null;
  if (canonicalJson(journalSeed) !== canonicalJson(status.seed ?? null)) throw new CandidateSeedRejected("seed differs from atomic creation evidence");
  return assertSeedTarget(status);
}

export async function validateSeedStartup(seed: CandidateSeed, status: AttemptStatus, config: AwsfConfig, configPath: string, attemptDir: string): Promise<void> {
  assertSeedTarget(status);
  const source = await inspectSeedSource(join(dirname(dirname(attemptDir)), seed.source.taskId, String(seed.source.attempt)), status.repository, {
    project: seed.source.project, taskId: seed.source.taskId, attempt: seed.source.attempt, candidateSha: seed.seedCandidateSha,
  });
  if (source.journalDigest !== seed.source.journalDigest || source.status.sessionId !== seed.source.sessionId || source.status.revision !== seed.source.revision) {
    throw new CandidateSeedRejected("seed source provenance changed before startup");
  }
  if (seed.configDigest !== sha256(toConfigSnapshotJson(config))) throw new CandidateSeedRejected("seed configuration changed");
  const binding = await builderSeedBinding(config, configPath, status.workflow);
  if (canonicalJson(binding) !== canonicalJson({ builderPhaseKey: seed.builderPhaseKey, builderPhaseOrdinal: seed.builderPhaseOrdinal, builderPromptBundleDigest: seed.builderPromptBundleDigest })) {
    throw new CandidateSeedRejected("seed builder prompt binding changed");
  }
  const git = systemGitRunner(status.repository);
  assertClean(status.repository, "before", git);
  if (runGit(git, ["rev-parse", "HEAD"]).trim() !== seed.integrationBaseSha ||
      runGit(git, ["rev-parse", `${seed.seedCandidateSha}^{commit}`]).trim() !== seed.seedCandidateSha ||
      git(["merge-base", "--is-ancestor", seed.integrationBaseSha, seed.seedCandidateSha]).status !== 0) throw new CandidateSeedRejected("seed object/base changed before startup");
  validateInheritedSeed(status.repository, seed, config);
}

export function seedContext(status: AttemptStatus): string {
  const seed = assertSeedTarget(status);
  if (seed === null) return "";
  return `\n\nHost-measured seed attribution (no source assurance transfers):\n${JSON.stringify({
    integrationBaseSha: seed.integrationBaseSha, seedCandidateSha: seed.seedCandidateSha,
    inheritedPaths: candidatePathsBetween(status.repository, seed.integrationBaseSha, seed.seedCandidateSha),
  })}\nBuilder changedFiles must describe only this target phase's changes from its pre-write HEAD. Inherited paths remain in the full review diff. Earn a fresh host commit.\n`;
}
