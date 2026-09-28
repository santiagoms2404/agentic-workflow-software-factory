// The route-metrics statistics, in one pure module that core (the API and the
// CLI) and the metrics tab both import, so a number is computed once and
// agrees to the digit wherever it is shown (W18 DD3). No DOM, no fetch, no
// Node API, no clock, and no data: prices and benchmark priors arrive as
// function arguments, never as constants here.
//
// Scoped comparisons only (W18 INV-4). Every comparison takes one role, and
// every point it returns is keyed by one route. Nothing here takes a model and
// returns a score, and a row whose role ran on more than one route has no key,
// so it never enters a route comparison.
//
// First pass and blocked here are counted independently. A builder whose own
// phases all succeeded first time is first pass even when the host tests
// phase after it then blocked the run with a model attribution; that block is
// what `not-blocked` measures, so first-pass yield does not drop those rows.
//
// Authority travels with the value (W18 INV-3). A row with route-attributed
// identity, partial usage or degraded observability is counted and badged in
// `stats` but kept out of every ranking: the frontier, its verdicts and the
// recommendation read only rankable rows.

export const STATE_GROUPS = ["LANDED", "AWAITING_OWNER", "OPEN", "CANCELLED", "BLOCKED"] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

export const TOOL_CLASSES = ["read", "search", "edit", "exec", "other"] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

export const EVIDENCE_SOURCES = ["production", "proving-ground"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** A route needs this many settled rows (runs, for `landed`) to shape the frontier or be recommended. */
export const MIN_SETTLED = 5;
/** Evidence is `raised` when the interval's half-width is at most this. */
export const RAISED_HALF_WIDTH = 0.15;
/** An eligible route this many times cheaper, with an overlapping interval, makes the dearer one an overkill candidate. */
export const OVERKILL_RATIO = 1.5;
/** The Beta prior's strength, in pseudo-observations. */
export const PRIOR_STRENGTH = 4;

export interface MetricsRoute {
  readonly adapter: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: string | null;
}

export interface MetricsTokens {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
}

/** What this module reads of a role-row. Core's `RoleRow` satisfies it structurally. */
export interface MetricsRow {
  readonly sessionId: string;
  readonly role: string;
  readonly route: MetricsRoute;
  readonly effortSource: string | null;
  readonly identityProvenance: string | null;
  /** The model observed answering; `null` when none was observed or the phases disagree. */
  readonly resolvedModel: string | null;
  readonly calls: number;
  readonly turns: number;
  readonly minutes: number | null;
  readonly corrections: number;
  readonly settled: boolean;
  readonly firstPass: boolean;
  readonly cleanCompletion: boolean;
  readonly blockedHere: boolean;
  readonly tokens: MetricsTokens;
  readonly costAuthority: string;
  readonly tools: Readonly<Record<ToolClass, number>>;
  readonly toolErrors: number;
  readonly gates: { readonly pass: number; readonly total: number; readonly firstRoundFail: readonly string[] };
  readonly guardrailHits: number;
  readonly claims: number;
  readonly refuted: number;
  readonly honestStops: number;
  readonly recovered: number;
  readonly corrected: number;
  readonly stateGroup: StateGroup;
  readonly workflow: string;
  readonly project: string;
  readonly reworkPhases: number;
  readonly observabilityDegraded: boolean;
  /** The run's usage authority: `provider`, `partial` or `none`. */
  readonly usageAuthority: string;
  /** Declared by a ticket (W18 task 15). Absent or `null` means undeclared. */
  readonly taskClass?: string | null;
}

/** The list-price equivalent of one row, or `null` when it cannot be priced. The caller owns every price. */
export type RowPrice = (row: MetricsRow) => number | null;

/** A benchmark-derived prior mean in [0, 1] for one role on one route, or `null` when none is mapped. */
export type PriorLookup = (role: string, route: MetricsRoute) => number | null;

// ---------------------------------------------------------------------------
// Intervals and depth.
// ---------------------------------------------------------------------------

export interface Interval {
  /** `null` when there are no observations. */
  readonly p: number | null;
  readonly lo: number;
  readonly hi: number;
}

/** The Wilson score interval for k successes in n trials. With n 0 it is the whole of [0, 1]. */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { p: null, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export type Depth = "raised" | "flat" | "sunk";

// Bounds such as 0.35 and 0.65 are 0.15 apart on paper but not in binary floating point.
const HALF_WIDTH_TOLERANCE = 1e-12;

/** `raised` when the half-width is at most 0.15, `flat` when there is evidence but a wider interval, `sunk` with none. */
export function depth(interval: Interval, n: number): Depth {
  if (n === 0) return "sunk";
  return (interval.hi - interval.lo) / 2 <= RAISED_HALF_WIDTH + HALF_WIDTH_TOLERANCE ? "raised" : "flat";
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.hi >= b.lo && b.hi >= a.lo;
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

/**
 * The model without its adapter prefix. Journal-derived phases record the
 * adapter's form (`opus`) and config-derived ones the selector (`claude:opus`);
 * both name one model.
 */
export function canonicalModel(route: MetricsRoute): string | null {
  const { adapter, model } = route;
  if (model === null) return null;
  return adapter !== null && model.startsWith(`${adapter}:`) ? model.slice(adapter.length + 1) : model;
}

/**
 * One route's key: `adapter/model@effort`, the model canonical. The provider is
 * left out because the adapter determines it, and config-derived rows for an
 * adapter that declares none carry it as `null`. `null` when any part is
 * unknown, which includes every row whose role ran on more than one route.
 */
export function routeKey(route: MetricsRoute): string | null {
  const model = canonicalModel(route);
  if (route.adapter === null || model === null || route.effort === null) return null;
  return `${route.adapter}/${model}@${route.effort}`;
}

export function routeLabel(route: MetricsRoute): string {
  return `${canonicalModel(route) ?? "unknown model"} · ${route.effort ?? "unknown effort"}`;
}

/** DD8: a row is proving-ground when its session's workflow is `prove`. */
export function evidenceSource(row: Pick<MetricsRow, "workflow">): EvidenceSource {
  return row.workflow === "prove" ? "proving-ground" : "production";
}

export const UNRANKABLE_REASONS = ["route-attributed", "partial-usage", "degraded"] as const;
export type UnrankableReason = (typeof UNRANKABLE_REASONS)[number];

/** Why a row is kept out of rankings (INV-3); empty when it is rankable. */
export function unrankableReasons(
  row: Pick<MetricsRow, "identityProvenance" | "usageAuthority" | "observabilityDegraded">,
): UnrankableReason[] {
  const reasons: UnrankableReason[] = [];
  if (row.identityProvenance === "route-attributed") reasons.push("route-attributed");
  if (row.usageAuthority === "partial") reasons.push("partial-usage");
  if (row.observabilityDegraded) reasons.push("degraded");
  return reasons;
}

export function isRankable(row: Pick<MetricsRow, "identityProvenance" | "usageAuthority" | "observabilityDegraded">): boolean {
  return unrankableReasons(row).length === 0;
}

// ---------------------------------------------------------------------------
// Aggregates.
// ---------------------------------------------------------------------------

export interface TokenTotals {
  readonly input: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
  /** Input plus output; cache traffic is counted apart. `null` when neither was reported. */
  readonly total: number | null;
}

export interface Stats {
  /** Role-rows. */
  readonly n: number;
  readonly settled: number;
  /** Distinct runs the rows belong to. */
  readonly runs: number;
  readonly landed: number;
  /** Runs per state group. */
  readonly states: Readonly<Record<StateGroup, number>>;
  /** Over settled rows. */
  readonly firstPass: Interval;
  /** Over settled rows. */
  readonly clean: Interval;
  /** Rows blocked here with a model attribution. */
  readonly blockedHere: number;
  readonly correctionsPerRow: number | null;
  /** Runs with at least one owner-rework phase. */
  readonly reworkRuns: number;
  readonly gateChecks: number;
  readonly gatePasses: number;
  readonly gatePassRate: number | null;
  /** The gate that failed on round 0 in the most rows; ties go to the first id in code-point order. */
  readonly topFirstRoundFail: { readonly gate: string; readonly rows: number } | null;
  readonly medianMinutes: number | null;
  readonly turnsPerRow: number | null;
  readonly callsPerRow: number | null;
  readonly toolsPerRow: number | null;
  readonly tools: Readonly<Record<ToolClass, number>>;
  readonly toolTotal: number;
  /** Tool errors per tool call. */
  readonly toolErrorRate: number | null;
  readonly tokens: TokenTotals;
  /** Rows the price function could price. */
  readonly priced: number;
  /** A list-price equivalent, never spend. `null` when no row is priced. */
  readonly listTotal: number | null;
  readonly listPerRow: number | null;
  readonly listPerLanded: number | null;
  readonly costAuthority: Readonly<Record<string, number>>;
  /** Rows per identity provenance; `none` when a row has none. */
  readonly identity: Readonly<Record<string, number>>;
  /** Rows per effort source; `none` when a row has none. */
  readonly effortSource: Readonly<Record<string, number>>;
  /** Rows kept out of rankings, and how many carry each reason (a row may carry several). */
  readonly unrankable: number;
  readonly unrankableReasons: Readonly<Record<UnrankableReason, number>>;
  readonly guardrailHits: number;
  readonly claims: number;
  readonly refuted: number;
  readonly honestStops: number;
  readonly recovered: number;
  readonly corrected: number;
  readonly agentHours: number;
  readonly landedPerAgentHour: number | null;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function perRow(value: number, rows: number): number | null {
  return rows === 0 ? null : value / rows;
}

export function median(values: readonly (number | null)[]): number | null {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function tally(keys: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

function reported(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : total(known);
}

function tokenTotals(rows: readonly MetricsRow[]): TokenTotals {
  const input = reported(rows.map((row) => row.tokens.inputTokens));
  const output = reported(rows.map((row) => row.tokens.outputTokens));
  return {
    input,
    cacheRead: reported(rows.map((row) => row.tokens.cacheReadTokens)),
    cacheWrite: reported(rows.map((row) => row.tokens.cacheWriteTokens)),
    output,
    reasoning: reported(rows.map((row) => row.tokens.reasoningTokens)),
    total: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
  };
}

/** Distinct runs, each with the fields every one of its rows carries. */
function runsOf(rows: readonly MetricsRow[]): MetricsRow[] {
  const bySession = new Map<string, MetricsRow>();
  for (const row of rows) if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, row);
  return [...bySession.values()];
}

/** Every aggregate of a set of role-rows. `price` supplies each row's list-price equivalent. */
export function stats(rows: readonly MetricsRow[], price: RowPrice): Stats {
  const settled = rows.filter((row) => row.settled);
  const runs = runsOf(rows);
  const landed = runs.filter((run) => run.stateGroup === "LANDED").length;
  const states = Object.fromEntries(STATE_GROUPS.map((group) =>
    [group, runs.filter((run) => run.stateGroup === group).length])) as Record<StateGroup, number>;
  const gateChecks = total(rows.map((row) => row.gates.total));
  const gatePasses = total(rows.map((row) => row.gates.pass));
  const failures = tally(rows.flatMap((row) => [...new Set(row.gates.firstRoundFail)]));
  const [top] = Object.entries(failures).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const tools = Object.fromEntries(TOOL_CLASSES.map((name) => [name, total(rows.map((row) => row.tools[name]))])) as
    Record<ToolClass, number>;
  const toolTotal = total(Object.values(tools));
  const prices = rows.map(price).filter((value): value is number => value !== null);
  const listTotal = prices.length === 0 ? null : total(prices);
  const minutes = total(rows.map((row) => row.minutes ?? 0));
  return {
    n: rows.length,
    settled: settled.length,
    runs: runs.length,
    landed,
    states,
    firstPass: wilson(settled.filter((row) => row.firstPass).length, settled.length),
    clean: wilson(settled.filter((row) => row.cleanCompletion).length, settled.length),
    blockedHere: rows.filter((row) => row.blockedHere).length,
    correctionsPerRow: perRow(total(rows.map((row) => row.corrections)), rows.length),
    reworkRuns: runs.filter((run) => run.reworkPhases > 0).length,
    gateChecks,
    gatePasses,
    gatePassRate: gateChecks === 0 ? null : gatePasses / gateChecks,
    topFirstRoundFail: top === undefined ? null : { gate: top[0], rows: top[1] },
    medianMinutes: median(rows.map((row) => row.minutes)),
    turnsPerRow: perRow(total(rows.map((row) => row.turns)), rows.length),
    callsPerRow: perRow(total(rows.map((row) => row.calls)), rows.length),
    toolsPerRow: perRow(toolTotal, rows.length),
    tools,
    toolTotal,
    toolErrorRate: toolTotal === 0 ? null : total(rows.map((row) => row.toolErrors)) / toolTotal,
    tokens: tokenTotals(rows),
    priced: prices.length,
    listTotal,
    listPerRow: listTotal === null ? null : listTotal / prices.length,
    listPerLanded: listTotal === null || landed === 0 ? null : listTotal / landed,
    costAuthority: tally(rows.map((row) => row.costAuthority)),
    identity: tally(rows.map((row) => row.identityProvenance ?? "none")),
    effortSource: tally(rows.map((row) => row.effortSource ?? "none")),
    unrankable: rows.filter((row) => !isRankable(row)).length,
    unrankableReasons: Object.fromEntries(UNRANKABLE_REASONS.map((reason) =>
      [reason, rows.filter((row) => unrankableReasons(row).includes(reason)).length])) as Record<UnrankableReason, number>,
    guardrailHits: total(rows.map((row) => row.guardrailHits)),
    claims: total(rows.map((row) => row.claims)),
    refuted: total(rows.map((row) => row.refuted)),
    honestStops: total(rows.map((row) => row.honestStops)),
    recovered: total(rows.map((row) => row.recovered)),
    corrected: total(rows.map((row) => row.corrected)),
    agentHours: minutes / 60,
    landedPerAgentHour: minutes > 0 ? landed / (minutes / 60) : null,
  };
}

// ---------------------------------------------------------------------------
// The lens.
// ---------------------------------------------------------------------------

export type FacetValue = string | null;

export interface LensFacet {
  readonly id: string;
  readonly title: string;
  readonly value: (row: MetricsRow) => FacetValue;
}

/** The lens's facets, as data: a new facet is one more entry here, and `inLens` needs no change. */
export const LENS_FACETS: readonly LensFacet[] = Object.freeze([
  { id: "role", title: "Role", value: (row: MetricsRow) => row.role },
  { id: "model", title: "Model", value: (row: MetricsRow) => canonicalModel(row.route) },
  { id: "effort", title: "Effort", value: (row: MetricsRow) => row.route.effort },
  { id: "state", title: "Terminal state", value: (row: MetricsRow) => row.stateGroup },
  { id: "workflow", title: "Workflow", value: (row: MetricsRow) => row.workflow },
  { id: "project", title: "Project", value: (row: MetricsRow) => row.project },
  { id: "source", title: "Evidence source", value: (row: MetricsRow) => evidenceSource(row) },
]);

export interface Lens {
  /** The values admitted per facet id. A facet with no entry admits every value. */
  readonly facets: Readonly<Record<string, ReadonlySet<FacetValue>>>;
  /** A route key; when set, only that route's rows are in the lens. */
  readonly route: string | null;
}

/** The lens that admits every value the rows carry, with no route focus. */
export function fullLens(rows: readonly MetricsRow[], facets: readonly LensFacet[] = LENS_FACETS): Lens {
  return {
    facets: Object.fromEntries(facets.map((facet) => [facet.id, new Set(rows.map(facet.value))])),
    route: null,
  };
}

export function inLens(row: MetricsRow, lens: Lens, facets: readonly LensFacet[] = LENS_FACETS): boolean {
  return facets.every((facet) => lens.facets[facet.id]?.has(facet.value(row)) ?? true) &&
    (lens.route === null || routeKey(row.route) === lens.route);
}

export function applyLens(rows: readonly MetricsRow[], lens: Lens, facets: readonly LensFacet[] = LENS_FACETS): MetricsRow[] {
  return rows.filter((row) => inLens(row, lens, facets));
}

// ---------------------------------------------------------------------------
// The frontier and its verdicts.
// ---------------------------------------------------------------------------

export const FRONTIER_Y = ["first-pass", "clean", "not-blocked", "landed"] as const;
export type FrontierY = (typeof FRONTIER_Y)[number];
export const FRONTIER_X = ["list-per-row", "median-minutes"] as const;
export type FrontierX = (typeof FRONTIER_X)[number];

export interface RoutePoint {
  readonly role: string;
  readonly key: string;
  /** The first row's route; the provider is the first one any row states. */
  readonly route: MetricsRoute;
  readonly stats: Stats;
  /** The y metric's interval. */
  readonly interval: Interval;
  /** The interval's denominator: runs for `landed`, settled rows otherwise. */
  readonly n: number;
  readonly x: number;
  /** Fewer than 5 in `n`: drawn, but never shapes the line. */
  readonly hollow: boolean;
  readonly onFrontier: boolean;
}

/** Why a route with rankable rows is not placed: no x value on this axis, or no observation of the y metric. */
export type UnplacedReason = "unpriced" | "no-minutes" | "no-observation";

export interface UnplacedRoute {
  readonly key: string;
  readonly route: MetricsRoute;
  readonly reason: UnplacedReason;
}

export interface Frontier {
  readonly role: string;
  readonly y: FrontierY;
  readonly x: FrontierX;
  readonly points: readonly RoutePoint[];
  /** The Pareto line, cheapest first. */
  readonly line: readonly RoutePoint[];
  /** Routes of the role with rankable rows that could not be placed, in key order. */
  readonly unplaced: readonly UnplacedRoute[];
  /** The role's keyed rows kept out because they are not rankable (INV-3). */
  readonly excluded: number;
}

/** The role's rankable rows grouped by route key. Rows with no key are left out. */
function byRoute(rows: readonly MetricsRow[], role: string): Map<string, MetricsRow[]> {
  const groups = new Map<string, MetricsRow[]>();
  for (const row of rows) {
    const key = row.role === role && isRankable(row) ? routeKey(row.route) : null;
    if (key === null) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

function routeOfGroup(rows: readonly MetricsRow[]): MetricsRoute {
  const first = rows[0]!.route;
  return { ...first, provider: rows.find((row) => row.route.provider !== null)?.route.provider ?? null };
}

function yInterval(rows: readonly MetricsRow[], s: Stats, y: FrontierY): { interval: Interval; n: number } {
  switch (y) {
    case "first-pass":
      return { interval: s.firstPass, n: s.settled };
    case "clean":
      return { interval: s.clean, n: s.settled };
    case "not-blocked":
      return { interval: wilson(rows.filter((row) => row.settled && !row.blockedHere).length, s.settled), n: s.settled };
    case "landed":
      return { interval: wilson(s.landed, s.runs), n: s.runs };
  }
}

/** Does `q` dominate `p`: at least as cheap and at least as good, and strictly better in one? */
function dominates(q: { x: number; interval: Interval }, p: { x: number; interval: Interval }): boolean {
  const qy = q.interval.p!, py = p.interval.p!;
  return q.x <= p.x && qy >= py && (q.x < p.x || qy > py);
}

/**
 * One role's routes on y against x, over rankable rows only. A route with no x
 * value or no y observation is returned as unplaced, with the reason. Only
 * routes with at least 5 in the interval's denominator shape the Pareto line;
 * the rest come back hollow. Routes that tie exactly are both on the line.
 */
export function frontier(rows: readonly MetricsRow[], role: string, y: FrontierY, x: FrontierX, price: RowPrice): Frontier {
  const candidates = [...byRoute(rows, role)].map(([key, group]) => {
    const s = stats(group, price);
    const { interval, n } = yInterval(group, s, y);
    return { key, route: routeOfGroup(group), stats: s, interval, n, x: x === "list-per-row" ? s.listPerRow : s.medianMinutes };
  });
  const isPlaced = (point: (typeof candidates)[number]): point is typeof point & { x: number } =>
    point.x !== null && point.interval.p !== null;
  const placed = candidates.filter(isPlaced);
  const unplaced = candidates.filter((point) => !isPlaced(point))
    .map((point): UnplacedRoute => ({
      key: point.key,
      route: point.route,
      reason: point.interval.p === null ? "no-observation" : x === "list-per-row" ? "unpriced" : "no-minutes",
    })).sort((a, b) => (a.key < b.key ? -1 : 1));
  const excluded = rows.filter((row) => row.role === role && routeKey(row.route) !== null && !isRankable(row)).length;
  const solid = placed.filter((point) => point.n >= MIN_SETTLED);
  const points = placed.map((point): RoutePoint => ({
    role,
    ...point,
    hollow: point.n < MIN_SETTLED,
    onFrontier: point.n >= MIN_SETTLED && !solid.some((other) => other !== point && dominates(other, point)),
  })).sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
  return { role, y, x, points, line: points.filter((point) => point.onFrontier), unplaced, excluded };
}

export type VerdictTag = "insufficient" | "underpowered" | "overkill" | "frontier";

export interface Verdict {
  readonly key: string;
  readonly tag: VerdictTag;
  readonly text: string;
  /** The route the verdict compares against: the best one when underpowered, the cheaper one when overkill. */
  readonly against: string | null;
  /** How many times the cheaper route's x this route's x is; set only when overkill. */
  readonly ratio: number | null;
}

const Y_LABEL: Readonly<Record<FrontierY, string>> = {
  "first-pass": "first-pass yield",
  clean: "clean completion",
  "not-blocked": "not blocked here",
  landed: "run landed",
};

function pct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

/** The highest y among eligible points; ties go to the cheaper, then to the first key. */
function bestOf<T extends { key: string; interval: Interval; x: number | null }>(eligible: readonly T[]): T | undefined {
  return [...eligible].sort((a, b) => b.interval.p! - a.interval.p! || (a.x ?? Infinity) - (b.x ?? Infinity) ||
    (a.key < b.key ? -1 : 1))[0];
}

/**
 * The recommendation rule, stated per route. Insufficient under 5 in `n`;
 * underpowered when the upper bound sits below the best eligible route's lower
 * bound; an overkill candidate when an eligible route whose interval overlaps
 * costs at most 1/1.5 of it; on the frontier otherwise.
 */
export function verdicts(front: Frontier): Verdict[] {
  const eligible = front.points.filter((point) => !point.hollow);
  const best = bestOf(eligible);
  const cheaperWord = front.x === "list-per-row" ? "costs" : "runs";
  const lessWord = front.x === "list-per-row" ? "less" : "faster";
  return front.points.map((point): Verdict => {
    const { interval } = point;
    if (point.hollow) {
      return { key: point.key, tag: "insufficient", against: null, ratio: null,
        text: `Insufficient evidence: n ${point.n}, 95% CI ${pct(interval.lo)} to ${pct(interval.hi)}.` };
    }
    if (best !== undefined && best !== point && interval.hi < best.interval.lo) {
      return { key: point.key, tag: "underpowered", against: best.key, ratio: null,
        text: `Underpowered next to ${routeLabel(best.route)}: upper bound ${pct(interval.hi)} is below its lower bound ${pct(best.interval.lo)}.` };
    }
    const cheaper = eligible.filter((other) => other !== point && other.x * OVERKILL_RATIO <= point.x && overlaps(other.interval, interval))
      .sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1))[0];
    if (cheaper !== undefined) {
      const ratio = point.x / cheaper.x;
      return { key: point.key, tag: "overkill", against: cheaper.key, ratio,
        text: `Overkill candidate: ${routeLabel(cheaper.route)} ${cheaperWord} ${ratio.toFixed(1)}× ${lessWord} with an overlapping interval. Confirm on paired replays before switching.` };
    }
    return { key: point.key, tag: "frontier", against: null, ratio: null,
      text: `On or near the frontier for ${front.role}: ${pct(interval.p)} ${Y_LABEL[front.y]}.` };
  });
}

// ---------------------------------------------------------------------------
// The recommendation.
// ---------------------------------------------------------------------------

export interface RouteEvidence {
  readonly key: string;
  readonly route: MetricsRoute;
  readonly settled: number;
  /** Settled rows that were first pass. */
  readonly firstPasses: number;
  /** Local evidence only. */
  readonly firstPass: Interval;
  readonly listPerRow: number | null;
  /** The supplied prior mean, shown beside the local numbers and never added into them. */
  readonly prior: number | null;
  /** Prior-only branch: the Beta posterior mean used to rank. `null` on the local branch or with no prior. */
  readonly priorScore: number | null;
}

export interface Recommendation {
  readonly role: string;
  readonly taskClass: string | null;
  readonly source: EvidenceSource;
  /** `prior only` when no route had 5 settled rows and the ranking leans on the supplied priors. */
  readonly basis: "local" | "prior only";
  readonly choice: RouteEvidence;
  /** Local: the route with the highest first-pass yield. Prior only: the top-ranked route. */
  readonly best: RouteEvidence;
  /** Every candidate, in recommendation order. */
  readonly ranked: readonly RouteEvidence[];
}

export interface RecommendOptions {
  readonly price: RowPrice;
  readonly prior: PriorLookup;
  /** Routes offered but never run. They are ranked on the prior-only branch alone, with no local evidence. */
  readonly untested?: readonly MetricsRoute[];
}

function byCost(a: RouteEvidence, b: RouteEvidence): number {
  return (a.listPerRow ?? Infinity) - (b.listPerRow ?? Infinity) || (b.firstPass.p ?? -1) - (a.firstPass.p ?? -1) ||
    (a.key < b.key ? -1 : 1);
}

/**
 * The cheapest route whose first-pass interval overlaps the best route's,
 * among the role's routes with at least 5 settled rankable rows in one
 * evidence source and, when given, one task class. When no route has 5 settled
 * rows, routes rank by the posterior mean of a Beta prior of strength 4 whose
 * mean the caller supplies, and the result is labelled `prior only`; the
 * untested routes join that ranking with no local evidence, and routes with no
 * prior rank last. `null` when there is nothing to rank.
 */
export function recommend(
  rows: readonly MetricsRow[],
  role: string,
  taskClass: string | null,
  source: EvidenceSource,
  options: RecommendOptions,
): Recommendation | null {
  const scoped = rows.filter((row) => evidenceSource(row) === source && (taskClass === null || row.taskClass === taskClass));
  const evidence = [...byRoute(scoped, role)].map(([key, group]): RouteEvidence => {
    const s = stats(group, options.price);
    const route = routeOfGroup(group);
    return {
      key,
      route,
      settled: s.settled,
      firstPasses: group.filter((row) => row.settled && row.firstPass).length,
      firstPass: s.firstPass,
      listPerRow: s.listPerRow,
      prior: options.prior(role, route),
      priorScore: null,
    };
  });
  const eligible = evidence.filter((route) => route.settled >= MIN_SETTLED);
  if (eligible.length > 0) {
    const best = bestOf(eligible.map((route) => ({ ...route, interval: route.firstPass, x: route.listPerRow })))!;
    const within = eligible.filter((route) => overlaps(route.firstPass, best.firstPass)).sort(byCost);
    const rest = eligible.filter((route) => !within.includes(route))
      .sort((a, b) => b.firstPass.p! - a.firstPass.p! || (a.key < b.key ? -1 : 1));
    const ranked = [...within, ...rest];
    return { role, taskClass, source, basis: "local", choice: ranked[0]!, best: evidence.find((route) => route.key === best.key)!, ranked };
  }
  const seen = new Set(evidence.map((route) => route.key));
  const untested = (options.untested ?? []).flatMap((route): RouteEvidence[] => {
    const key = routeKey(route);
    if (key === null || seen.has(key)) return [];
    seen.add(key);
    return [{ key, route, settled: 0, firstPasses: 0, firstPass: wilson(0, 0), listPerRow: null, prior: options.prior(role, route), priorScore: null }];
  });
  if (evidence.length === 0 && untested.length === 0) return null;
  const ranked = [...evidence, ...untested].map((route): RouteEvidence => {
    if (route.prior === null) return route;
    return { ...route, priorScore: (route.firstPasses + PRIOR_STRENGTH * route.prior) / (route.settled + PRIOR_STRENGTH) };
  }).sort((a, b) => (b.priorScore ?? -1) - (a.priorScore ?? -1) || byCost(a, b));
  return { role, taskClass, source, basis: "prior only", choice: ranked[0]!, best: ranked[0]!, ranked };
}

// ---------------------------------------------------------------------------
// Flat columns.
// ---------------------------------------------------------------------------

export interface FlatColumn<G> {
  readonly id: string;
  readonly value: (group: G) => unknown;
}

/** The ids of the columns whose value is identical across every group, when there are at least two groups. */
export function flatColumns<G>(groups: readonly G[], columns: readonly FlatColumn<G>[]): string[] {
  if (groups.length < 2) return [];
  return columns.filter((column) => {
    const [first, ...rest] = groups.map(column.value);
    return rest.every((value) => value === first);
  }).map((column) => column.id);
}
