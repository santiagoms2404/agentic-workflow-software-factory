// K1 for every test that starts an attempt (specs/awsf-v3-w01-driver-checks.html,
// task 11). From task 11 on, `awsf start` refuses L1 without a fresh
// driver-preflight record and the owner's matching confirmation, and it has no
// seam that skips that check. So a test that needs a PREPARED attempt writes
// both records the way the factory does: the real `awsf preflight` path on the
// attempt's own synthetic repository, then the real `awsf confirm` path driven
// by a scripted interactive terminal standing in for the owner.
//
// The only substitution is preflight's own gate-runner seam: the configured
// gates are dispatched to a recorder that reports each exit status instead of
// running the project's suites inside a synthetic repository. Every other field
// is measured from Git, the configuration and the journal as in production.
//
// W02's traps can reuse `prepareK1` to reach a confirmed DRAFT and then break
// one fact before `awsf start`.

import { resolve } from "node:path";
import type { AttemptProjector, AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { confirmCommand } from "../../src/cli/commands/confirm.ts";
import { preflightCommand, priorAttemptStatuses } from "../../src/cli/commands/preflight.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { startCommand, type StartCommandOptions } from "../../src/cli/commands/start.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import { workflowRecipe } from "../../src/workflow/catalog.ts";
import type { DriverPreflightRecord, PreflightRefusedRecord, RequestConfirmationRecord } from "../../src/contracts/driver-preflight.ts";
import { extractPathTokens, parseRequestLines } from "../../src/preflight/fields.ts";
import type { GateCommandRunner } from "../../src/preflight/suite.ts";

/** A request in K1's four labelled lines. `where` is spelled into the Where line verbatim. */
export function k1Request(ask: string, where: string, done = "the change exists and its tests pass", outOfScope = "everything else"): string {
  return [`Ask: ${ask}`, `Where: ${where}`, `Done means: ${done}`, `Out of scope: ${outOfScope}`].join("\n");
}

/**
 * A four-line request whose Where line suits the workflow: `path` when one of
 * its agent phases writes the repository, otherwise a line naming no path,
 * because a read-only recipe has no role that could write one.
 */
export function k1RequestFor(ask: string, workflow: string, agents: AwsfConfig["agents"], path = "core/src/generated.ts"): string {
  const recipe = workflowRecipe(workflow);
  const writers = new Map(agents.map((agent) => [agent.name, agent.writes.length > 0]));
  const writes = recipe === null || recipe.phases.some((phase) => phase.kind === "agent" && writers.get(phase.owner) === true);
  return k1Request(ask, writes ? path : "nothing; this workflow writes no repository file");
}

/** Every configured gate reports `exit(gateId)`; nothing is spawned. */
export function recordedGates(exit: (argv: readonly string[]) => number = () => 0): GateCommandRunner {
  return (_executable, argv) => ({ status: exit(argv), stdout: "", stderr: "", error: null });
}

/** The owner at an interactive terminal, answering `answer` to the one question confirm asks. */
export function scriptedOwner(answer = true): OwnerTerminal {
  return { interactive: true, write: () => undefined, confirm: async () => answer };
}

export interface K1Preparation {
  readonly attemptDir: string;
  readonly configPath: string;
  /** The machine-local worktree root; preflight's baseline worktree lives under it, as in production. */
  readonly worktreeRoot: string;
  /** Defaults to the attempt's state root, derived from its directory. */
  readonly stateRoot?: string;
  /** Defaults to every path-shaped word of the request's Where line. */
  readonly where?: readonly string[];
  readonly read?: readonly string[];
  /** Defaults to every session the journal holds for earlier attempts and continued tasks. */
  readonly consulted?: readonly string[];
  /** False leaves the attempt unconfirmed. */
  readonly confirm?: boolean;
  readonly runCommand?: GateCommandRunner;
  readonly projectRecord?: AttemptProjector;
}

export interface K1Prepared {
  readonly record: DriverPreflightRecord;
  readonly confirmation: RequestConfirmationRecord | null;
  readonly status: AttemptStatus;
}

/** `<root>/projects/<project>/tasks/<task>/<attempt>`, as `awsf start` derives it. */
export function stateRootOf(attemptDir: string): string {
  return resolve(attemptDir, "..", "..", "..", "..", "..");
}

/** The path-shaped words of the request's Where line, which is what a driver would pass as `--where`. */
export function whereOf(request: string): string[] {
  const parsed = parseRequestLines(request);
  return parsed.ok ? extractPathTokens(parsed.lines.where).map((token) => token.text) : [];
}

/** Runs `awsf preflight` and, unless told not to, the owner's `awsf confirm`, on one DRAFT attempt. */
export async function prepareK1(options: K1Preparation): Promise<K1Prepared> {
  const status = await readAttempt(options.attemptDir);
  const stateRoot = options.stateRoot ?? stateRootOf(options.attemptDir);
  const consulted = options.consulted ?? [...new Set((await priorAttemptStatuses(stateRoot, status)).map((prior) => prior.sessionId))];
  const preflight = await preflightCommand({
    attemptDir: options.attemptDir, stateRoot, worktreeRoot: options.worktreeRoot, configPath: options.configPath,
    where: options.where ?? whereOf(status.request), read: options.read ?? [], consulted,
    runCommand: options.runCommand ?? recordedGates(),
    ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }),
  });
  if (options.confirm === false) return { record: preflight.record, confirmation: null, status: preflight.status };
  const confirmed = await confirmCommand({
    stateRoot, project: status.project, taskId: status.taskId, attempt: status.attempt, terminal: scriptedOwner(),
    ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }),
  });
  return { record: preflight.record, confirmation: confirmed.record, status: await readAttempt(options.attemptDir) };
}

export type K1StartOptions = StartCommandOptions & {
  /** Overrides for the preflight and confirmation written before start. */
  readonly k1?: Partial<Omit<K1Preparation, "attemptDir" | "worktreeRoot" | "projectRecord">>;
};

/** Writes K1's two records, then runs the real `awsf start`. */
export async function startUnderK1(options: K1StartOptions): Promise<AttemptStatus> {
  const { k1, ...start } = options;
  const status = await readAttempt(start.attemptDir);
  await prepareK1({
    attemptDir: start.attemptDir, worktreeRoot: start.worktreeRoot,
    configPath: start.configPath ?? resolve(status.repository, "awsf.config.yaml"),
    ...(start.projectRecord === undefined ? {} : { projectRecord: start.projectRecord }),
    ...k1,
  });
  return startCommand(start);
}

/** The attempt's preflight-refused records, oldest first. */
export async function refusals(attemptDir: string): Promise<PreflightRefusedRecord[]> {
  return (await readAttemptEvidence(attemptDir)).flatMap((evidence) => evidence.type === "preflight-refused" ? [evidence.record] : []);
}
