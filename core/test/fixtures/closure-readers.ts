import { join } from "node:path";
import { newCommand } from "../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import { sealTicketSelection } from "../../src/contracts/ticket-selection-record.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import type { ClosureRecord } from "../../src/contracts/closure-record.ts";
import { withClosureJournal } from "../../src/persistence/closure-journal.ts";
import { CLOSURE_CUT } from "../../src/closure/model.ts";
import { runGit, systemGitRunner } from "../../src/git/changes.ts";

/** Synthetic journal facts only: never closes or lands against the working checkout. */
export async function selectedLanding(world: { stateRoot: string; repository: string }, options: {
  project?: string; taskId?: string; at?: string; selected?: boolean; shift?: boolean;
} = {}) {
  const project = options.project ?? "agentic-workflow-software-factory";
  const tickets = [{ id: "T01", path: "specs/tickets/synthetic/T01.md", digest: "1".repeat(64) }];
  const selected = options.selected === false ? {} : options.shift
    ? { shift: sealShiftManifest({ plan: "synthetic", milestones: ["M1"], tickets }) }
    : { ticketSelection: sealTicketSelection({ plan: "synthetic", tickets }) };
  const created = await newCommand({ stateRoot: world.stateRoot, repository: world.repository, project,
    taskId: options.taskId ?? "selected-landing", planRef: "synthetic", workflow: options.shift ? "shift" : "build-review", tier: 2,
    request: "Synthetic completed work, not the next request.", ...selected });
  const sha = runGit(systemGitRunner(world.repository), ["rev-parse", "HEAD"]).trim();
  const status = await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.transitioned",
    next: nextRevision(created.status, { lifecycleState: "LANDED", candidateSha: sha,
      lastActivityAt: options.at ?? "2026-10-09T22:02:57Z" }) });
  return { attemptDir: created.attemptDir, status, cut: CLOSURE_CUT };
}

export function syntheticClosure(candidateSha: string, open = false): ClosureRecord {
  const row = { path: "specs/synthetic.html", ticket: "T01", taskNumber: 1, rowIndex: 0, oldValue: "", newValue: "" };
  return { schema: "awsf.closure-record/v1", id: "synthetic-closure", plan: "synthetic", tickets: ["T01"],
    candidateSha, parentSha: candidateSha, commitSha: candidateSha, rowsClosed: [], rowsLeftOpen: open ? [row] : [],
    notClosable: [], blobs: [], at: "2026-10-09T22:03:00Z" };
}

export async function recordSyntheticClosure(attemptDir: string, record: ClosureRecord, prepared = false): Promise<void> {
  await withClosureJournal(attemptDir, undefined, async (_status, _rows, append) => {
    await append({ type: prepared ? "closure-prepared" : "closure-record", record });
  });
}
export function projectDir(attemptDir: string): string { return join(attemptDir, "..", "..", ".."); }
