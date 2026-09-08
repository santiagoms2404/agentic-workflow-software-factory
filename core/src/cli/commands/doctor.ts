// Read-only operator diagnosis. This command deliberately has no repair path:
// a finding is evidence for the owner, not permission to alter an attempt.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { discoverAttempts } from "../../observability/rebuild.ts";
import { openDatabase, closeDatabase } from "../../observability/sqlite.ts";
import { listSessions } from "../../observability/queries.ts";
import { diagnoseRecovery, formatRecoveryDiagnostic } from "../../observability/recovery-diagnostics.ts";
import { readLockHolder } from "../../persistence/attempt-lock.ts";
import { lockFilePath } from "../../persistence/platform-paths.ts";
import { LEGAL_EDGES, TASK_STATES } from "../../state/task-machine.ts";
import { readAttempt } from "./attempt.ts";
import { readAttemptEvidence } from "./review-record.ts";

export interface DoctorReport {
  readonly healthy: boolean;
  readonly lines: readonly string[];
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function pidIsLive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Inspect durable state only; it never takes a lock, opens a writer, or repairs. */
export async function doctorCommand(stateRoot: string): Promise<DoctorReport> {
  const lines: string[] = [];
  const findings: string[] = [];
  const attempts = await discoverAttempts(stateRoot);

  for (const attemptDir of attempts) {
    const label = attemptDir.slice(stateRoot.length + 1);
    const holder = await readLockHolder(lockFilePath(attemptDir));
    if (await exists(lockFilePath(attemptDir))) {
      const detail = holder === null ? "unnamed or malformed holder" : `pid ${holder.pid} since ${holder.acquiredAt}`;
      lines.push(`lock: ${label}: ${detail}`);
      if (holder === null || !pidIsLive(holder.pid)) findings.push(`stale lock: ${label}: ${detail}`);
    }
    try {
      const status = await readAttempt(attemptDir);
      const diagnostic = diagnoseRecovery(status, await readAttemptEvidence(attemptDir), pidIsLive);
      for (const line of formatRecoveryDiagnostic(diagnostic)) lines.push(`${label}: ${line}`);
      if (status.process !== null) {
        const live = pidIsLive(status.process.pid);
        lines.push(`pid: ${label}: ${status.process.pid} is ${live ? "live" : "absent"}`);
        if (status.lifecycleState === "LANDED" || status.lifecycleState === "BLOCKED" || status.lifecycleState === "CANCELLED") {
          if (live) findings.push(`orphan pid ${status.process.pid}: terminal ${label} still records a live process`);
        } else if (!live) {
          findings.push(`missing pid ${status.process.pid}: active ${label} has no live recorded process`);
        }
      }
      if (diagnostic.controller === "missing-pid-controller-orphan" && diagnostic.finding !== null) {
        findings.push(`${diagnostic.finding}: ${label}`);
      }
      if (diagnostic.controller === "cancelled-live-survivor" && status.process === null && diagnostic.pid !== null) {
        findings.push(`orphan pid ${diagnostic.pid}: terminal ${label} retains a live process`);
      }
    } catch (error) {
      findings.push(`unreadable attempt: ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const dbPath = join(stateRoot, "awsf.db");
  if (await exists(dbPath)) {
    try {
      const db = openDatabase(dbPath, { readonly: true });
      try {
        for (const session of listSessions(db, { archived: false, limit: 10_000 })) {
          if (session.observability_degraded === 1) {
            findings.push(`degraded session ${session.session_id}: run \`awsf db rebuild\``);
          }
        }
      } finally { closeDatabase(db); }
    } catch (error) {
      findings.push(`unreadable projection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  lines.push(`matrix: ${LEGAL_EDGES.length} legal edges across ${TASK_STATES.length} states`);
  lines.push(`attempts: ${attempts.length}; database: ${await exists(dbPath) ? "present" : "not built"}`);
  if (findings.length === 0) lines.push("healthy: no controller orphan, live terminal PID, stale lock, degraded session, or projection finding");
  else lines.push(...findings.map((finding) => `finding: ${finding}`));
  return { healthy: findings.length === 0, lines: Object.freeze(lines) };
}
