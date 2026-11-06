// awsf delegate replay [--project P] [--live] (W19 task 7).
//
// Walks every task's attempt journals, rebuilds the stop facts at each
// historical stop, runs the shadow policy, and appends one delegate.replay per
// stop to the state root's delegate/replays.jsonl. Without --live it asks no
// one (numbers-only) and makes no network call. With --live it asks
// stop-judgment once per stop, after the owner confirms at the terminal. It
// never writes into a task: replays and live decision records stay under
// <state-root>/delegate/.
//
// Unregistered in main.ts until gate G19-C (task 9) wires the delegate verbs.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { AttemptEvent, AttemptStatus } from "./attempt.ts";
import type { OwnerTerminal } from "../tty.ts";
import { JevTransport } from "../../decision/jev-transport.ts";
import { readJevProjectSwitch } from "../../decision/jev-project.ts";
import { discoverAttempts } from "../../observability/rebuild.ts";
import type { JournalRecord } from "../../persistence/journal.ts";
import { journalFilePath } from "../../persistence/platform-paths.ts";
import { scanJournal } from "../../persistence/replay.ts";
import { readTaskDelegateProposals } from "../../persistence/task-delegate.ts";
import { appendDelegateReplays, delegateStateDir, readDelegateReplays } from "../../persistence/delegate-replays.ts";
import type { JevSwitch } from "../../registry/catalog-schema.ts";
import { readPlacement } from "../../registry/placement.ts";
import { pairAttempt, type Pair } from "../../delegate/agreement.ts";
import type { PhaseRoles } from "../../delegate/policy.ts";
import { judgeStop } from "../../delegate/stop-judge.ts";
import {
  effectiveReplays,
  historicalStopIndices,
  journalPhases,
  NUMBERS_ONLY_JUDGE,
  replayAttempt,
  stopKey,
  type DelegateReplayRecord,
  type ReplayJudge,
  type ReplayMode,
} from "../../delegate/replay.ts";
import type { StopFactsConfig } from "../../delegate/stop-facts.ts";

export interface DelegateReplayOptions {
  readonly stateRoot: string;
  readonly project?: string;
  readonly live: boolean;
  readonly terminal: OwnerTerminal;
  /** Live mode only. Defaults to a transport built from the catalog's switch and `env`. */
  readonly transport?: Pick<JevTransport, "ask">;
  readonly catalogPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The phases the stop facts read; defaults to the phases the attempt's own journal records. */
  readonly phasesFor?: (status: AttemptStatus, records: readonly JournalRecord<AttemptEvent>[]) => Promise<{ config: StopFactsConfig; roles: PhaseRoles }>;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface DelegateReplayResult {
  readonly mode: ReplayMode;
  readonly recorded: readonly DelegateReplayRecord[];
  readonly skipped: number;
  /** Every in-scope stop's effective replay, paired with the act its journal shows next. */
  readonly pairs: readonly Pair[];
  readonly confirmed: boolean;
}

export class DelegateReplayNotInteractive extends Error {
  constructor() {
    super("awsf delegate replay --live asks Jev once per stop and needs the owner at an interactive terminal; run it without --live for the numbers-only replay");
    this.name = "DelegateReplayNotInteractive";
  }
}

interface AttemptSource {
  readonly dir: string;
  readonly project: string;
  readonly records: readonly JournalRecord<AttemptEvent>[];
}

export async function projectSwitch(
  catalogPath?: string,
  repositoryOrStatus?: string | { readonly repository?: string },
  stateRoot?: string,
  project?: string,
): Promise<JevSwitch> {
  let resolvedPath = catalogPath;
  const repository = typeof repositoryOrStatus === "string" ? repositoryOrStatus : repositoryOrStatus?.repository;
  if (resolvedPath === undefined && repository) {
    resolvedPath = join(repository, "awsf.project.yaml");
  }
  if (resolvedPath === undefined && stateRoot !== undefined && project !== undefined) {
    try {
      const placement = await readPlacement(stateRoot, project);
      for (const repo of Object.values(placement.repositories)) {
        const candidate = join(repo.path, "awsf.project.yaml");
        try {
          await readFile(candidate, "utf8");
          resolvedPath = candidate;
          break;
        } catch {
          // keep searching
        }
      }
      if (resolvedPath === undefined) {
        const first = Object.values(placement.repositories)[0];
        if (first) resolvedPath = join(first.path, "awsf.project.yaml");
      }
    } catch {
      // placement not found
    }
  }
  // No identified project catalog is not permission to use the schema's on default.
  if (resolvedPath === undefined) return "off";
  return (await readJevProjectSwitch(resolvedPath)).value;
}

async function attemptsInScope(stateRoot: string, project: string | undefined): Promise<AttemptSource[]> {
  const out: AttemptSource[] = [];
  for (const dir of await discoverAttempts(stateRoot)) {
    const parts = relative(stateRoot, dir).split(sep);
    const owner = parts[1] ?? "";
    if (project !== undefined && owner !== project) continue;
    const scanned = await scanJournal<AttemptEvent>(journalFilePath(dir));
    if (!scanned.ok) throw new Error(`attempt journal corrupt at ${scanned.badKey} (${dir})`);
    out.push({ dir, project: owner, records: scanned.records });
  }
  return out;
}

function perAct(pairs: readonly Pair[]): string[] {
  const counts = new Map<string, { match: number; mismatch: number; none: number }>();
  for (const pair of pairs) {
    const row = counts.get(pair.proposedAct) ?? { match: 0, mismatch: 0, none: 0 };
    row[pair.outcome] += 1;
    counts.set(pair.proposedAct, row);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([act, row]) => `${act}: match ${String(row.match)}, mismatch ${String(row.mismatch)}, none ${String(row.none)}`);
}

export async function delegateReplayCommand(options: DelegateReplayOptions): Promise<DelegateReplayResult> {
  const mode: ReplayMode = options.live ? "live" : "numbers-only";
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? randomUUID;
  const attempts = await attemptsInScope(options.stateRoot, options.project);

  // A stop with a live proposal is already counted; a stop this mode replayed is not replayed again.
  const existing = await readDelegateReplays(options.stateRoot);
  const skipByTask = new Map<string, Set<string>>();
  for (const source of attempts) {
    const taskRoot = dirname(source.dir);
    if (skipByTask.has(taskRoot)) continue;
    const skip = new Set((await readTaskDelegateProposals(taskRoot)).map((proposal) => stopKey(proposal.sessionId, proposal.statusRevision)));
    skipByTask.set(taskRoot, skip);
  }
  for (const record of existing) {
    if (record.mode !== mode && !(mode === "numbers-only" && record.mode === "live")) continue;
    for (const source of attempts) {
      const status = source.records[0]?.event.next;
      if (status !== undefined && status.taskId === record.taskId && source.project === record.project) {
        skipByTask.get(dirname(source.dir))!.add(stopKey(record.sessionId, record.statusRevision));
      }
    }
  }
  let pending = 0;
  let skipped = 0;
  for (const source of attempts) {
    const skip = skipByTask.get(dirname(source.dir))!;
    for (const index of historicalStopIndices(source.records)) {
      const status = source.records[index]!.event.next;
      if (skip.has(stopKey(status.sessionId, status.revision))) skipped += 1;
      else pending += 1;
    }
  }

  let judge: ReplayJudge = NUMBERS_ONLY_JUDGE;
  if (mode === "live") {
    if (!options.terminal.interactive) throw new DelegateReplayNotInteractive();
    const confirmed = pending === 0 || await options.terminal.confirm(`Ask Jev (stop-judgment) once for each of ${String(pending)} historical stop(s)?`);
    if (!confirmed) {
      options.terminal.write("replay: not confirmed; nothing asked and nothing written");
      return { mode, recorded: [], skipped: 0, pairs: [], confirmed: false };
    }
    const firstStatus = attempts[0]?.records[0]?.event.next ?? attempts[0]?.records.at(-1)?.event.next;
    const transport = options.transport ?? new JevTransport({
      projectSwitch: await projectSwitch(
        options.catalogPath,
        firstStatus,
        options.stateRoot,
        options.project ?? firstStatus?.project,
      ),
      env: options.env ?? {},
    });
    const decisionsDir = delegateStateDir(options.stateRoot);
    judge = (facts, allowedActs) => judgeStop(facts, {
      transport,
      taskRoot: decisionsDir,
      caller: "replay",
      transportFailure: "propagate",
      allowedActs,
      now,
      newId,
    });
  }

  const replayId = newId();
  const replayedAt = now();
  const recorded: DelegateReplayRecord[] = [];
  for (const source of attempts) {
    const status = source.records.at(-1)?.event.next;
    if (status === undefined) continue;
    const skip = skipByTask.get(dirname(source.dir))!;
    const phases = options.phasesFor === undefined ? journalPhases(source.records) : await options.phasesFor(status, source.records);
    recorded.push(...await replayAttempt({
      project: source.project, records: source.records, phases, mode, judge, skip, replayId, replayedAt, newId,
    }));
  }
  await appendDelegateReplays(options.stateRoot, recorded);

  // Agreement over every in-scope stop's effective replay, recomputed from the journals just read.
  const effective = effectiveReplays([...existing, ...recorded]);
  const pairs: Pair[] = [];
  for (const source of attempts) {
    const status = source.records[0]?.event.next;
    if (status === undefined) continue;
    const mine = effective.filter((record) => record.project === source.project && record.taskId === status.taskId && record.attempt === status.attempt);
    pairs.push(...pairAttempt(mine, source.records, "replay"));
  }
  options.terminal.write(`replay (${mode}): ${String(recorded.length)} stop(s) replayed, ${String(skipped)} skipped (a live proposal or an earlier ${mode} replay)`);
  for (const line of perAct(pairs)) options.terminal.write(line);
  options.terminal.write(`records: ${join(delegateStateDir(options.stateRoot), "replays.jsonl")}`);
  return { mode, recorded, skipped, pairs, confirmed: true };
}
