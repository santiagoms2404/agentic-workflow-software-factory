import { runSystemCommand } from "../../execution/transport-broker.ts";
import { createHostController } from "../../execution/process-controller.ts";
import type { TerminationReport } from "../../execution/launcher-barrier.ts";
import { transition } from "../../state/task-machine.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

export interface CancelCommandOptions {
  readonly attemptDir: string;
  readonly terminal: OwnerTerminal;
  readonly terminate?: (status: AttemptStatus) => Promise<TerminationReport>;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
}

function noTree(): TerminationReport {
  return { termSent: false, killSent: false, survivors: [], terminated: true, skipped: null };
}

async function terminateRecorded(status: AttemptStatus): Promise<TerminationReport> {
  if (status.process === null) {
    if (status.lifecycleState === "RUNNING") {
      throw new Error("RUNNING attempt has no recorded process identity; refusing to claim an empty survivor list");
    }
    return noTree();
  }
  return createHostController({ command: runSystemCommand }).terminateTree(status.process);
}

export async function cancelCommand(options: CancelCommandOptions): Promise<{ status: AttemptStatus; report: TerminationReport }> {
  const current = await readAttempt(options.attemptDir);
  const cancellable = ["DRAFT", "PREPARED", "RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER"] as const;
  // Invalid states and a piped human are rejected by the ordered machine before
  // confirmation and, critically, before any process can receive a signal.
  if (!(cancellable as readonly string[]).includes(current.lifecycleState) || !options.terminal.interactive) {
    transition({
      from: current.lifecycleState,
      to: "CANCELLED",
      actor: "human",
      tier: current.tier,
      reason: { source: "human" },
      interactive: options.terminal.interactive,
      budget: current.budget,
    });
    throw new Error("unreachable cancellation authorization");
  }
  const confirmed = await options.terminal.confirm(`Cancel ${current.taskId} attempt ${current.attempt}?`);
  if (!confirmed) return { status: current, report: noTree() };

  const report = await (options.terminate ?? terminateRecorded)(current);
  if (current.lifecycleState === "RUNNING" && !report.terminated) {
    throw new Error(`cancellation incomplete; survivors [${report.survivors.join(", ")}]`);
  }
  const decision = transition({
    from: current.lifecycleState,
    to: "CANCELLED",
    actor: "human",
    tier: current.tier,
    reason: { source: "human", detail: "explicit CLI cancellation" },
    interactive: true,
    budget: current.budget,
    ...(current.lifecycleState === "RUNNING"
      ? { evidence: { treeTerminated: report.terminated, survivorsReported: true } }
      : {}),
  });
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  const next = nextRevision(current, {
    lifecycleState: decision.to,
    process: null,
    lastActivityAt: now,
    lastActivity: `cancelled; TERM ${report.termSent ? "sent" : "not sent"}, KILL ${report.killSent ? "sent" : "not sent"}, survivors [${report.survivors.join(", ")}]`,
    nextAction: nextActionFor(decision.to, current.taskId),
  });
  return {
    status: await persistAttempt(
      options.attemptDir,
      current.revision,
      { kind: "attempt.transitioned", next },
      options.projectRecord,
    ),
    report,
  };
}
