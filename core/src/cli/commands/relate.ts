// `awsf relate <task> --continues <prior> --reason "<why>"` — the declaration
// that one task continues another, made after the fact.
//
// `awsf new --continues` can only say it while the task is being created. The
// relationship is usually learned later: a task blocks, a second one is opened
// against its findings, and the edge between them is obvious to the driver and
// invisible to the factory. This records it with the SAME authority `awsf new`
// already has, which is why it is not an owner act and constructs no owner
// terminal — a driving session that may create a continuation may also declare
// one.
//
// It is TASK-SCOPED. A continuation is a fact about two tasks, not about two
// attempts, so the value is written where a task's current facts live: its
// latest attempt. That attempt must still be writable. A sealed or landed
// attempt's bytes are never touched to record something learned after it ended
// — the refusal below says so by name rather than letting the write protocol
// report a lock-level failure.
//
// It refuses rather than overwrites. A declaration already on the record was
// made deliberately; replacing it silently would make the edge unauditable, and
// correcting one is a separate explicit act that does not exist yet.

import {
  latestAttemptNumber,
  locateAttempt,
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";
import { SEALED_STATES, type TaskState } from "../../state/task-machine.ts";

const MAX_REASON = 2_000;
/** A chain longer than this is a defect in the data, not a relationship. */
const MAX_CHAIN = 64;

export class RelateReasonRequired extends Error {
  constructor() {
    super('awsf relate requires --reason naming why this task continues the prior one; it is a record, never a key');
    this.name = "RelateReasonRequired";
  }
}

export class RelateCredentialRejected extends Error {
  constructor(source: string) {
    super(`relation rejected ${source}: credential-shaped data is never persisted`);
    this.name = "RelateCredentialRejected";
  }
}

export class RelateSelfReference extends Error {
  constructor(project: string, taskId: string) {
    super(`${project}/${taskId} cannot continue itself; --continues read ${JSON.stringify(taskId)}`);
    this.name = "RelateSelfReference";
  }
}

export class RelateCrossProject extends Error {
  constructor(project: string, named: string, taskId: string) {
    super(
      `--continues read ${JSON.stringify(named)}, which names project ${JSON.stringify(named.split("/")[0] ?? "")}; ` +
        `${project}/${taskId} may only continue a task in ${JSON.stringify(project)}`,
    );
    this.name = "RelateCrossProject";
  }
}

export class RelateMissingPredecessor extends Error {
  constructor(project: string, taskId: string, prior: string) {
    super(
      `${project}/${taskId} cannot continue missing task ${project}/${prior}; ` +
        `no attempt directory exists under ${JSON.stringify(prior)}`,
    );
    this.name = "RelateMissingPredecessor";
  }
}

export class RelateCycle extends Error {
  constructor(project: string, taskId: string, chain: readonly string[]) {
    super(
      `${project}/${taskId} cannot continue ${project}/${chain[0] ?? ""}: that would close a cycle. ` +
        `The declarations already on record read ${[...chain, taskId].join(" -> ")}`,
    );
    this.name = "RelateCycle";
  }
}

export class RelateAlreadyDeclared extends Error {
  constructor(project: string, taskId: string, existing: string) {
    super(
      `${project}/${taskId} already continues ${project}/${existing}; ` +
        "a declaration is not overwritten, and correcting one is a separate explicit act",
    );
    this.name = "RelateAlreadyDeclared";
  }
}

export class RelateAttemptSealed extends Error {
  constructor(project: string, taskId: string, attempt: number, state: TaskState) {
    super(
      `${project}/${taskId} attempt ${attempt} is ${state}, whose bytes are sealed; ` +
        "a relation is declared on a writable attempt, and no sealed attempt is reopened to carry one",
    );
    this.name = "RelateAttemptSealed";
  }
}

export interface RelateCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  /** The prior task. A bare id, or `<project>/<id>` naming this same project. */
  readonly continues: string;
  readonly reason: string;
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
}

export interface RelateCommandResult {
  readonly status: AttemptStatus;
  readonly continuesTask: string;
}

/** The driver's written record of why this edge exists. */
export function assertRelateReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) throw new RelateReasonRequired();
  const bounded = normalized.length <= MAX_REASON ? normalized : normalized.slice(0, MAX_REASON);
  if (scrubCredentialString(bounded) !== bounded || bounded.includes(REDACTED_VALUE)) {
    throw new RelateCredentialRejected("relate reason");
  }
  return bounded;
}

/**
 * Accepts a bare task id, or `<project>/<id>` that names THIS project, and
 * refuses anything pointing elsewhere. `awsf new --continues` cannot express a
 * cross-project link at all — it resolves the value inside its own project's
 * tree — so the refusal here is what makes the same impossibility legible
 * rather than silently reinterpreting a qualified name as a local one.
 */
export function resolveContinues(project: string, taskId: string, named: string): string {
  if (named.includes("/")) {
    const [namedProject, ...rest] = named.split("/");
    const local = rest.length === 1 ? rest[0] ?? "" : "";
    if (namedProject !== project || local === "") throw new RelateCrossProject(project, named, taskId);
    return local;
  }
  return named;
}

/** Continuation declarations already on record, walked from `start` outward. */
async function declaredChain(stateRoot: string, project: string, start: string): Promise<string[]> {
  const chain: string[] = [];
  let cursor: string | null = start;
  while (cursor !== null && chain.length < MAX_CHAIN) {
    chain.push(cursor);
    const located = await locateAttempt(stateRoot, project, cursor);
    const status: AttemptStatus = await readAttempt(located.attemptDir);
    cursor = status.continuesTask;
    if (cursor !== null && chain.includes(cursor)) break;
  }
  return chain;
}

export async function relateCommand(options: RelateCommandOptions): Promise<RelateCommandResult> {
  const { project, taskId } = options;
  const reason = assertRelateReason(options.reason);
  const prior = resolveContinues(project, taskId, options.continues);
  if (prior === taskId) throw new RelateSelfReference(project, taskId);

  // Both tasks are read before anything is written, so every refusal names what
  // it actually found on disk rather than what the flags claimed.
  const located = await locateAttempt(options.stateRoot, project, taskId);
  if (await latestAttemptNumber(taskRoot(options.stateRoot, project, prior)) === null) {
    throw new RelateMissingPredecessor(project, taskId, prior);
  }
  const chain = await declaredChain(options.stateRoot, project, prior);
  if (chain.includes(taskId)) throw new RelateCycle(project, taskId, chain);

  const status = await readAttempt(located.attemptDir);
  if (status.continuesTask !== null) throw new RelateAlreadyDeclared(project, taskId, status.continuesTask);
  if ((SEALED_STATES as readonly TaskState[]).includes(status.lifecycleState) || status.lifecycleState === "LANDED") {
    throw new RelateAttemptSealed(project, taskId, status.attempt, status.lifecycleState);
  }

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const next = nextRevision(status, {
    continuesTask: prior,
    lastActivityAt: at,
    lastActivity: `declared that ${taskId} continues ${prior}: ${reason}`,
    // The lifecycle did not move, so neither does the recommendation. Declaring
    // a relationship is a record, never a state change.
    nextAction: nextActionFor(status.lifecycleState, taskId),
  });
  const persisted = await persistAttempt(located.attemptDir, status.revision, {
    kind: "attempt.updated",
    next,
    evidence: { type: "task-relation", taskId, continuesTask: prior, reason, attempt: status.attempt, at },
  }, options.projectRecord);
  return { status: persisted, continuesTask: prior };
}
