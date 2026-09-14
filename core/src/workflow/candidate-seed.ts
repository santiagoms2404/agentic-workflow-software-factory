import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AwsfConfig } from "../config/schema.ts";
import { toConfigSnapshotJson } from "../config/effective-config.ts";
import { assertCandidateSeed, type CandidateSeed } from "../contracts/candidate-seed.ts";
import { canonicalJson, sha256 } from "../contracts/owner-amendment.ts";
import type { ProcessIdentity } from "../execution/launcher-barrier.ts";
import { groupMembers } from "../execution/process-controller.ts";
import { noProtectedPaths, writesWithinGlobs } from "../gates/git-diff.ts";
import { riskTierSufficient } from "../gates/risk.ts";
import { assertClean, runGit, systemGitRunner } from "../git/changes.ts";
import { HOST_AUTHOR } from "../git/commit.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { readAttempt, withLegacyDefaults, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { workflowRecipe } from "./catalog.ts";
import { composePromptBundle } from "./prompt-composition.ts";
import { candidatePathsBetween } from "./review-evidence.ts";

export class CandidateSeedRejected extends Error {
  constructor(detail: string) { super(`candidate seed rejected: ${detail}`); this.name = "CandidateSeedRejected"; }
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

export async function inspectSeedSource(dir: string, repository: string, expected: {
  project: string; taskId: string; attempt: number; candidateSha: string;
}, quiescence: ProcessQuiescence = observeQuiescence) {
  if (!/^[a-f0-9]{40}$/.test(expected.candidateSha)) throw new CandidateSeedRejected("selection requires an exact full commit SHA");
  if (await realpath(dir) !== resolve(dir)) throw new CandidateSeedRejected("source attempt path contains a symlink");
  if (existsSync(join(dir, "attempt.lock"))) throw new CandidateSeedRejected("source has an unresolved writer lock");
  const read = await readVerifiedAttempt(dir);
  const source = read.status;
  if (source.project !== expected.project || source.taskId !== expected.taskId || source.attempt !== expected.attempt ||
      await realpath(source.repository) !== await realpath(repository)) throw new CandidateSeedRejected("source task/attempt/repository mismatch");
  if (source.lifecycleState !== "BLOCKED" && source.lifecycleState !== "CANCELLED") throw new CandidateSeedRejected("source is not sealed BLOCKED/CANCELLED");
  if (source.budget.callsReserved !== 0 || source.process !== null) throw new CandidateSeedRejected("source retains unsettled calls or a process");
  const l7 = read.records.filter((record) => record.event.evidence?.type === "transition" && record.event.evidence.edgeId === "L7").at(-1);
  const transition = l7?.event.evidence;
  if (transition?.type !== "transition" || transition.from !== "RUNNING" || transition.to !== "GATING" || transition.actor !== "host" ||
      transition.reasonSource !== "git" || l7?.event.next.lifecycleState !== "GATING" || l7.event.next.candidateSha !== expected.candidateSha ||
      source.candidateSha !== expected.candidateSha || source.baseSha === null || l7.event.next.baseSha !== source.baseSha) {
    throw new CandidateSeedRejected("no exact host-completed L7 candidate binding");
  }
  const processes = new Map<string, Extract<NonNullable<AttemptEvent["evidence"]>, { type: "process" }>>();
  const producerPhases = new Map<string, string>();
  for (const record of read.records) {
    const evidence = record.event.evidence;
    if (evidence?.type === "process") processes.set(evidence.record.runId, evidence);
    if (record.source_seq < l7.source_seq && (evidence?.type === "phase" || evidence?.type === "phase-accepted" || evidence?.type === "resume-activation") && evidence.phase?.owner === "builder") {
      if (evidence.type === "phase-accepted" && (evidence.accepted.phaseKey !== evidence.phase.key ||
          evidence.accepted.ordinal !== evidence.phase.ordinal || evidence.phase.status !== "SUCCEEDED" ||
          evidence.accepted.round !== evidence.phase.correctionCount)) throw new CandidateSeedRejected("accepted builder binding is inconsistent");
      producerPhases.set(evidence.phase.phaseId, evidence.phase.status);
    }
  }
  if (![...producerPhases.values()].includes("SUCCEEDED") || [...producerPhases.values()].some((state) => state !== "SUCCEEDED") || processes.size === 0 || source.budget.callsSpent < new Set([...processes.values()].map((entry) => entry.record.reservationId)).size) {
    throw new CandidateSeedRejected("missing completed builder or settled call evidence");
  }
  for (const entry of processes.values()) {
    if (!["EXITED", "FAILED", "CANCELLED"].includes(entry.status) || entry.endedAt === null ||
        (entry.exitCode === null && entry.exitSignal === null) || entry.record.identity.startIdentity === null || quiescence(entry.record.identity) !== "quiescent") {
      throw new CandidateSeedRejected("source process is live or its settlement/survivors are unknown");
    }
  }
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

export function validateInheritedSeed(repository: string, seed: Pick<CandidateSeed, "workflow" | "integrationBaseSha" | "seedCandidateSha">, config: AwsfConfig): readonly string[] {
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
