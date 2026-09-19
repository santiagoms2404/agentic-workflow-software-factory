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
// It is TASK-SCOPED, and it is stored that way. The first cut wrote it onto the
// task's newest attempt, because that is where a task's current facts live;
// real data showed the cost. An attempt in BLOCKED, CANCELLED or PUBLISHED is
// sealed, so `relate` refused — and on the owner's real projection twenty-two
// of forty-four runs were BLOCKED. Half the history could never record "this
// task continued that one" after the fact, which is exactly when the
// relationship is usually learned.
//
// So the declaration goes in `relations.jsonl` beside the task's attempt
// directories. No sealed attempt is reopened, no attempt needs to be writable,
// and `awsf new --continues` keeps writing the attempt field as it always has —
// a different act with a different record. `declaredContinuation` below is the
// read rule: the task-scoped declaration wins where one exists.
//
// It refuses rather than overwrites. A declaration already on the record was
// made deliberately; replacing it silently would make the edge unauditable, and
// correcting one is a separate explicit act that does not exist yet.

import { latestAttemptNumber, locateAttempt, readAttempt, taskRoot } from "./attempt.ts";
import {
  appendTaskRelation,
  declaredContinuation as declaredRelation,
  type TaskRelation,
} from "../../persistence/task-relations.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";

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

export interface RelateCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  /** The prior task. A bare id, or `<project>/<id>` naming this same project. */
  readonly continues: string;
  readonly reason: string;
  /** Projects the declaration onto every already-recorded session of the task. */
  readonly projectRelation?: (relation: TaskRelation) => void;
  readonly now?: () => string;
}

export interface RelateCommandResult {
  readonly relation: TaskRelation;
  readonly continuesTask: string;
  /** Attempts of this task the declaration now applies to. */
  readonly attempts: number;
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

/**
 * What a task continues, by either act.
 *
 * The task-scoped declaration wins where one exists, because it is the later
 * and more specific statement: `awsf new --continues` says what was known when
 * the task was created, and `awsf relate` says what was learned afterwards.
 */
export async function declaredContinuation(
  stateRoot: string,
  project: string,
  taskId: string,
): Promise<string | null> {
  const relation = await declaredRelation(taskRoot(stateRoot, project, taskId));
  if (relation !== null) return relation.continuesTask;
  const located = await locateAttempt(stateRoot, project, taskId);
  return (await readAttempt(located.attemptDir)).continuesTask;
}

/** Continuation declarations already on record, walked from `start` outward. */
async function declaredChain(stateRoot: string, project: string, start: string): Promise<string[]> {
  const chain: string[] = [];
  let cursor: string | null = start;
  while (cursor !== null && chain.length < MAX_CHAIN) {
    chain.push(cursor);
    cursor = await declaredContinuation(stateRoot, project, cursor);
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
  // it actually found on disk rather than what the flags claimed. The task must
  // exist — `locateAttempt` refuses otherwise — but its attempts may be sealed,
  // which is no longer a refusal.
  const root = taskRoot(options.stateRoot, project, taskId);
  const attempts = await latestAttemptNumber(root);
  if (attempts === null) throw new Error(`no attempt exists for ${project}/${taskId}; run \`awsf new ${taskId} ...\``);
  if (await latestAttemptNumber(taskRoot(options.stateRoot, project, prior)) === null) {
    throw new RelateMissingPredecessor(project, taskId, prior);
  }
  const chain = await declaredChain(options.stateRoot, project, prior);
  if (chain.includes(taskId)) throw new RelateCycle(project, taskId, chain);

  const existing = await declaredContinuation(options.stateRoot, project, taskId);
  if (existing !== null) throw new RelateAlreadyDeclared(project, taskId, existing);

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const relation: TaskRelation = {
    schema: "awsf/task-relation/v1", project, taskId, continuesTask: prior, reason, at,
  };
  // Durable first, projected second: the declaration is the journal's, and a
  // projection that cannot be written degrades the screen, never the record.
  await appendTaskRelation(root, relation);
  options.projectRelation?.(relation);
  return { relation, continuesTask: prior, attempts };
}
