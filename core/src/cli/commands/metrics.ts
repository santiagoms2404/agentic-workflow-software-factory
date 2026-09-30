// `awsf metrics` — the route-metrics readout, and the second reader of the
// payload `GET /api/v1/metrics` serves (W18 task 6).
//
// It spends nothing and writes nothing: it opens the projection read-only,
// builds the payload through `core/src/metrics/payload.ts`, and prints. Shift
// classes read sealed ticket blobs with Git; no agent starts, no phase runs
// and no provider call is reserved.
//
// It computes no statistic of its own. Grouping, counts, intervals, depth and
// verdicts come from `dashboard/shared/route-metrics.ts`, and every price from
// `dashboard/shared/rate-card.ts` through `formatListEquivalent`, so the CLI,
// the API and the tab cannot disagree about a number. The flags narrow the
// rows the table reads; `--json` prints the unfiltered API payload through the
// route's own serializer, so it is byte for byte what the route sends for the
// same `extractedAt`.
//
// `--source proving-ground` adds the route-arm scores (W18 task 13): the
// replays in scope, scored by `route-arm-score.ts` against the frozen corpus.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicApiValue } from "../../api/responses.ts";
import { TICKET_TASK_CLASSES } from "../../contracts/ticket.ts";
import type { ProvingGroundItem } from "../../contracts/proving-ground.ts";
import { buildMetricsPayload } from "../../metrics/payload.ts";
import { readReplayOutcomes, routeArmProtocol, routeArmReplays, type ReplayOutcome } from "../../metrics/route-arm-replays.ts";
import { LINE_WINDOW, scoreRouteArms, type RouteArmScore } from "../../metrics/route-arm-score.ts";
import { openDatabase, type DatabaseSync } from "../../observability/sqlite.ts";
import { readProvingGroundCorpus } from "../../workflow/prove/corpus.ts";
import type { MetricsResponse, MetricsRoleRow, MetricsRun } from "../../../../dashboard/shared/types.ts";
import { formatListEquivalent, listPrice } from "../../../../dashboard/shared/rate-card.ts";
import {
  EVIDENCE_SOURCES,
  coverage,
  depth,
  evidenceSource,
  frontier,
  heuristicSplit,
  routeCells,
  stats,
  taskClassOf,
  verdicts,
  type EvidenceSource,
  type Interval,
  type UnplacedReason,
} from "../../../../dashboard/shared/route-metrics.ts";

export interface MetricsFilter {
  readonly role: string | null;
  readonly taskClass?: string | null;
  readonly source: EvidenceSource;
  /** Keeps runs that started strictly before this instant. */
  readonly startedBefore: string | null;
}

export interface MetricsCommandOptions {
  readonly dbPath: string;
  /** When the payload was read; the caller owns the clock. */
  readonly extractedAt: string;
  readonly json?: boolean;
  readonly role?: string;
  readonly taskClass?: string;
  readonly source?: string;
  readonly startedBefore?: string;
  /** The checkout whose corpus scores the replays. Defaults to the checkout this CLI belongs to, which holds the corpus. */
  readonly repository?: string;
}

/** What the proving-ground readout scores the rows with: each replay session's outcome, and the corpus. */
export interface ProvingGroundEvidence {
  readonly outcomes: ReadonlyMap<string, ReplayOutcome>;
  readonly corpus: readonly ProvingGroundItem[];
}

const CHECKOUT = fileURLToPath(new URL("../../../../", import.meta.url));

export const METRICS_USAGE =
  "usage: awsf metrics [--role R] [--task-class CLASS] [--source production|proving-ground] [--started-before ISO] [--json] [--state-root PATH]";

/** The filter the flags spell. Statistics compare within one evidence source, so `production` is the default. */
export function metricsFilter(options: Pick<MetricsCommandOptions, "role" | "taskClass" | "source" | "startedBefore">): MetricsFilter {
  const source = options.source ?? "production";
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`--source must be one of ${EVIDENCE_SOURCES.join(", ")}; got ${JSON.stringify(source)}`);
  }
  if (options.startedBefore !== undefined && Number.isNaN(Date.parse(options.startedBefore))) {
    throw new Error(`--started-before must be an ISO 8601 instant; got ${JSON.stringify(options.startedBefore)}`);
  }
  if (options.role !== undefined && options.role.length === 0) throw new Error("--role must name a role");
  if (options.taskClass !== undefined && ![...TICKET_TASK_CLASSES, "unclassified"].includes(options.taskClass)) {
    throw new Error(`--task-class must be one of ${[...TICKET_TASK_CLASSES, "unclassified"].join(", ")}`);
  }
  return { role: options.role ?? null, taskClass: options.taskClass ?? null, source: source as EvidenceSource, startedBefore: options.startedBefore ?? null };
}

function readProjection<T>(dbPath: string, read: (db: DatabaseSync) => T): T {
  if (!existsSync(dbPath)) throw new Error(`no projection at ${dbPath}; awsf db rebuild creates it from the journals`);
  const db = openDatabase(dbPath, { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** The payload exactly as the route serves it: built from a read-only connection, then through `publicApiValue`. */
export function readMetricsPayload(dbPath: string, extractedAt: string): MetricsResponse {
  return readProjection(dbPath, (db) => publicApiValue(buildMetricsPayload(db, { extractedAt })));
}

export function metricsCommand(options: MetricsCommandOptions): readonly string[] {
  const filtered = options.role !== undefined || options.taskClass !== undefined || options.source !== undefined || options.startedBefore !== undefined;
  if (options.json === true && filtered) {
    throw new Error("--json prints the unfiltered API payload; --role, --task-class, --source and --started-before narrow the table only");
  }
  const filter = metricsFilter(options);
  if (filter.source !== "proving-ground") {
    const payload = readMetricsPayload(options.dbPath, options.extractedAt);
    return options.json === true ? [JSON.stringify(payload)] : metricsReadout(payload, filter);
  }
  // One read of the projection, so the rows and the outcomes they are scored with agree.
  const { payload, outcomes } = readProjection(options.dbPath, (db) => ({
    payload: publicApiValue(buildMetricsPayload(db, { extractedAt: options.extractedAt })),
    outcomes: readReplayOutcomes(db),
  }));
  return metricsReadout(payload, filter, { outcomes, corpus: readProvingGroundCorpus(options.repository ?? CHECKOUT) });
}

function inScope(item: Pick<MetricsRun, "workflow" | "startedAt">, filter: MetricsFilter): boolean {
  return evidenceSource(item) === filter.source &&
    (filter.startedBefore === null || Date.parse(item.startedAt) < Date.parse(filter.startedBefore));
}

/** The runs in scope. `--role` narrows rows only: a run blocked before any agent phase ran has no role. */
export function filterRuns(runs: readonly MetricsRun[], filter: MetricsFilter): MetricsRun[] {
  return runs.filter((run) => inScope(run, filter));
}

/** The rows the table reads. A filter narrows rows and never alters one. */
export function filterRows(rows: readonly MetricsRoleRow[], filter: MetricsFilter): MetricsRoleRow[] {
  return rows.filter((row) => (filter.role === null || row.role === filter.role) &&
    (filter.taskClass == null || taskClassOf(row) === filter.taskClass) && inScope(row, filter));
}

function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

function firstPassCell(interval: Interval): string {
  return interval.p === null ? "–" : `${percent(interval.p)} [${percent(interval.lo)}–${percent(interval.hi)}]`;
}

function tallyText(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return entries.length === 0 ? "none" : entries.map(([key, count]) => `${key} ${count}`).join(" · ");
}

const UNPLACED_TEXT: Readonly<Record<UnplacedReason, string>> = {
  unpriced: "No verdict: no row on this route has a list-price equivalent.",
  "no-minutes": "No verdict: no row on this route has minutes.",
  "no-observation": "No verdict: no settled rankable row.",
};

function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => `  ${row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column]!)).join("  ")}`.trimEnd());
}

/**
 * The role × route table over the filtered rows, headed by the counts the
 * owner reconciles against. Over proving-ground rows, given the evidence, the
 * route-arm scores follow it.
 */
export function metricsReadout(payload: MetricsResponse, filter: MetricsFilter, provingGround?: ProvingGroundEvidence): string[] {
  const runs = filterRuns(payload.runs, filter);
  const rows = filterRows(payload.roleRows, filter);
  const all = stats(rows, listPrice);
  const cover = coverage(rows);
  const lines: string[] = [];
  lines.push(`Route metrics · ${payload.schema} · extracted ${payload.extractedAt} · rate card ${payload.rateCard.checkedAt}`);
  lines.push(`Scope: ${filter.role === null ? "every role" : `role ${filter.role}`} · ${filter.source} evidence · ` +
    `${filter.startedBefore === null ? "every run" : `runs started before ${filter.startedBefore}`}`);
  if (filter.taskClass != null) lines.push(`Task class: ${filter.taskClass}`);
  lines.push(`${runs.length} runs (${all.runs} with role-rows) · ${all.n} role-rows · ${cover.routes} routes · ` +
    `${cover.cells} cells · ${all.refuted} refuted of ${all.claims} claims`);
  lines.push(`Blocked runs by heuristic attribution: ${tallyText(heuristicSplit(runs))}`);
  if (cover.unkeyed > 0) lines.push(`${cover.unkeyed} role-row(s) have no route key (route-mixed or unknown) and enter no cell.`);
  if (all.n === 0) {
    lines.push("No role-rows in this scope.");
    return lines;
  }

  const classes = [...new Set(rows.map(taskClassOf))].sort();
  for (const taskClass of classes) {
    const classRows = rows.filter((row) => taskClassOf(row) === taskClass);
    const cells = routeCells(classRows);
    for (const role of new Set(cells.map((cell) => cell.role))) {
      const front = frontier(classRows, role, "first-pass", "list-per-row", listPrice);
      const said = new Map(verdicts(front).map((verdict) => [verdict.key, verdict.text]));
      const unplaced = new Map(front.unplaced.map((item) => [item.key, UNPLACED_TEXT[item.reason]]));
      lines.push("");
      lines.push(taskClass === "unclassified" && classes.length === 1 ? role : `${role} · ${taskClass}`);
      const body = cells.filter((cell) => cell.role === role).map((cell) => {
        const s = stats(cell.rows, listPrice);
        return [
          cell.key,
          String(s.n),
          String(s.settled),
          firstPassCell(s.firstPass),
          depth(s.firstPass, s.settled),
          formatListEquivalent(s.listPerRow),
          said.get(cell.key) ?? unplaced.get(cell.key) ?? "No verdict: every row is kept out of ranking.",
        ];
      });
      lines.push(...table([["route", "n", "settled", "first pass [95% CI]", "depth", "per row", "verdict"], ...body]));
      const kept = stats(cells.filter((cell) => cell.role === role).flatMap((cell) => cell.rows), listPrice);
      if (kept.unconfirmed > 0) {
        lines.push(`  ${kept.unconfirmed} row(s) ranked with unconfirmed identity (route-attributed): each counts as the model its route requested.`);
      }
      if (kept.unrankable > 0) {
        lines.push(`  ${kept.unrankable} row(s) counted above but kept out of the verdicts: ${tallyText(kept.unrankableReasons)}.`);
      }
    }
  }
  lines.push("");
  lines.push("Verdicts rank first-pass yield against ≈ list per row over rankable rows only, and a route needs 5 settled rows to shape them.");
  lines.push("A route key names the selector, so a cell pools every model it resolved to; each row prices on the model observed answering.");
  if (filter.source === "proving-ground" && provingGround !== undefined) lines.push(...routeArmReadout(rows, provingGround));
  return lines;
}

function armTable(kind: ProvingGroundItem["kind"], arms: readonly RouteArmScore[]): string[] {
  if (kind === "build") {
    return table([["arm", "replays", "first pass [95% CI]", "invalid pairs"],
      ...arms.map((arm) => [arm.arm, String(arm.build.replays), firstPassCell(arm.build.interval), String(arm.invalidPairs)])]);
  }
  return table([["arm", "replays", "located", "recall [95% CI]", "file-only", "false alarms", "invalid pairs"],
    ...arms.map((arm) => [arm.arm, String(arm.review.replays), String(arm.review.located), firstPassCell(arm.review.recall),
      String(arm.review.fileOnly), String(arm.review.falseAlarms), String(arm.invalidPairs)])]);
}

/** T11's route-arm scores over the replays in scope: per item and arm, then per role and task class. */
export function routeArmReadout(rows: readonly MetricsRoleRow[], evidence: ProvingGroundEvidence): string[] {
  const replays = routeArmReplays(rows, evidence.outcomes, evidence.corpus);
  const lines = ["", `Route arms · ${replays.length} replay(s) in scope`];
  const unrecorded = rows.filter((row) => row.itemId === null).length;
  if (unrecorded > 0) lines.push(`${unrecorded} proving-ground role-row(s) carry no replay record and are not scored.`);
  const protocol = routeArmProtocol(replays, evidence.corpus);
  if (protocol === null) {
    lines.push("No comparison: the replays in scope name fewer than two arms.");
    return lines;
  }
  const suite = scoreRouteArms(protocol, replays);
  const kinds = new Map(protocol.items.map((item) => [item.id, item.kind]));
  lines.push(`${suite.arms.length} arms · ${protocol.repetitions} repetition(s) · ${protocol.items.length} item(s) · ` +
    `${suite.pairs.filter((pair) => pair.valid).length} of ${suite.pairs.length} pairs valid${suite.complete ? " · complete" : ""}`);
  for (const item of suite.byItem) {
    lines.push("", `${item.itemId} · ${item.kind} · ${item.role} · ${item.taskClass}`, ...armTable(item.kind, item.arms));
  }
  for (const scope of suite.byScope) {
    lines.push("", `${scope.role} · ${scope.taskClass} · ${scope.items.length} item(s) · ${scope.invalidPairs} invalid pair(s)`,
      ...armTable(kinds.get(scope.items[0]!) ?? "review", scope.arms));
  }
  const invalid = suite.pairs.filter((pair) => !pair.valid);
  if (invalid.length > 0) {
    lines.push("", "Invalid pairs score no arm:");
    for (const pair of invalid) {
      lines.push(`  ${pair.itemId} repetition ${pair.repetition}: ` +
        pair.reasons.map((reason) => `${reason.reason}${reason.arm === null ? "" : ` on ${reason.arm}`} (${reason.detail})`).join("; "));
    }
  }
  if (suite.stray.length > 0) {
    lines.push("", "Replays outside the corpus or the arms, never scored:");
    for (const stray of suite.stray) lines.push(`  ${stray.itemId} on ${stray.arm}, repetition ${stray.repetition}`);
  }
  lines.push("", `A finding locates the planted defect on its file within ${LINE_WINDOW} lines of the expected range. A whole-file finding on that file is file-only, apart from recall.`);
  return lines;
}
