// `awsf metrics` — the route-metrics readout, and the second reader of the
// payload `GET /api/v1/metrics` serves (W18 task 6).
//
// It spends nothing and writes nothing: it opens the projection read-only,
// builds the payload through `core/src/metrics/payload.ts`, and prints. No
// process is started, no phase runs and no call is reserved.
//
// It computes no statistic of its own. Grouping, counts, intervals, depth and
// verdicts come from `dashboard/shared/route-metrics.ts`, and every price from
// `dashboard/shared/rate-card.ts` through `formatListEquivalent`, so the CLI,
// the API and the tab cannot disagree about a number. The flags narrow the
// rows the table reads; `--json` prints the unfiltered API payload through the
// route's own serializer, so it is byte for byte what the route sends for the
// same `extractedAt`.

import { existsSync } from "node:fs";
import { publicApiValue } from "../../api/responses.ts";
import { buildMetricsPayload } from "../../metrics/payload.ts";
import { openDatabase } from "../../observability/sqlite.ts";
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
  verdicts,
  type EvidenceSource,
  type Interval,
  type UnplacedReason,
} from "../../../../dashboard/shared/route-metrics.ts";

export interface MetricsFilter {
  readonly role: string | null;
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
  readonly source?: string;
  readonly startedBefore?: string;
}

export const METRICS_USAGE =
  "usage: awsf metrics [--role R] [--source production|proving-ground] [--started-before ISO] [--json] [--state-root PATH]";

/** The filter the flags spell. Statistics compare within one evidence source, so `production` is the default. */
export function metricsFilter(options: Pick<MetricsCommandOptions, "role" | "source" | "startedBefore">): MetricsFilter {
  const source = options.source ?? "production";
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`--source must be one of ${EVIDENCE_SOURCES.join(", ")}; got ${JSON.stringify(source)}`);
  }
  if (options.startedBefore !== undefined && Number.isNaN(Date.parse(options.startedBefore))) {
    throw new Error(`--started-before must be an ISO 8601 instant; got ${JSON.stringify(options.startedBefore)}`);
  }
  if (options.role !== undefined && options.role.length === 0) throw new Error("--role must name a role");
  return { role: options.role ?? null, source: source as EvidenceSource, startedBefore: options.startedBefore ?? null };
}

/** The payload exactly as the route serves it: built from a read-only connection, then through `publicApiValue`. */
export function readMetricsPayload(dbPath: string, extractedAt: string): MetricsResponse {
  if (!existsSync(dbPath)) throw new Error(`no projection at ${dbPath}; awsf db rebuild creates it from the journals`);
  const db = openDatabase(dbPath, { readonly: true });
  try {
    return publicApiValue(buildMetricsPayload(db, { extractedAt }));
  } finally {
    db.close();
  }
}

export function metricsCommand(options: MetricsCommandOptions): readonly string[] {
  const filtered = options.role !== undefined || options.source !== undefined || options.startedBefore !== undefined;
  if (options.json === true && filtered) {
    throw new Error("--json prints the unfiltered API payload; --role, --source and --started-before narrow the table only");
  }
  const filter = metricsFilter(options);
  const payload = readMetricsPayload(options.dbPath, options.extractedAt);
  if (options.json === true) return [JSON.stringify(payload)];
  return metricsReadout(payload, filter);
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
  return rows.filter((row) => (filter.role === null || row.role === filter.role) && inScope(row, filter));
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

/** The role × route table over the filtered rows, headed by the counts the owner reconciles against. */
export function metricsReadout(payload: MetricsResponse, filter: MetricsFilter): string[] {
  const runs = filterRuns(payload.runs, filter);
  const rows = filterRows(payload.roleRows, filter);
  const all = stats(rows, listPrice);
  const cover = coverage(rows);
  const lines: string[] = [];
  lines.push(`Route metrics · ${payload.schema} · extracted ${payload.extractedAt} · rate card ${payload.rateCard.checkedAt}`);
  lines.push(`Scope: ${filter.role === null ? "every role" : `role ${filter.role}`} · ${filter.source} evidence · ` +
    `${filter.startedBefore === null ? "every run" : `runs started before ${filter.startedBefore}`}`);
  lines.push(`${runs.length} runs (${all.runs} with role-rows) · ${all.n} role-rows · ${cover.routes} routes · ` +
    `${cover.cells} cells · ${all.refuted} refuted of ${all.claims} claims`);
  lines.push(`Blocked runs by heuristic attribution: ${tallyText(heuristicSplit(runs))}`);
  if (cover.unkeyed > 0) lines.push(`${cover.unkeyed} role-row(s) have no route key (route-mixed or unknown) and enter no cell.`);
  if (all.n === 0) {
    lines.push("No role-rows in this scope.");
    return lines;
  }

  const cells = routeCells(rows);
  for (const role of new Set(cells.map((cell) => cell.role))) {
    const front = frontier(rows, role, "first-pass", "list-per-row", listPrice);
    const said = new Map(verdicts(front).map((verdict) => [verdict.key, verdict.text]));
    const unplaced = new Map(front.unplaced.map((item) => [item.key, UNPLACED_TEXT[item.reason]]));
    lines.push("");
    lines.push(role);
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
    if (front.excluded > 0) {
      lines.push(`  ${front.excluded} row(s) counted above but kept out of the verdicts: ${tallyText(kept.unrankableReasons)}.`);
    }
  }
  lines.push("");
  lines.push("Verdicts rank first-pass yield against ≈ list per row over rankable rows only, and a route needs 5 settled rows to shape them.");
  lines.push("A route key names the selector, so a cell pools every model it resolved to; each row prices on the model observed answering.");
  return lines;
}
