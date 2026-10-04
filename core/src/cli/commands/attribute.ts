// `awsf attribute <task> --attempt <n> --cause <model|factory|environment|driver|owner|unknown> --reason "<why>"`
// — the owner's cause record for a BLOCKED or CANCELLED attempt (W18 D4).
//
// The metrics count a block against a route only when it is the model's. The
// heuristic in `metrics/attribution.ts` decides that from the code the run
// blocked on, and it is wrong in ways only the owner can see: the W17 live
// drive's PermissionBreach reads as the model's, but a ticket's own wording
// caused it. This records the owner's judgement, and the role rows take it
// over the heuristic.
//
// It is the OWNER'S, with the shape `degrade-review` uses: an interactive
// terminal first, then a written reason that is never credential-shaped, both
// checked before anything is persisted. A driving session is denied it by verb
// once the owner wires it into the guard (gate G18-C); until then it is not
// registered in `main.ts` at all.
//
// It is stored TASK-SCOPED, as `awsf relate` is and for the same reason. Only
// a BLOCKED or CANCELLED attempt can be attributed, and both are sealed: writing
// into it would reopen sealed bytes. So the record goes in `attributions.jsonl`
// beside the task's attempt directories, and `awsf db rebuild` replays it.
//
// It is append-only and repeatable. A second attribution of the same attempt
// is the owner changing their mind; the latest wins and the earlier one stays
// on file.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { readAttempt, taskRoot, type AttemptStatus } from "./attempt.ts";
import {
  ATTRIBUTION_CAUSES,
  ATTRIBUTION_RECORD_SCHEMA_ID,
  isAttributionCause,
  type AttributionRecord,
} from "../../contracts/attribution-record.ts";
import { appendTaskAttribution, attemptAttribution } from "../../persistence/task-attributions.ts";
import { REDACTED_VALUE, scrubCredentialString } from "../../policy/redaction.ts";
import type { OwnerTerminal } from "../tty.ts";

const MAX_REASON = 2_000;

export class AttributeNotInteractive extends Error {
  constructor(taskId: string) {
    super(
      `awsf attribute ${taskId} requires an interactive owner terminal: attributing a block is the owner's act, ` +
        "and a piped or redirected stdin cannot make it",
    );
    this.name = "AttributeNotInteractive";
  }
}

export class AttributeUnknownCause extends Error {
  constructor(cause: string) {
    super(`--cause read ${JSON.stringify(cause)}; an attempt is attributed to one of ${ATTRIBUTION_CAUSES.join(", ")}`);
    this.name = "AttributeUnknownCause";
  }
}

export class AttributeReasonRequired extends Error {
  constructor() {
    super("awsf attribute requires --reason naming why this attempt is attributed so; it is a record, never a key");
    this.name = "AttributeReasonRequired";
  }
}

export class AttributeCredentialRejected extends Error {
  constructor(source: string) {
    super(`attribution rejected ${source}: credential-shaped data is never persisted`);
    this.name = "AttributeCredentialRejected";
  }
}

export class AttributeAttemptMissing extends Error {
  constructor(project: string, taskId: string, attempt: unknown) {
    super(`${project}/${taskId} has no attempt ${JSON.stringify(attempt)}; --attempt names an existing attempt number`);
    this.name = "AttributeAttemptMissing";
  }
}

export class AttributeAttemptNotAttributable extends Error {
  constructor(project: string, taskId: string, attempt: number, state: string) {
    super(`${project}/${taskId} attempt ${attempt} is ${state}: only BLOCKED or CANCELLED attempts can be attributed`);
    this.name = "AttributeAttemptNotAttributable";
  }
}

export interface AttributeCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly cause: string;
  readonly reason: string;
  readonly terminal: OwnerTerminal;
  /** Projects the record onto the attempt's session, as `projectRelation` does for `awsf relate`. */
  readonly projectAttribution?: (record: AttributionRecord) => void;
  readonly now?: () => string;
}

export interface AttributeCommandResult {
  readonly confirmed: boolean;
  /** The record written, or `null` when the owner declined. */
  readonly record: AttributionRecord | null;
  /** The attribution in force before this one, if the owner had made one. */
  readonly previous: AttributionRecord | null;
}

/** The owner's written record of why this attempt is attributed so. */
export function assertAttributeReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) throw new AttributeReasonRequired();
  const bounded = normalized.length <= MAX_REASON ? normalized : normalized.slice(0, MAX_REASON);
  if (scrubCredentialString(bounded) !== bounded || bounded.includes(REDACTED_VALUE)) {
    throw new AttributeCredentialRejected("owner attribution reason");
  }
  return bounded;
}

async function readNamedAttempt(options: AttributeCommandOptions, root: string): Promise<AttemptStatus> {
  const { project, taskId, attempt } = options;
  if (!Number.isInteger(attempt) || attempt < 1) throw new AttributeAttemptMissing(project, taskId, attempt);
  const attemptDir = join(root, String(attempt));
  try {
    await access(attemptDir);
  } catch {
    throw new AttributeAttemptMissing(project, taskId, attempt);
  }
  return readAttempt(attemptDir);
}

export async function attributeCommand(options: AttributeCommandOptions): Promise<AttributeCommandResult> {
  const { project, taskId, attempt } = options;
  // The medium first: a caller that cannot type into a terminal cannot take
  // this act, whatever it asks for, and nothing is read on its behalf.
  if (!options.terminal.interactive) throw new AttributeNotInteractive(taskId);
  if (!isAttributionCause(options.cause)) throw new AttributeUnknownCause(options.cause);
  const cause = options.cause;
  const reason = assertAttributeReason(options.reason);

  const root = taskRoot(options.stateRoot, project, taskId);
  const status = await readNamedAttempt(options, root);
  // Both admissible states are terminal, so the state cannot move before the write.
  if (status.lifecycleState !== "BLOCKED" && status.lifecycleState !== "CANCELLED") {
    throw new AttributeAttemptNotAttributable(project, taskId, attempt, status.lifecycleState);
  }
  const previous = await attemptAttribution(root, attempt);

  options.terminal.write(`Task: ${project}/${taskId} attempt ${attempt}, T${status.tier}, ${status.workflow}, ${status.lifecycleState}`);
  options.terminal.write(`Last activity: ${status.lastActivity}`);
  options.terminal.write(previous === null
    ? status.lifecycleState === "BLOCKED"
      ? "No owner attribution is on record; the metrics use the heuristic."
      : "No owner attribution is on record; a cancelled attempt has no heuristic cause."
    : `On record: ${previous.cause} (${previous.at}): ${previous.reason}`);
  options.terminal.write(`New attribution: ${cause}`);
  options.terminal.write(`Reason on record: ${reason}`);
  options.terminal.write("Only a model-attributed block counts against the route that ran it. This record gives this attempt its cause; the attempt itself is not reopened, and any earlier record stays on file.");
  const confirmed = await options.terminal.confirm(`Attribute ${taskId} attempt ${attempt} (${status.lifecycleState}) to ${cause}?`);
  if (!confirmed) return { confirmed: false, record: null, previous };

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const record: AttributionRecord = {
    schema: ATTRIBUTION_RECORD_SCHEMA_ID, project, taskId, attempt, cause, reason, at,
  };
  // Durable first, projected second: the record is the journal's, and a
  // projection that cannot be written degrades the screen, never the record.
  await appendTaskAttribution(root, record);
  options.projectAttribution?.(record);
  return { confirmed: true, record, previous };
}
