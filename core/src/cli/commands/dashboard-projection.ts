import { join } from "node:path";
import {
  assertAdvancementPermitted,
  observabilityDegraded,
} from "../../observability/rebuild.ts";
import { projectAttemptStatus } from "../../observability/projector.ts";
import { openDatabase, type DatabaseSync } from "../../observability/sqlite.ts";
import type { AttemptAdvancementGuard, AttemptProjector } from "./attempt.ts";
import { toAttemptStatusProjection } from "./attempt-projection.ts";

export interface DashboardProjection {
  readonly project: AttemptProjector;
  readonly assertAdvancement: AttemptAdvancementGuard;
  close(): void;
}

/**
 * Opens one lazy writer for a CLI invocation and occupies the durable write
 * protocol's project step. A broken copy never aborts journal/status writes;
 * it does activate the existing beyond-GATING hold.
 */
export function createDashboardProjection(
  stateRoot: string,
  notice: (message: string) => void = () => {},
): DashboardProjection {
  const path = join(stateRoot, "awsf.db");
  const degraded = new Set<string>();
  let db: DatabaseSync | null = null;

  const database = (): DatabaseSync => {
    db ??= openDatabase(path);
    return db;
  };

  const reportUnavailable = (sessionId: string): void => {
    degraded.add(sessionId);
    notice(`sqlite-projection-failed: session ${sessionId} is journaled but its dashboard projection is unavailable; run \`awsf db rebuild\`.`);
  };

  return {
    project(record, status): void {
      try {
        const writer = database();
        const outcome = projectAttemptStatus(
          writer,
          toAttemptStatusProjection(stateRoot, status),
          record.source_seq,
        );
        if (!outcome.ok) reportUnavailable(status.sessionId);
        else if (observabilityDegraded(writer, status.sessionId)) degraded.add(status.sessionId);
      } catch {
        reportUnavailable(status.sessionId);
      }
    },
    assertAdvancement(sessionId, to): void {
      let isDegraded = degraded.has(sessionId);
      if (!isDegraded) {
        try {
          isDegraded = observabilityDegraded(database(), sessionId);
        } catch {
          isDegraded = true;
        }
      }
      assertAdvancementPermitted({ sessionId, to, degraded: isDegraded });
    },
    close(): void {
      if (db === null) return;
      try {
        // Ordinary writer shutdown must not force a truncating checkpoint
        // against the dashboard's concurrent readonly WAL connection.
        db.close();
      } catch {
        notice("sqlite-projection-failed: the dashboard writer did not close cleanly; run `awsf db rebuild`.");
      } finally {
        db = null;
      }
    },
  };
}
