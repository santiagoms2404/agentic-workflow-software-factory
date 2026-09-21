import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { deriveAttemptStatus, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { scanJournalText } from "../persistence/replay.ts";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import { assertProtectedGrant, assertProtectedConsumption, assertProtectedCandidateBinding, protectedFactDigest,
  type ProtectedGrant, type ProtectedGrantConsumption, type ProtectedGrantSubject, type ProtectedCandidateBinding, type ProtectedBlobDelta } from "../contracts/protected-grant.ts";
import { protectedWriteContext, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import { runGit, systemGitRunner, assertClean } from "../git/changes.ts";
import { protectedTreeDelta, protectedContentDeltas } from "../git/protected-delta.ts";
import { matchesPathGlob } from "../policy/path-policy.ts";
import { captureProtectedBaselines, verifyProtectedFilesystem, treeFile, protectedReadOnlyGit, protectedBlobId, readProtectedContent } from "./protected-files.ts";
import type { AwsfConfig } from "../config/schema.ts";

export interface ProtectedState {
  status: AttemptStatus;
  records: readonly JournalRecord<AttemptEvent>[];
  grants: readonly ProtectedGrant[];
  consumptions: readonly ProtectedGrantConsumption[];
  bindings: readonly ProtectedCandidateBinding[];
  intents: readonly import("../git/protected-commit.ts").ProtectedCommitIntent[];
}
export function readProtectedState(attemptDir: string): ProtectedState {
  const path = join(attemptDir, "journal.jsonl");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("protected evidence is not a private regular journal");
  const scan = scanJournalText<AttemptEvent>(readFileSync(path, "utf8"), path);
  if (!scan.ok || scan.tornTail !== null) throw new Error("protected journal is torn or invalid");
  const records = scan.records;
  const status = deriveAttemptStatus(records);
  if (status === null) throw new Error("protected evidence has no attempt");
  const grants: ProtectedGrant[] = []; const consumptions: ProtectedGrantConsumption[] = []; const bindings: ProtectedCandidateBinding[] = [];
  const intents: import("../git/protected-commit.ts").ProtectedCommitIntent[] = [];
  for (const record of records) {
    if (record.event.next.revision !== record.source_seq || record.event.next.sessionId !== status.sessionId) throw new Error("protected journal identity or sequence mismatch");
    const evidence = record.event.evidence;
    if (evidence?.type === "protected-grant") {
      const grant = evidence.grant; assertProtectedGrant(grant);
      if (grant.subject.sessionId !== status.sessionId || grant.subject.attempt !== status.attempt || grant.subject.repository !== status.repository || grant.subject.worktree !== status.worktree || grant.subject.integrationBaseSha !== status.baseSha || grant.anchorRevision !== record.source_seq - 1 ||
          grants.some(value => value.id === grant.id || value.generationId === grant.generationId || value.subject.phaseKey === grant.subject.phaseKey)) throw new Error("protected issuance conflicts with prior authority");
      grants.push(grant);
    }
    const consumption = evidence?.type === "protected-activation" ? evidence.consumption
      : evidence?.type === "transition" || evidence?.type === "resume-activation" ? evidence.protectedConsumption : undefined;
    if (consumption !== undefined) {
      const grant = grants.find(value => value.id === consumption.grantId);
      if (grant === undefined) throw new Error("protected activation precedes issuance");
      assertProtectedConsumption(consumption, grant);
      if ((evidence?.type === "protected-activation" || evidence?.type === "resume-activation") &&
          (evidence.phase?.key !== consumption.phaseKey || evidence.phase.ordinal !== consumption.phaseOrdinal || evidence.phase.status !== "RUNNING")) throw new Error("protected activation lost its atomic phase binding");
      if (evidence?.type === "transition" && (evidence.edgeId !== "L4" || evidence.to !== "RUNNING" || evidence.actor !== "host")) throw new Error("protected activation is not a launch transition");
      if (consumptions.some(value => value.grantId === grant.id || value.id === consumption.id) || record.event.next.activeOperation !== consumption.operationId || record.event.next.budget.callsReserved < 1) throw new Error("protected activation is reused or lacks its atomic reservation");
      consumptions.push(consumption);
    }
    if (evidence?.type === "protected-commit-intent") {
      const intent = evidence.intent; const grant = grants.find(value => value.id === intent.binding.grantId);
      const consumption = consumptions.find(value => value.id === intent.binding.consumptionId);
      if (grant === undefined || consumption === undefined || intents.some(value => value.binding.consumptionId === consumption.id) ||
          !/^[a-f0-9]{64}$/u.test(intent.beforeIndexDigest) || !/^[a-f0-9]{64}$/u.test(intent.stagedIndexDigest)) throw new Error("protected commit intent is orphaned, invalid or duplicated");
      assertProtectedCandidateBinding(intent.binding, grant, consumption); intents.push(intent);
    }
    if (evidence?.type === "protected-candidate") {
      const binding = evidence.binding; const grant = grants.find(value => value.id === binding.grantId);
      const consumption = consumptions.find(value => value.id === binding.consumptionId);
      if (grant === undefined || consumption === undefined || bindings.some(value => value.consumptionId === consumption.id)) throw new Error("protected candidate has no unique consumed generation");
      assertProtectedCandidateBinding(binding, grant, consumption);
      if (!intents.some(intent => recoveryDigest(intent.binding) === recoveryDigest(binding))) throw new Error("protected candidate has no matching prior commit intent");
      bindings.push(binding);
    }
  }
  if (grants.length > 0 && ((stat.mode & 0o077) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid()))) throw new Error("protected journal must be owner-private");
  return { status, records, grants, consumptions, bindings, intents };
}
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function protectedGrantForPhase(attemptDir: string, phaseKey: string): ProtectedGrant | null {
  return readProtectedState(attemptDir).grants.find(grant => grant.subject.phaseKey === phaseKey) ?? null;
}
export function prepareProtectedConsumption(attemptDir: string, subject: ProtectedGrantSubject, operationId: string, reservationId: string): ProtectedGrantConsumption | null {
  const state = readProtectedState(attemptDir);
  const grant = state.grants.find(value => value.subject.phaseKey === subject.phaseKey);
  if (grant === undefined) return null;
  if (recoveryDigest(grant.subject) !== recoveryDigest(subject)) throw new Error("protected grant execution binding changed");
  if (state.consumptions.some(value => value.grantId === grant.id)) throw new Error("protected generation was already consumed; no replay or correction is authorized");
  assertClean(subject.worktree, "before", protectedReadOnlyGit(subject.worktree));
  verifyProtectedFilesystem(grant, false);
  if (recoveryDigest(captureProtectedBaselines(subject.worktree, subject.preWriteHeadSha, grant.files.map(file => file.path))) !== recoveryDigest(grant.files)) throw new Error("protected baseline changed before consumption");
  return { id: randomUUID(), grantId: grant.id, grantDigest: grant.digest, generationId: grant.generationId, operationId, reservationId, phaseKey: subject.phaseKey, phaseOrdinal: subject.phaseOrdinal };
}
export async function verifyConsumedProtectedGrant(input: { attemptDir: string; subject: ProtectedGrantSubject; operationId: string; reservationId: string }) {
  const state = readProtectedState(input.attemptDir);
  const grant = state.grants.find(value => value.subject.phaseKey === input.subject.phaseKey);
  const consumption = state.consumptions.find(value => value.grantId === grant?.id);
  if (grant === undefined || consumption === undefined || state.bindings.some(value => value.consumptionId === consumption.id) ||
      recoveryDigest(grant.subject) !== recoveryDigest(input.subject) || state.status.activeOperation !== input.operationId ||
      consumption.operationId !== input.operationId || consumption.reservationId !== input.reservationId || state.status.budget.callsReserved < 1) throw new Error("protected launch lacks its exact unused activation");
  verifyProtectedFilesystem(grant, false);
  assertClean(grant.subject.worktree, "before", protectedReadOnlyGit(grant.subject.worktree));
  if (recoveryDigest(captureProtectedBaselines(grant.subject.worktree, grant.subject.preWriteHeadSha, grant.files.map(file => file.path))) !== recoveryDigest(grant.files)) throw new Error("protected activation baseline changed");
  const config = JSON.parse(state.status.configSnapshotJson) as AwsfConfig;
  const role = config.agents.find(agent => agent.name === grant.subject.phaseKey);
  if (role === undefined || role.writes.length === 0) throw new Error("protected grant has no original writing role");
  return freeze({ grant: structuredClone(grant), consumption: structuredClone(consumption),
    policy: { profile: role.tools.profile, tools: [...role.tools.allow], writes: [...role.writes], protectedPaths: [...config.policy.protected_paths] } });
}
export function assertProtectedOutput(capability: ProtectedFilesCapability, worktree: string): void {
  const context = protectedWriteContext(capability);
  if (context === null || context.grant.subject.worktree !== worktree) throw new Error("protected permission capability belongs to another worktree");
  verifyProtectedFilesystem(context.grant, true);
  if (runGit(systemGitRunner(worktree), ["rev-parse", "--absolute-git-dir"]).trim() !== context.grant.subject.worktreeGitDir) throw new Error("protected worktree Git directory changed");
  if (runGit(systemGitRunner(worktree), ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim() !== context.grant.subject.commonGitDir) throw new Error("protected common Git directory changed");
  if (runGit(systemGitRunner(worktree), ["rev-parse", "HEAD"]).trim() !== context.grant.subject.preWriteHeadSha) throw new Error("protected phase changed HEAD before host publication");
}
export function assertProtectedExecutionProof(state: ProtectedState, consumption: ProtectedGrantConsumption): void {
  const phaseId = `${state.status.sessionId}:${consumption.phaseKey}`;
  const evidence = state.records.map(record => record.event.evidence);
  const completion = evidence.findLast(event => event?.type === "process" && event.record.reservationId === consumption.reservationId);
  const launch = evidence.findLast(event => event?.type === "agent-start" && event.phaseId === phaseId);
  const spent = evidence.find(event => event?.type === "process" && event.record.reservationId === consumption.reservationId && event.phaseId === phaseId && event.status === "RUNNING" && event.releasedAt !== null);
  if (completion?.type !== "process" || completion.phaseId !== phaseId || completion.status !== "EXITED" || completion.exitCode !== 0 || completion.endedAt === null ||
      completion.record.command[0] !== "bwrap" || launch?.type !== "agent-start" || launch.sandboxBadge !== "os-enforced" || launch.sandboxMechanism !== "linux-bwrap" ||
      spent?.type !== "process" || spent.record.runId !== completion.record.runId) throw new Error("protected candidate lacks its original spent OS-enforced execution proof");
}

export function inspectProtectedCandidate(attemptDir: string, candidateSha: string, pendingConsumptionId?: string) {
  const state = readProtectedState(attemptDir);
  if (state.consumptions.some(consumption => consumption.id !== pendingConsumptionId && !state.bindings.some(binding => binding.consumptionId === consumption.id))) throw new Error("protected generation has an unfinished candidate binding");
  if (state.status.baseSha === null || state.status.worktree === null) throw new Error("protected candidate has no pinned base or worktree");
  const git = systemGitRunner(state.status.worktree);
  const config = JSON.parse(state.status.configSnapshotJson) as AwsfConfig;
  const expected = new Map<string, ProtectedBlobDelta>();
  for (const binding of state.bindings) {
    const grant = state.grants.find(value => value.id === binding.grantId)!;
    assertProtectedExecutionProof(state, state.consumptions.find(value => value.id === binding.consumptionId)!);
    const parents = runGit(git, ["rev-list", "--parents", "-n", "1", binding.candidateSha]).trim().split(" ");
    if (parents.length !== 2 || parents[1] !== binding.parentSha || runGit(git, ["rev-parse", `${binding.candidateSha}^{tree}`]).trim() !== binding.treeSha ||
        git(["merge-base", "--is-ancestor", binding.candidateSha, candidateSha]).status !== 0) throw new Error("protected candidate ancestry, parent or tree changed");
    const rows = protectedTreeDelta(git, binding.parentSha, binding.treeSha).filter(row => config.policy.protected_paths.some(glob => matchesPathGlob(row.path, glob, false)));
    const actual = protectedContentDeltas(rows, grant.files);
    if (recoveryDigest(actual) !== recoveryDigest(binding.deltas)) throw new Error("protected bound blob delta changed");
    for (const delta of actual) {
      const previous = expected.get(delta.path);
      if (previous !== undefined && (previous.afterBlob !== delta.beforeBlob || previous.afterMode !== delta.beforeMode)) throw new Error("protected binding chain has an intervening mutation");
      expected.set(delta.path, { ...delta, beforeBlob: previous === undefined ? delta.beforeBlob : previous.beforeBlob, beforeMode: previous === undefined ? delta.beforeMode : previous.beforeMode });
    }
  }
  const cumulative = protectedTreeDelta(git, state.status.baseSha, candidateSha).filter(row => config.policy.protected_paths.some(glob => matchesPathGlob(row.path, glob, false)));
  for (const row of cumulative) {
    const delta = expected.get(row.path);
    if (delta === undefined || row.beforeBlob !== (delta.beforeBlob ?? "0".repeat(40)) || row.beforeMode !== (delta.beforeMode ?? "000000") || row.afterBlob !== delta.afterBlob || row.afterMode !== delta.afterMode) throw new Error("cumulative candidate contains an unbound protected change");
  }
  for (const [path, delta] of expected) {
    const current = treeFile(git, candidateSha, path);
    if (current?.blob !== delta.afterBlob || current.mode !== delta.afterMode) throw new Error("later phase changed protected bound content");
  }
  const deltas = [...expected.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { state, deltas, bindingChainDigest: recoveryDigest(state.bindings), protectedDeltaDigest: recoveryDigest(deltas) };
}
export function protectedPromptContext(grant: ProtectedGrant | null): string {
  return grant === null ? "" : `\nHost-verified one-use protected content grant ${grant.id}, generation ${grant.generationId}: ${JSON.stringify(grant.files.map(file => file.path))}. Existing role writes and tools remain unchanged. No correction, deletion, mode change or landing approval is authorized.\n`;
}

export function assertProtectedPreservedBytes(proof: ReturnType<typeof inspectProtectedCandidate>, writing: readonly string[] = []): void {
  const root = proof.state.status.worktree!;
  for (const grant of proof.state.grants.filter(grant => proof.state.bindings.some(binding => binding.grantId === grant.id))) verifyProtectedFilesystem(grant, true);
  for (const delta of proof.deltas) {
    if (writing.includes(delta.path)) continue;
    const stat = lstatSync(join(root, delta.path));
    if (!stat.isFile() || stat.nlink !== 1 || ((stat.mode & 0o111) === 0 ? "100644" : "100755") !== delta.afterMode ||
        protectedBlobId(readProtectedContent(root, delta.path)) !== delta.afterBlob) throw new Error("later phase changed protected bound bytes");
  }
}

export function candidateBinding(capability: ProtectedFilesCapability, treeSha: string, candidateSha: string, deltas: readonly ProtectedBlobDelta[]): ProtectedCandidateBinding {
  const proof = protectedWriteContext(capability);
  if (proof === null) throw new Error("protected candidate requires an authentic write capability");
  const { grant, consumption } = proof;
  const value: ProtectedCandidateBinding = { schema: "awsf.protected-candidate-binding/v1", id: randomUUID(), grantId: grant.id, grantDigest: grant.digest,
    consumptionId: consumption.id, generationId: grant.generationId, operationId: consumption.operationId, phaseKey: consumption.phaseKey, phaseOrdinal: consumption.phaseOrdinal,
    parentSha: grant.subject.preWriteHeadSha, treeSha, candidateSha, deltas: [...deltas], sandboxBadge: "os-enforced", createdAt: new Date().toISOString(), digest: "" };
  const bound = { ...value, digest: protectedFactDigest(value) }; assertProtectedCandidateBinding(bound, grant, consumption); return bound;
}
