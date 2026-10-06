// `awsf confirm <task>` — the owner's confirmation of a DRAFT attempt's request
// and its paths (specs/awsf-v3-w01-driver-checks.html, task 10; K1's
// `confirmation` field, the only one the host cannot measure).
//
// It is the OWNER'S, with the shape `attribute` uses: an interactive terminal
// first, checked before anything is read. Then the owner sees what they are
// confirming: the task and attempt, the four request lines, the `--where` and
// `--read` of the latest driver preflight record, each prior attempt that
// record says was consulted with its blocker and cause, and each K1 field's
// result. On yes it appends one awsf.request-confirmation/v1 record bound to
// the request text and to those two path lists; on no it writes nothing. No
// flag records a confirmation without the terminal.
//
// It is built UNREGISTERED. boundary-claims derives the owner acts from the
// main.ts arms that construct processOwnerTerminal() and requires the guard's
// verbs to equal them, so an arm without its guard verb turns it red. Gate
// G01-C wires it in one owner commit: the main.ts arm, CLI_COMMANDS, the
// owner-act table in core/src/lifecycle/next-steps.ts, the cheatsheet's
// commands and owner-acts lines, and the `confirm` verb in the guard
// (delegation-guard.sh, marimba-guard-rules.mts, marimba-guard.test.ts) with
// the driving documents that enumerate owner acts.
//
// The write is bound to the revision the owner was shown. If the request, a
// preflight record or anything else on the attempt moved while the question
// was open, the append is refused rather than attached to words the owner did
// not read.

import {
  REQUEST_CONFIRMATION_SCHEMA_ID,
  assertRequestConfirmationRecord,
  requestPathsDigest,
  requestTextDigest,
  type DriverPreflightRecord,
  type RequestConfirmationRecord,
} from "../../contracts/driver-preflight.ts";
import { attemptAttribution } from "../../persistence/task-attributions.ts";
import { parseRequestLines } from "../../preflight/fields.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  locateAttempt,
  nextRevision,
  persistAttempt,
  readAttempt,
  taskRoot,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { priorAttemptStatuses } from "./preflight.ts";
import { readAttemptEvidence } from "./review-record.ts";

export class ConfirmNotInteractive extends Error {
  constructor(taskId: string) {
    super(
      `awsf confirm ${taskId} requires an interactive owner terminal: confirming a request is the owner's act, ` +
        "and a piped or redirected stdin cannot make it",
    );
    this.name = "ConfirmNotInteractive";
  }
}

export class ConfirmAttemptNotDraft extends Error {
  constructor(project: string, taskId: string, attempt: number, state: string) {
    super(`${project}/${taskId} attempt ${attempt} is ${state}: only a DRAFT attempt's request can be confirmed`);
    this.name = "ConfirmAttemptNotDraft";
  }
}

export class ConfirmPreflightMissing extends Error {
  constructor(project: string, taskId: string, attempt: number) {
    super(
      `${project}/${taskId} attempt ${attempt} has no driver preflight record yet; the confirmation binds to its --where and --read, ` +
        "so there is nothing to confirm them against",
    );
    this.name = "ConfirmPreflightMissing";
  }
}

export interface ConfirmCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  /** The attempt to confirm; the latest when omitted. */
  readonly attempt?: number;
  readonly terminal: OwnerTerminal;
  readonly projectRecord?: AttemptProjector;
  readonly now?: () => string;
}

export interface ConfirmCommandResult {
  readonly confirmed: boolean;
  /** The record written, or `null` when the owner declined. */
  readonly record: RequestConfirmationRecord | null;
  /** The preflight record whose paths were shown and bound. */
  readonly preflight: DriverPreflightRecord;
}

/** The four labelled lines, or the request as written when it does not have them. */
function requestLines(request: string): string[] {
  const parsed = parseRequestLines(request);
  if (parsed.ok) {
    const { ask, where, doneMeans, outOfScope } = parsed.lines;
    return [`Ask: ${ask}`, `Where: ${where}`, `Done means: ${doneMeans}`, `Out of scope: ${outOfScope}`];
  }
  return [`The request does not have the four lines (${parsed.reason}). As written:`, ...request.split(/\r?\n/u).map((line) => `  ${line}`)];
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

/** One line per consulted session: the attempt it names, its blocker and the owner's cause, when recorded. */
async function consultedLines(stateRoot: string, status: AttemptStatus, consulted: readonly string[]): Promise<string[]> {
  if (consulted.length === 0) return ["Consulted prior attempts: none"];
  const prior = await priorAttemptStatuses(stateRoot, status);
  const lines = ["Consulted prior attempts:"];
  for (const sessionId of consulted) {
    const found = prior.find((attempt) => attempt.sessionId === sessionId);
    if (found === undefined) {
      lines.push(`  ${sessionId}: not an attempt of this task or of a task it continues`);
      continue;
    }
    const blocker = found.blocker === null ? "no blocker recorded" : `blocker ${found.blocker.code}: ${found.blocker.detail}`;
    const cause = await attemptAttribution(taskRoot(stateRoot, found.project, found.taskId), found.attempt);
    lines.push(`  ${sessionId}: ${found.taskId} attempt ${found.attempt}, ${found.lifecycleState}; ${blocker}; ` +
      (cause === null ? "no cause recorded" : `cause ${cause.cause}: ${cause.reason}`));
  }
  return lines;
}

export async function confirmCommand(options: ConfirmCommandOptions): Promise<ConfirmCommandResult> {
  const { project, taskId } = options;
  // The medium first: a caller that cannot type into a terminal cannot take
  // this act, whatever it asks for, and nothing is read on its behalf.
  if (!options.terminal.interactive) throw new ConfirmNotInteractive(taskId);

  const { attemptDir } = await locateAttempt(options.stateRoot, project, taskId, options.attempt);
  const current = await readAttempt(attemptDir);
  if (current.lifecycleState !== "DRAFT") throw new ConfirmAttemptNotDraft(project, taskId, current.attempt, current.lifecycleState);
  const preflight = (await readAttemptEvidence(attemptDir))
    .flatMap((evidence) => evidence.type === "driver-preflight" ? [evidence.record] : []).at(-1);
  if (preflight === undefined) throw new ConfirmPreflightMissing(project, taskId, current.attempt);
  const requestDigest = requestTextDigest(current.request);

  const say = (line: string): void => { options.terminal.write(line); };
  say(`Task: ${project}/${taskId} attempt ${current.attempt}, T${current.tier}, ${current.workflow}, ${current.lifecycleState}`);
  for (const line of requestLines(current.request)) say(line);
  say(`--where (from the preflight at ${preflight.at}): ${list(preflight.where)}`);
  say(`--read: ${list(preflight.read)}`);
  for (const line of await consultedLines(options.stateRoot, current, preflight.consulted)) say(line);
  say(`Preflight fields at ${preflight.baseSha}:`);
  for (const field of preflight.fields) {
    say(field.passed ? `  ${field.id}: pass` : `  ${field.id}: refused — ${field.reason}`);
  }
  if (preflight.requestDigest !== requestDigest) {
    say("The request was edited after this preflight was measured; its field results describe other text.");
  }
  say("Confirming binds this record to the request text and to --where and --read exactly as shown. Editing any of them later leaves it bound to other words.");
  const confirmed = await options.terminal.confirm(`Confirm the request and paths of ${taskId} attempt ${current.attempt}?`);
  if (!confirmed) return { confirmed: false, record: null, preflight };

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const record: RequestConfirmationRecord = {
    schema: REQUEST_CONFIRMATION_SCHEMA_ID, project, taskId, attempt: current.attempt,
    requestDigest, pathsDigest: requestPathsDigest(preflight.where, preflight.read), at,
  };
  assertRequestConfirmationRecord(record);
  // Bound to the revision shown: a request or preflight that moved while the
  // question was open is a revision conflict, and nothing is written.
  await persistAttempt(attemptDir,current.revision, {
    kind: "attempt.updated",
    next: nextRevision(current, { lastActivityAt: at, lastActivity: "owner confirmed the request and its --where and --read" }),
    evidence: { type: "request-confirmation", record },
  }, options.projectRecord);
  return { confirmed: true, record, preflight };
}
