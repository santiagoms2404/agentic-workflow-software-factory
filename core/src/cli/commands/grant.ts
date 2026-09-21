import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import type { OwnerTerminal } from "../tty.ts";
import { readAttempt, nextRevision, persistAttempt, type AttemptProjector } from "./attempt.ts";
import { protectedGrantSubject } from "./production-run.ts";
import { assertNoExecutionController, withExecutionLease } from "../../execution/operation-lease.ts";
import { assertProtectedGrant, protectedFactDigest, type ProtectedGrant } from "../../contracts/protected-grant.ts";
import { recoveryDigest } from "../../contracts/phase-recovery.ts";
import { assertClean } from "../../git/changes.ts";
import { captureProtectedBaselines, protectedReadOnlyGit } from "../../workflow/protected-files.ts";
import { readProtectedState } from "../../workflow/protected-grants.ts";
import { matchesPathGlob } from "../../policy/path-policy.ts";
import { openPermissionSession, type SandboxProbe } from "../../policy/sandbox-broker.ts";
import { scrubCredentialString } from "../../policy/redaction.ts";

export async function grantCommand(options: {
  attemptDir: string; config: AwsfConfig; configPath: string; stateRoot: string; phase: string; files: readonly string[];
  reason: string; terminal: OwnerTerminal; actor?: string; projectRecord?: AttemptProjector; sandboxProbe?: SandboxProbe;
}) {
  if (!options.terminal.interactive || (options.actor ?? "human") !== "human") throw new Error("protected grant requires an interactive owner act");
  const phase = options.phase; const paths = Object.freeze([...options.files].sort()); const reason = options.reason;
  if (!reason.trim() || scrubCredentialString(reason) !== reason) throw new Error("protected grant requires a credential-free owner reason");
  await assertNoExecutionController(options.attemptDir);
  const current = await readAttempt(options.attemptDir);
  if (!(current.lifecycleState === "PREPARED" || current.recovery?.kind === "quota-pause" || current.recovery?.kind === "completed-phase") || current.process !== null || current.budget.callsReserved !== 0) throw new Error("protected grant requires a quiescent prepared or resumable boundary");
  if (toConfigSnapshotJson(options.config) !== current.configSnapshotJson) throw new Error("protected grant configuration changed");
  const facts = readProtectedState(options.attemptDir);
  if (recoveryDigest(facts.status) !== recoveryDigest(current) || facts.grants.some(grant => grant.subject.phaseKey === phase) || current.recovery?.prefix.some(value => value.phaseKey === phase)) throw new Error("protected grant phase is already authorized or completed");
  const subject = await protectedGrantSubject(options, current, phase);
  const agent = options.config.agents.find(agent => agent.name === phase);
  if (agent === undefined) throw new Error("protected grant phase has no exact writing role");
  for (const path of paths) {
    if (!agent.writes.some(glob => matchesPathGlob(path, glob, true)) || !options.config.policy.protected_paths.some(glob => matchesPathGlob(path, glob, false))) throw new Error("protected grant cannot enlarge role writes or authorize an unprotected path");
  }
  const permission = openPermissionSession({ canonicalRepository: current.repository, worktree: subject.worktree,
    sessionRuntime: join(options.attemptDir, "private", phase), stateRoot: options.stateRoot, profile: agent.tools.profile,
    tools: agent.tools.allow, writes: agent.writes, protectedPaths: options.config.policy.protected_paths, git: protectedReadOnlyGit(subject.worktree),
    ...(options.sandboxProbe === undefined ? {} : { sandboxProbe: options.sandboxProbe }) });
  if (permission.sandboxBadge !== "os-enforced") throw new Error("protected grants require an OS-enforced sandbox; no tool-policy fallback");
  const unsigned: ProtectedGrant = { schema: "awsf.protected-grant/v1", id: randomUUID(), generationId: randomUUID(), subject,
    files: captureProtectedBaselines(subject.worktree, subject.preWriteHeadSha, paths), anchorRevision: current.revision,
    reason, confirmedAt: new Date().toISOString(), digest: "" };
  const grant = { ...unsigned, digest: protectedFactDigest(unsigned) }; assertProtectedGrant(grant);
  options.terminal.write(`One-use protected content grant for ${current.taskId}, attempt ${current.attempt}, phase ${phase}.`);
  options.terminal.write(`Pre-write HEAD: ${subject.preWriteHeadSha}. Integration base: ${subject.integrationBaseSha}.`);
  for (const file of grant.files) options.terminal.write(`${JSON.stringify(file.path)}: ${file.blob ?? "new file"} (${file.mode ?? "100644 only"})`);
  options.terminal.write(`Reason: ${JSON.stringify(reason)}. No role/tool/mount expansion, correction, deletion, migration or landing approval is granted.`);
  if (!await options.terminal.confirm("Issue this exact one-use protected grant?")) return { status: current, confirmed: false };
  return withExecutionLease(options.attemptDir, async () => {
    assertClean(subject.worktree, "before", protectedReadOnlyGit(subject.worktree));
    if (recoveryDigest(await readAttempt(options.attemptDir)) !== recoveryDigest(current) ||
        recoveryDigest(await protectedGrantSubject(options, current, phase)) !== recoveryDigest(subject) ||
        recoveryDigest(captureProtectedBaselines(subject.worktree, subject.preWriteHeadSha, paths)) !== recoveryDigest(grant.files)) throw new Error("protected grant anchor changed after confirmation");
  }, async () => {
    const status = await persistAttempt(options.attemptDir, current.revision, { kind: "attempt.updated",
      next: nextRevision(current, { lastActivity: `owner issued an exact one-use protected grant for ${phase}`, lastActivityAt: grant.confirmedAt }),
      evidence: { type: "protected-grant", grant } }, options.projectRecord);
    return { status, confirmed: true };
  });
}
