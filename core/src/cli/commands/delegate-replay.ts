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
import { decide } from "../../decision/decide.ts";
import { JevTransport } from "../../decision/jev-transport.ts";
import { STOP_JUDGMENT } from "../../decision/question-sets/stop-judgment.ts";
import { discoverAttempts } from "../../observability/rebuild.ts";
import type { JournalRecord } from "../../persistence/journal.ts";
import { journalFilePath } from "../../persistence/platform-paths.ts";
import { scanJournal } from "../../persistence/replay.ts";
import { readTaskDelegateProposals } from "../../persistence/task-delegate.ts";
import { appendDelegateReplays, delegateStateDir, readDelegateReplays } from "../../persistence/delegate-replays.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import { jevSwitchOf, type JevSwitch } from "../../registry/catalog-schema.ts";
import { pairAttempt, type Pair } from "../../delegate/agreement.ts";
import type { PhaseRoles } from "../../delegate/policy.ts";
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

async function projectSwitch(catalogPath: string | undefined): Promise<JevSwitch> {
  if (catalogPath === undefined) return "on";
  try {
    return jevSwitchOf(loadCatalog(await readFile(catalogPath, "utf8")));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "on" : "off";
  }
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
  const pending = attempts.reduce((total, source) => total + historicalStopIndices(source.records).filter((index) => {
    const status = source.records[index]!.event.next;
    return !skipByTask.get(dirname(source.dir))!.has(stopKey(status.sessionId, status.revision));
  }).length, 0);

  let judge: ReplayJudge = NUMBERS_ONLY_JUDGE;
  if (mode === "live") {
    if (!options.terminal.interactive) throw new DelegateReplayNotInteractive();
    const confirmed = pending === 0 || await options.terminal.confirm(`Ask Jev (stop-judgment) once for each of ${String(pending)} historical stop(s)?`);
    if (!confirmed) {
      options.terminal.write("replay: not confirmed; nothing asked and nothing written");
      return { mode, recorded: [], skipped: 0, pairs: [], confirmed: false };
    }
    const transport = options.transport ?? new JevTransport({
      projectSwitch: await projectSwitch(options.catalogPath),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const decisionsDir = delegateStateDir(options.stateRoot);
    judge = async (facts, allowedActs) => {
      try {
        const decided = await decide(STOP_JUDGMENT, { stop: facts }, {
          transport, taskRoot: decisionsDir, project: facts.project, taskId: facts.task, attempt: facts.attempt,
          caller: { kind: "replay", name: facts.stopKind }, params: { allowedActs }, now, newId,
        });
        return { judgment: { outcome: decided.outcome, result: decided.policyResult }, decision: { recordId: decided.recordId, outcome: decided.outcome } };
      } catch {
        return { judgment: { outcome: "unavailable", result: null }, decision: { recordId: null, outcome: "unavailable" } };
      }
    };
  }

  const replayId = newId();
  const replayedAt = now();
  const recorded: DelegateReplayRecord[] = [];
  let skipped = 0;
  for (const source of attempts) {
    const status = source.records.at(-1)?.event.next;
    if (status === undefined) continue;
    const skip = skipByTask.get(dirname(source.dir))!;
    skipped += historicalStopIndices(source.records).filter((index) => {
      const next = source.records[index]!.event.next;
      return skip.has(stopKey(next.sessionId, next.revision));
    }).length;
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
