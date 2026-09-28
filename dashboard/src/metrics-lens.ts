import type { MetricsResponse, MetricsRoleRow, MetricsRun, RateCardRow } from "../shared/types.ts";
import {
  EVIDENCE_SOURCES,
  LENS_FACETS,
  STATE_GROUPS,
  applyLens,
  canonicalModel,
  evidenceSource,
  routeKey,
  stats,
  type FacetValue,
  type Lens,
  type LensFacet,
  type MetricsRow,
  type RowPrice,
  type StateGroup,
} from "../shared/route-metrics.ts";
import { formatListEquivalent } from "../shared/rate-card.ts";
import type { SessionFilterEntry } from "./session-filters.ts";

/**
 * The metrics tab's lens and view, all of it in the URL so Back restores them.
 *
 * `#/metrics?view=frontier&route=claude/opus@high&x.role=planner,designer`
 * `#/metrics/run/<sessionId>?x.effort=low`
 *
 * A facet's parameter lists the values switched OFF, not the ones on. The
 * facets draw on open vocabularies (models, workflows, projects), and a value
 * that first appears while the tab is open has to be in the lens without the
 * reader admitting it: the same argument as `admitNewFilterValues` on the
 * sessions board. Only what differs from the default is written, as the canvas
 * route does, so an untouched lens has a clean URL.
 *
 * The statistics are the shared module's. Nothing here computes one: the
 * summary is `stats` over the rows `applyLens` keeps.
 */

export const METRICS_PATH = "#/metrics";
export const METRICS_VIEWS = ["matrix", "frontier", "ledger", "run"] as const;
export type MetricsView = (typeof METRICS_VIEWS)[number];

export const VIEW_LABEL: Readonly<Record<MetricsView, string>> = {
  matrix: "Matrix",
  frontier: "Frontier",
  ledger: "Ledger",
  run: "Run",
};

/** The rail's order, top to bottom. Evidence source is drawn apart: one live value until M4. */
export const RAIL_FACETS = ["role", "model", "effort", "state", "workflow", "project"] as const;
export type RailFacet = (typeof RAIL_FACETS)[number];
export type FacetId = RailFacet | "source";

/** The design's role order; roles never observed are left out, unknown ones follow in code-point order. */
export const ROLE_ORDER = ["intake", "scout", "planner", "designer", "architecture-reviewer", "builder", "reviewer", "documenter"] as const;
export const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const STATE_LABEL: Readonly<Record<StateGroup, string>> = {
  LANDED: "landed",
  AWAITING_OWNER: "awaiting owner",
  OPEN: "in flight",
  CANCELLED: "cancelled",
  BLOCKED: "blocked",
};

/** State dots: the dashboard's tokens, never a literal colour. */
export const STATE_TONE: Readonly<Record<StateGroup, string>> = {
  LANDED: "var(--green)",
  AWAITING_OWNER: "var(--amber)",
  OPEN: "var(--blue)",
  CANCELLED: "var(--faint)",
  BLOCKED: "var(--red)",
};

/** `null` facet values (an effort or a model nobody recorded) travel in the URL as this token. */
export const NULL_TOKEN = "~";

/**
 * The lens's facets: the module's, with Model keyed on the model observed
 * answering. The module keys it on the route's selector, which is right for
 * route comparisons (INV-4) and wrong for a menu called Model: `claude:opus`
 * answered as two models on the owner's database, and the frames list Opus 5
 * and Opus 5.5 apart. A row that observed none falls back to its selector.
 */
export const METRICS_FACETS: readonly LensFacet[] = Object.freeze(LENS_FACETS.map((facet) =>
  facet.id === "model" ? { ...facet, value: observedModel } : facet));

export function observedModel(row: MetricsRow): FacetValue {
  return row.resolvedModel ?? canonicalModel(row.route);
}

export interface MetricsRouteState {
  readonly view: MetricsView;
  /** The run the Run view shows, from `#/metrics/run/<sessionId>`. */
  readonly run: string | null;
  /** A focused route key; only that route's rows are in the lens. */
  readonly route: string | null;
  /** Values switched off, per facet, as URL tokens (`NULL_TOKEN` for `null`). */
  readonly off: Readonly<Partial<Record<FacetId, readonly string[]>>>;
}

/** Production only: the proving ground is a separate evidence source (DD8), and M4 adds it. */
export const DEFAULT_OFF: Readonly<Partial<Record<FacetId, readonly string[]>>> = Object.freeze({ source: ["proving-ground"] });

export const DEFAULT_METRICS_ROUTE: MetricsRouteState = Object.freeze({ view: "matrix", run: null, route: null, off: DEFAULT_OFF });

const FACET_IDS: readonly FacetId[] = [...RAIL_FACETS, "source"];

export function isMetricsRoute(hash: string): boolean {
  return hash === METRICS_PATH || hash.startsWith(`${METRICS_PATH}?`) || hash.startsWith(`${METRICS_PATH}/`);
}

export function toToken(value: FacetValue): string {
  return value === null ? NULL_TOKEN : value;
}

export function fromToken(token: string): FacetValue {
  return token === NULL_TOKEN ? null : token;
}

/** The query's raw values: a list is split on its literal commas before any value is decoded. */
function rawParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    const key = safeDecode(eq < 0 ? part : part.slice(0, eq));
    if (!params.has(key)) params.set(key, eq < 0 ? "" : part.slice(eq + 1));
  }
  return params;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function readList(value: string): string[] {
  return [...new Set(value.split(",").map(safeDecode).filter((part) => part.length > 0))];
}

function readView(value: string | null): MetricsView {
  return (METRICS_VIEWS as readonly string[]).includes(value ?? "") ? value as MetricsView : "matrix";
}

export function parseMetricsRoute(hash: string): MetricsRouteState {
  const split = hash.includes("?") ? hash.indexOf("?") : hash.length;
  const path = hash.slice(0, split);
  const params = rawParams(hash.slice(split + 1));
  const runMatch = /^#\/metrics\/run\/([^/?]+)$/.exec(path);
  const run = runMatch?.[1] ? safeDecode(runMatch[1]) : null;
  const off: Partial<Record<FacetId, readonly string[]>> = { ...DEFAULT_OFF };
  for (const id of FACET_IDS) {
    const value = params.get(`x.${id}`);
    if (value !== undefined) off[id] = readList(value);
  }
  const route = params.has("route") ? safeDecode(params.get("route")!) : null;
  return {
    view: run !== null ? "run" : readView(params.has("view") ? safeDecode(params.get("view")!) : null),
    run,
    route: route !== null && route.length > 0 ? route : null,
    off,
  };
}

function sameList(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Commas separate values, so each value is percent-encoded and the separators
 * are not. A route key's `/` and `@` are legal in a query and stay readable.
 */
export function metricsRouteHash(state: MetricsRouteState): string {
  const path = state.run === null ? METRICS_PATH : `${METRICS_PATH}/run/${encodeURIComponent(state.run)}`;
  const parts: string[] = [];
  if (state.run === null && state.view !== "matrix") parts.push(`view=${state.view}`);
  if (state.route !== null) parts.push(`route=${encodeURIComponent(state.route).replace(/%2F/g, "/").replace(/%40/g, "@")}`);
  for (const id of FACET_IDS) {
    const off = state.off[id] ?? [];
    if (!sameList(off, DEFAULT_OFF[id])) parts.push(`x.${id}=${off.map(encodeURIComponent).join(",")}`);
  }
  return parts.length === 0 ? path : `${path}?${parts.join("&")}`;
}

/** Switching view keeps the lens; leaving the Run view leaves its run behind. */
export function withView(state: MetricsRouteState, view: MetricsView): MetricsRouteState {
  return { ...state, view, run: view === "run" ? state.run : null };
}

export function withRun(state: MetricsRouteState, run: string | null): MetricsRouteState {
  return { ...state, view: "run", run };
}

/** Reset lens: every facet back to its default and no route focus. The view and its run stay. */
export function resetLens(state: MetricsRouteState): MetricsRouteState {
  return { ...state, route: null, off: DEFAULT_OFF };
}

/**
 * The selection a filter-ladder control works on, for the values the menu
 * shows. `toggleFilterValue` and `toggleAllFilterValues` from
 * `session-filters.ts` act on it; `withSelection` turns the result back into
 * the switched-off list the URL carries.
 */
export function selectedValues(state: MetricsRouteState, facet: FacetId, entryValues: readonly string[]): string[] {
  const off = new Set(state.off[facet] ?? []);
  return entryValues.filter((value) => !off.has(value));
}

/**
 * Off is every shown value the selection left out, plus any value already off
 * that the menu no longer shows. A menu that loses a value while it is off
 * keeps it off, so it does not come back on when a later poll returns it.
 */
export function withSelection(
  state: MetricsRouteState,
  facet: FacetId,
  entryValues: readonly string[],
  selected: readonly string[],
): MetricsRouteState {
  const shown = new Set(entryValues);
  const on = new Set(selected);
  const kept = (state.off[facet] ?? []).filter((value) => !shown.has(value));
  const off = [...kept, ...entryValues.filter((value) => !on.has(value))];
  // A facet choice changes which routes are in view, so a route focus from an
  // earlier tile click no longer describes the lens and is dropped with it.
  return { ...state, route: null, off: { ...state.off, [facet]: off } };
}

/** The module's `Lens` for the rows: every value they carry, minus the ones switched off. */
export function lensOf(rows: readonly MetricsRow[], state: MetricsRouteState, facets: readonly LensFacet[] = METRICS_FACETS): Lens {
  return {
    facets: Object.fromEntries(facets.map((facet) => {
      const off = new Set((state.off[facet.id as FacetId] ?? []).map(fromToken));
      return [facet.id, new Set(rows.map(facet.value).filter((value) => !off.has(value)))];
    })),
    route: state.route,
  };
}

export function rowsInLens<Row extends MetricsRow>(rows: readonly Row[], state: MetricsRouteState): Row[] {
  return applyLens(rows, lensOf(rows, state), METRICS_FACETS) as Row[];
}

function facetById(id: FacetId): LensFacet {
  return METRICS_FACETS.find((facet) => facet.id === id)!;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderIn(order: readonly string[]): (a: string, b: string) => number {
  const rank = (value: string) => (order.includes(value) ? order.indexOf(value) : order.length);
  return (a, b) => rank(a) - rank(b) || compareText(a, b);
}

/** Anthropic before OpenAI, then by label. */
function modelOrder(rateCard: readonly RateCardRow[], rows: readonly MetricsRow[]): (a: string, b: string) => number {
  return (a, b) => {
    const pa = modelProvider(fromToken(a), rateCard, rows), pb = modelProvider(fromToken(b), rateCard, rows);
    return compareText(pa ?? "~", pb ?? "~") || compareText(modelLabel(fromToken(a), rateCard), modelLabel(fromToken(b), rateCard));
  };
}

export type Provider = "anthropic" | "openai";

function providerOf(stated: string | null): Provider | null {
  if (stated === null) return null;
  return stated.startsWith("openai") ? "openai" : stated.startsWith("anthropic") ? "anthropic" : null;
}

/**
 * The rate card names the provider of a card id. Otherwise a row that ran the
 * model states it, or failing that another row on the same adapter does:
 * config-derived rows carry no provider, and a selector nobody saw answer is
 * still run by an adapter whose provider other rows recorded.
 */
export function modelProvider(model: FacetValue, rateCard: readonly RateCardRow[], rows: readonly MetricsRow[]): Provider | null {
  if (model === null) return null;
  const card = rateCard.find((row) => row.model === model);
  if (card !== undefined) return card.provider;
  const ran = rows.filter((row) => observedModel(row) === model);
  const stated = ran.find((row) => row.route.provider !== null)?.route.provider ?? null;
  if (stated !== null) return providerOf(stated);
  const adapters = new Set(ran.map((row) => row.route.adapter).filter((adapter): adapter is string => adapter !== null));
  return providerOf(rows.find((row) => row.route.adapter !== null && adapters.has(row.route.adapter) && row.route.provider !== null)?.route.provider ?? null);
}

/** A card id reads as its card label; a selector no model was observed answering says so. */
export function modelLabel(model: FacetValue, rateCard: readonly RateCardRow[]): string {
  if (model === null) return "unknown";
  return rateCard.find((row) => row.model === model)?.label ?? `${model} (selector)`;
}

/**
 * Role dots use the colours the config already gives each agent
 * (`agents[].color`, served by `/api/v1/settings`), so a role reads the same
 * here as on its lane. An agent with no readable colour gets none.
 */
export function readRoleColors(settings: unknown): Record<string, string> {
  if (typeof settings !== "object" || settings === null || !("agents" in settings) || !Array.isArray(settings.agents)) return {};
  const colors: Record<string, string> = {};
  for (const agent of settings.agents as unknown[]) {
    if (typeof agent !== "object" || agent === null) continue;
    const { name, color } = agent as { name?: unknown; color?: unknown };
    if (typeof name === "string" && typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color)) colors[name] = color;
  }
  return colors;
}

export interface RailOption extends SessionFilterEntry {
  /** A role or state dot, as a token or the role's configured colour. */
  readonly dot?: string;
  readonly provider?: Provider | null;
}

export interface RailContext {
  readonly rateCard: readonly RateCardRow[];
  /** Role name to its configured colour (`agents[].color`). */
  readonly roleColors: Readonly<Record<string, string>>;
}

/**
 * One ladder's options. Counts are role-rows, constrained by every OTHER facet
 * and the route focus, never by the facet's own selection: the sessions
 * board's grammar, so a switched-off value still says what turning it on adds.
 */
export function facetOptions(
  rows: readonly MetricsRow[],
  state: MetricsRouteState,
  id: FacetId,
  context: RailContext,
): RailOption[] {
  const facet = facetById(id);
  const others = rowsInLens(rows, { ...state, off: { ...state.off, [id]: [] } });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(toToken(facet.value(row)), 0);
  for (const row of others) {
    const token = toToken(facet.value(row));
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const order = id === "role" ? orderIn(ROLE_ORDER)
    : id === "effort" ? orderIn(EFFORT_ORDER)
    : id === "state" ? orderIn(STATE_GROUPS)
    : id === "source" ? orderIn(EVIDENCE_SOURCES)
    : id === "model" ? modelOrder(context.rateCard, rows)
    : compareText;
  const tokens = [...counts.keys()].sort((a, b) => (a === NULL_TOKEN ? 1 : b === NULL_TOKEN ? -1 : order(a, b)));
  return tokens.map((token): RailOption => {
    const value = fromToken(token);
    const count = counts.get(token) ?? 0;
    if (id === "role") return { value: token, count, dot: (value !== null ? context.roleColors[value] : undefined) ?? "var(--faint)" };
    if (id === "model") return { value: token, count, label: modelLabel(value, context.rateCard), provider: modelProvider(value, context.rateCard, rows) };
    if (id === "state") return { value: token, count, label: value === null ? "unknown" : STATE_LABEL[value as StateGroup] ?? value, dot: STATE_TONE[value as StateGroup] ?? "var(--faint)" };
    return { value: token, count, ...(value === null ? { label: "unknown" } : {}) };
  });
}

// ---------------------------------------------------------------------------
// The count tile and the summary row.
// ---------------------------------------------------------------------------

export interface CountTile {
  /** Distinct runs among the role-rows in the lens. */
  readonly inLens: number;
  /** Runs recorded in the selected evidence sources. */
  readonly recorded: number;
  /** Of those, runs with no role-row at all: blocked in a host phase, or never started. */
  readonly neverReachedAgent: number;
}

/**
 * Runs, not rows, and read off `payload.runs`: a run blocked before any agent
 * phase has no role-row, so the rows alone cannot count it. Only the evidence
 * source scopes the recorded count; the role facet narrows rows, not runs.
 */
export function countTile(runs: readonly MetricsRun[], rows: readonly MetricsRow[], state: MetricsRouteState): CountTile {
  const offSources = new Set(state.off.source ?? []);
  const recorded = runs.filter((run) => !offSources.has(evidenceSource({ workflow: run.workflow })));
  const withRows = new Set(rows.map((row) => row.sessionId));
  return {
    inLens: new Set(rowsInLens(rows, state).map((row) => row.sessionId)).size,
    recorded: recorded.length,
    neverReachedAgent: recorded.filter((run) => !withRows.has(run.sessionId)).length,
  };
}

export interface SummaryStat {
  readonly id: "rows" | "first-pass" | "landed" | "list-per-landed";
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

function pct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

/** The four figures over the rows in the lens, every one the module's. */
export function summaryStats(rows: readonly MetricsRow[], price: RowPrice): SummaryStat[] {
  const s = stats(rows, price);
  return [
    { id: "rows", label: "Role-rows in lens", value: String(s.n), caption: `${s.runs} runs · ${s.settled} settled` },
    {
      id: "first-pass",
      label: "First-pass yield",
      value: pct(s.firstPass.p),
      caption: s.firstPass.p === null ? "no settled rows" : `95% CI ${pct(s.firstPass.lo)} to ${pct(s.firstPass.hi)}`,
    },
    { id: "landed", label: "Runs landed", value: `${s.landed}/${s.runs}`, caption: `${s.blockedHere} role-rows blocked here, model-attributed` },
    // The label carries no "$": every dollar sign on the tab comes through
    // `formatListEquivalent`, and the value already reads "≈ list $x.xx".
    { id: "list-per-landed", label: "List equivalent per landed run", value: formatListEquivalent(s.listPerLanded), caption: "list-price equivalent, not spend" },
  ];
}

/** The runs the Run view's picker offers: those with a role-row in the lens, newest first. */
export function runsInLens(payload: Pick<MetricsResponse, "runs" | "roleRows">, state: MetricsRouteState): MetricsRun[] {
  const ids = new Set(rowsInLens(payload.roleRows, state).map((row) => row.sessionId));
  return payload.runs.filter((run) => ids.has(run.sessionId))
    .sort((a, b) => compareText(b.startedAt, a.startedAt) || compareText(a.sessionId, b.sessionId));
}

/** The route-focus note's text, or `null` with no focus. */
export function routeFocusNote(state: MetricsRouteState, rows: readonly MetricsRoleRow[], rateCard: readonly RateCardRow[]): string | null {
  if (state.route === null) return null;
  const row = rows.find((candidate) => routeKey(candidate.route) === state.route);
  if (row === undefined) return `route ${state.route}`;
  const model = canonicalModel(row.route);
  return `route ${rateCard.find((card) => card.model === model)?.label ?? model ?? "unknown model"} · ${row.route.effort ?? "unknown effort"}`;
}
