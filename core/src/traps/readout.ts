import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AttemptEvent, AttemptStatus } from "../cli/commands/attempt.ts";
import { ATTRIBUTION_RECORD_SCHEMA_ID, type AttributionRecord } from "../contracts/attribution-record.ts";
import { assertTrapsReadout, TRAPS_READOUT_SCHEMA_ID, type TrapsReadout } from "../contracts/traps-readout.ts";
import type { JournalRecord } from "../persistence/journal.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { scanJournal } from "../persistence/replay.ts";
import { readTaskAttributions } from "../persistence/task-attributions.ts";
import { readPlacement } from "../registry/placement.ts";
import { NO_TRAPS, NO_TRAP_KINDS, TRAPS, TRAP_CUT } from "./catalogue.ts";
import { isStopSinceCut } from "./population.ts";

/** The transition evidence owns time. Legacy transitions without evidence use their journal stamp, never lastActivityAt. */
export function transitionAt(events: readonly (AttemptEvent & { readonly recordedAt?: string })[], state: string): string | null {
  const event = events.findLast(event => event.kind === "attempt.transitioned" && event.next.lifecycleState === state);
  return transitionTime(event, state, event?.recordedAt);
}

function transitionTime(event: AttemptEvent | undefined, state: string, recordedAt?: string): string | null {
  if (event?.evidence?.type === "transition" && event.evidence.to === state) return event.evidence.at;
  return recordedAt ?? null;
}

interface AttemptFacts {
  readonly status: AttemptStatus;
  readonly terminalAt: string | null;
  readonly landedAt: string | null;
  readonly traps: { readonly passed: boolean | null; readonly sha: string | null };
  readonly attribution: AttributionRecord | null;
}

/** Latest commands_pass row for the final candidate, not another round or an older attempt. */
function trapsGate(status: AttemptStatus, records: readonly JournalRecord<AttemptEvent>[]): AttemptFacts["traps"] {
  const row = records.findLast(({ event }) => event.evidence?.type === "gate"
    && event.evidence.gateId === "commands_pass"
    && event.evidence.candidateSha === status.candidateSha)?.event.evidence;
  if (row?.type !== "gate") return { passed: null, sha: null };
  const checks = row.checks.filter(check => check.item.startsWith("traps:"));
  if (checks.length === 0) return { passed: null, sha: null };
  return { passed: checks.every(check => check.ok), sha: row.candidateSha };
}

export function buildTrapsReadout(projects: readonly string[], attempts: readonly AttemptFacts[]): TrapsReadout {
  const registered = new Set(projects);
  const ids = new Set(TRAPS.map(trap => trap.id));
  const stops: TrapsReadout["stops"] = { total: 0, linkedToTrap: [], linkedToNoTrap: [], missingTrap: [], unlinked: [] };
  const ordered = [...attempts].sort((a, b) => a.status.project.localeCompare(b.status.project)
    || a.status.taskId.localeCompare(b.status.taskId) || a.status.attempt - b.status.attempt);
  for (const facts of ordered) {
    const { status, attribution, terminalAt } = facts;
    if (!isStopSinceCut({ ...status, terminalAt }, registered, TRAP_CUT)) continue;
    const item = { project: status.project, taskId: status.taskId, attempt: status.attempt,
      terminalAt: terminalAt!, lifecycleState: status.lifecycleState as "BLOCKED" | "CANCELLED" };
    stops.total++;
    if (attribution?.schema !== ATTRIBUTION_RECORD_SCHEMA_ID) {
      stops.unlinked.push({ ...item, preLink: attribution !== null });
    } else if (attribution.trap.kind === "none") {
      stops.linkedToNoTrap.push({ ...item, trap: attribution.trap });
    } else if (ids.has(attribution.trap.id as `TR-${number}`)) {
      stops.linkedToTrap.push({ ...item, trap: attribution.trap });
    } else {
      stops.missingTrap.push({ ...item, trap: attribution.trap });
    }
  }
  const next = Math.max(0, ...TRAPS.map(trap => Number(trap.id.slice(3)))) + 1;
  const model: TrapsReadout = {
    schema: TRAPS_READOUT_SCHEMA_ID, cut: TRAP_CUT,
    catalogue: { traps: TRAPS.length, byTrap: TRAPS.map(trap => ({ id: trap.id, seeds: trap.seeds.length })),
      noTraps: NO_TRAPS.length,
      byNoTrapKind: Object.fromEntries(NO_TRAP_KINDS.map(kind => [kind, NO_TRAPS.filter(entry => entry.kind === kind).length])) as TrapsReadout["catalogue"]["byNoTrapKind"] },
    stops, nextFreeTrapId: `TR-${String(next).padStart(2, "0")}`,
    projects: [...projects].sort().map(project => {
      const landed = ordered.filter(facts => facts.status.project === project
        && (facts.status.lifecycleState === "LANDED" || facts.status.lifecycleState === "PUBLISHED")
        && facts.landedAt !== null)
        .sort((a, b) => Date.parse(b.landedAt!) - Date.parse(a.landedAt!))[0];
      return { project, newestLanded: landed === undefined ? null : {
        taskId: landed.status.taskId, attempt: landed.status.attempt, landedAt: landed.landedAt!,
        baseSha: landed.status.baseSha, candidateSha: landed.status.candidateSha, traps: landed.traps,
      } };
    }),
  };
  assertTrapsReadout(model);
  return model;
}

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Reduce within this call so no journal records survive into the next scan. */
async function readAttemptFacts(path: string): Promise<Omit<AttemptFacts, "attribution">> {
  const scan = await scanJournal<AttemptEvent>(path);
  if (!scan.ok) throw new Error(`attempt journal corrupt at ${scan.badKey}`);
  if (scan.tornTail !== null) throw new Error(`interrupted attempt append at ${path}; reports and never repairs`);
  const status = scan.records.at(-1)?.event.next;
  if (status === undefined) throw new Error(`no attempt journal records at ${path}`);
  const at = (state: string) => {
    const record = scan.records.findLast(({ event }) => event.kind === "attempt.transitioned" && event.next.lifecycleState === state);
    return transitionTime(record?.event, state, record?.recorded_at);
  };
  return { status, terminalAt: status.lifecycleState === "BLOCKED" || status.lifecycleState === "CANCELLED"
    ? at(status.lifecycleState) : null, landedAt: at("LANDED"), traps: trapsGate(status, scan.records) };
}

/** Journals and placement only: no lock, SQLite, clock, repair, subprocess or provider. */
export async function readTrapsReadout(stateRoot: string, build: typeof buildTrapsReadout = buildTrapsReadout): Promise<TrapsReadout> {
  const projects: string[] = [];
  const attempts: AttemptFacts[] = [];
  for (const project of await directories(join(stateRoot, "projects"))) {
    try {
      const placement = await readPlacement(stateRoot, project);
      if (placement.project !== project) throw new Error(`placement project disagrees with directory ${project}`);
    } catch (error) {
      // A directory alone is not registration. Invalid existing placement is an error, not empty coverage.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    projects.push(project);
    for (const taskId of await directories(join(stateRoot, "projects", project, "tasks"))) {
      const taskRoot = join(stateRoot, "projects", project, "tasks", taskId);
      const attributions = await readTaskAttributions(taskRoot);
      for (const attempt of await directories(taskRoot)) {
        if (!/^[1-9][0-9]*$/.test(attempt)) continue;
        const path = journalFilePath(join(taskRoot, attempt));
        const facts = await readAttemptFacts(path);
        const { status } = facts;
        if (status.project !== project || status.taskId !== taskId || status.attempt !== Number(attempt)) {
          throw new Error(`attempt identity disagrees with directory at ${path}`);
        }
        attempts.push({ ...facts, attribution: attributions.findLast(record => record.attempt === status.attempt
          && record.project === project && record.taskId === taskId) ?? null });
      }
    }
  }
  return build(projects, attempts);
}

export function trapsExitCode(model: TrapsReadout): 0 | 1 {
  return model.stops.unlinked.length > 0 || model.stops.missingTrap.length > 0 ? 1 : 0;
}
