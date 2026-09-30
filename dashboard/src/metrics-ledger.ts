import type { MetricsRoleRow, RateCardRow } from "../shared/types.ts";
import { STATE_GROUPS, TOOL_CLASSES, routeKey, stats, taskClassOf, type FacetValue, type RowPrice, type StateGroup, type Stats } from "../shared/route-metrics.ts";
import { formatListEquivalent } from "../shared/rate-card.ts";
import { formatTokens, shortSessionId } from "./display.ts";
import {
  COLUMN_FAMILIES,
  DEFAULT_SORT,
  EFFORT_ORDER,
  ROLE_ORDER,
  STATE_LABEL,
  STATE_TONE,
  fromToken,
  modelLabel,
  modelProvider,
  observedModel,
  toToken,
  type ColumnFamily,
  type LedgerGroup,
  type LedgerSort,
  type Provider,
} from "./metrics-lens.ts";
import { routeProvider, routeTitle } from "./metrics-matrix.ts";

/**
 * The Ledger: the lens's role-rows grouped one way, one row per group, and the
 * module's `stats` over each group in column families. Every number here is a
 * field of `Stats`; this file groups, labels, sorts and flags flat columns.
 */

export const GROUP_LABEL: Readonly<Record<LedgerGroup, string>> = {
  route: "Route",
  role: "Role",
  model: "Model",
  effort: "Effort",
  workflow: "Workflow",
  project: "Project",
  taskClass: "Task class",
  run: "Run",
};

export const FAMILY_LABEL: Readonly<Record<ColumnFamily, string>> = {
  outcome: "Outcome",
  verification: "Verification",
  work: "Work",
  tokens: "Tokens",
  cost: "Cost",
  provenance: "Provenance",
};

export const FLAT_TITLE = "flat across every group: no signal in this lens";

/** R·S·E·X·O: the tool classes in `TOOL_CLASSES` order, one letter each. */
export const TOOL_LETTER: Readonly<Record<(typeof TOOL_CLASSES)[number], string>> = {
  read: "R", search: "S", edit: "E", exec: "X", other: "O",
};

export interface LedgerCell {
  readonly text: string;
  /** A second, quieter figure: an interval beside a rate. */
  readonly note?: string;
  /** Nothing to show: the cell reads "–" in the faint colour. */
  readonly empty?: boolean;
  readonly title?: string;
}

export interface LedgerColumn {
  readonly id: string;
  readonly family: ColumnFamily;
  readonly label: string;
  /** What the column sorts on and what flat detection compares; `null` sorts last either way. */
  readonly value: (s: Stats) => number | null;
  readonly cell: (s: Stats) => LedgerCell;
  /** The terminal-state strip draws segments instead of text. */
  readonly strip?: true;
}

function pct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

function fixed(value: number | null, digits: number): LedgerCell {
  return value === null ? { text: "–", empty: true } : { text: value.toFixed(digits) };
}

function count(value: number): LedgerCell {
  return { text: String(value) };
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function interval(s: Stats["firstPass"]): LedgerCell {
  return s.p === null ? { text: "–", empty: true } : { text: pct(s.p), note: `${pct(s.lo)}–${pct(s.hi)}` };
}

function tally(counts: Readonly<Record<string, number>>, rename: (key: string) => string = (key) => key): LedgerCell {
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return entries.length === 0 ? { text: "–", empty: true } : { text: entries.map(([key, n]) => `${rename(key)} ${n}`).join(" · ") };
}

function tokens(value: number | null): LedgerCell {
  return value === null ? { text: "–", empty: true } : { text: formatTokens(value) };
}

function money(value: number | null): LedgerCell {
  return value === null ? { text: "≈ list —", empty: true } : { text: formatListEquivalent(value) };
}

const stateColumns: LedgerColumn[] = STATE_GROUPS.map((group) => ({
  id: `state-${group}`,
  family: "outcome",
  label: STATE_LABEL[group],
  value: (s) => s.states[group],
  cell: (s) => count(s.states[group]),
}));

/** Every column, in family order. Cost labels carry no "$": every figure is `formatListEquivalent`'s. */
export const LEDGER_COLUMNS: readonly LedgerColumn[] = Object.freeze([
  { id: "runs", family: "outcome", label: "Runs", value: (s) => s.runs, cell: (s) => count(s.runs) },
  {
    id: "strip", family: "outcome", label: "Terminal states", strip: true,
    value: (s) => ratio(s.landed, s.runs),
    cell: (s) => ({ text: "", title: STATE_GROUPS.map((group) => `${STATE_LABEL[group]} ${s.states[group]}`).join(" · ") }),
  },
  ...stateColumns,
  { id: "blocked-here", family: "outcome", label: "Blocked here", value: (s) => s.blockedHere, cell: (s) => count(s.blockedHere) },
  { id: "fp", family: "outcome", label: "First-pass", value: (s) => s.firstPass.p, cell: (s) => interval(s.firstPass) },
  { id: "clean", family: "outcome", label: "Clean completion", value: (s) => s.clean.p, cell: (s) => interval(s.clean) },
  {
    id: "recovered", family: "outcome", label: "Recovered by correction",
    value: (s) => ratio(s.recovered, s.corrected),
    cell: (s) => (s.corrected === 0 ? { text: "–", empty: true } : { text: `${s.recovered}/${s.corrected}` }),
  },
  { id: "corrections", family: "outcome", label: "Corrections/row", value: (s) => s.correctionsPerRow, cell: (s) => fixed(s.correctionsPerRow, 2) },
  { id: "rework", family: "outcome", label: "Owner rework runs", value: (s) => s.reworkRuns, cell: (s) => count(s.reworkRuns) },

  { id: "gates", family: "verification", label: "Gate checks", value: (s) => s.gateChecks, cell: (s) => count(s.gateChecks) },
  { id: "gate-pass", family: "verification", label: "Gate pass", value: (s) => s.gatePassRate, cell: (s) => (s.gatePassRate === null ? { text: "–", empty: true } : { text: pct(s.gatePassRate) }) },
  {
    id: "refuted", family: "verification", label: "Refuted claims",
    value: (s) => ratio(s.refuted, s.claims),
    cell: (s) => (s.claims === 0 ? { text: "–", empty: true } : { text: `${s.refuted}/${s.claims}` }),
  },
  { id: "honest", family: "verification", label: "Honest stops", value: (s) => s.honestStops, cell: (s) => count(s.honestStops) },
  { id: "guardrail", family: "verification", label: "Guardrail hits", value: (s) => s.guardrailHits, cell: (s) => count(s.guardrailHits) },
  {
    id: "top-fail", family: "verification", label: "Top first-round failure",
    value: (s) => s.topFirstRoundFail?.rows ?? 0,
    cell: (s) => (s.topFirstRoundFail === null ? { text: "none", empty: true } : { text: `${s.topFirstRoundFail.gate} ×${s.topFirstRoundFail.rows}` }),
  },

  { id: "minutes", family: "work", label: "Median min", value: (s) => s.medianMinutes, cell: (s) => fixed(s.medianMinutes, 1) },
  { id: "turns", family: "work", label: "Turns/row", value: (s) => s.turnsPerRow, cell: (s) => fixed(s.turnsPerRow, 1) },
  { id: "tools", family: "work", label: "Tool calls/row", value: (s) => s.toolsPerRow, cell: (s) => fixed(s.toolsPerRow, 0) },
  {
    id: "mix", family: "work", label: "Tool mix R·S·E·X·O",
    value: (s) => ratio(s.tools.edit, s.toolTotal),
    cell: (s) => (s.toolTotal === 0 ? { text: "–", empty: true } : {
      text: TOOL_CLASSES.map((name) => `${TOOL_LETTER[name]}${Math.round((100 * s.tools[name]) / s.toolTotal)}`).join(" "),
      title: "percent of tool calls: read · search · edit · exec · other",
    }),
  },
  { id: "landed-per-hour", family: "work", label: "Landed per agent-hour", value: (s) => s.landedPerAgentHour, cell: (s) => fixed(s.landedPerAgentHour, 2) },
  { id: "tool-errors", family: "work", label: "Tool errors", value: (s) => s.toolErrorRate, cell: (s) => (s.toolErrorRate === null ? { text: "–", empty: true } : { text: pct(s.toolErrorRate) }) },

  { id: "input", family: "tokens", label: "Input", value: (s) => s.tokens.input, cell: (s) => tokens(s.tokens.input) },
  { id: "cache-read", family: "tokens", label: "Cache read", value: (s) => s.tokens.cacheRead, cell: (s) => tokens(s.tokens.cacheRead) },
  { id: "cache-write", family: "tokens", label: "Cache write", value: (s) => s.tokens.cacheWrite, cell: (s) => tokens(s.tokens.cacheWrite) },
  { id: "output", family: "tokens", label: "Output", value: (s) => s.tokens.output, cell: (s) => tokens(s.tokens.output) },
  {
    id: "reasoning-share", family: "tokens", label: "Reasoning share",
    value: (s) => (s.tokens.reasoning === null || !s.tokens.output ? null : s.tokens.reasoning / s.tokens.output),
    cell: (s) => (s.tokens.reasoning === null || !s.tokens.output ? { text: "–", empty: true } : { text: pct(s.tokens.reasoning / s.tokens.output) }),
  },
  {
    id: "cache-ratio", family: "tokens", label: "Cache read ÷ input + output",
    value: (s) => (s.tokens.cacheRead === null || !s.tokens.total ? null : s.tokens.cacheRead / s.tokens.total),
    cell: (s) => (s.tokens.cacheRead === null || !s.tokens.total ? { text: "–", empty: true } : { text: `${(s.tokens.cacheRead / s.tokens.total).toFixed(1)}×` }),
  },

  {
    id: "list-total", family: "cost", label: "List total", value: (s) => s.listTotal,
    cell: (s) => ({ ...money(s.listTotal), ...(s.priced < s.n ? { title: `${s.n - s.priced} of ${s.n} role-rows unpriced` } : {}) }),
  },
  { id: "list-row", family: "cost", label: "List per row", value: (s) => s.listPerRow, cell: (s) => money(s.listPerRow) },
  { id: "list-landed", family: "cost", label: "List per landed run", value: (s) => s.listPerLanded, cell: (s) => money(s.listPerLanded) },

  {
    id: "cost-authority", family: "provenance", label: "Cost authority",
    value: (s) => s.costAuthority["catalog-estimate"] ?? 0,
    cell: (s) => tally(s.costAuthority, (key) => (key === "unavailable" ? "subscription" : key)),
  },
  { id: "identity", family: "provenance", label: "Model identity", value: (s) => s.identity["stream-authoritative"] ?? 0, cell: (s) => tally(s.identity) },
  { id: "effort-source", family: "provenance", label: "Effort source", value: (s) => s.effortSource["journal"] ?? 0, cell: (s) => tally(s.effortSource) },
  {
    id: "unrankable", family: "provenance", label: "Out of rankings",
    value: (s) => s.unrankable,
    cell: (s) => ({ text: String(s.unrankable), ...(s.unrankable > 0 ? { title: tally(s.unrankableReasons).text } : {}) }),
  },
] satisfies LedgerColumn[]);

/** The first column: the group's role-row count. It sorts, and is never flat-dimmed. */
export const COUNT_COLUMN = "n";

export function visibleColumns(families: readonly ColumnFamily[]): LedgerColumn[] {
  return LEDGER_COLUMNS.filter((column) => families.includes(column.family));
}

/** A group's key per role-row, as a lens token so `null` groups too. */
export function groupValue(row: MetricsRoleRow, group: LedgerGroup): FacetValue {
  switch (group) {
    case "route": return routeKey(row.route);
    case "role": return row.role;
    case "taskClass": return taskClassOf(row);
    case "model": return observedModel(row);
    case "effort": return row.route.effort;
    case "workflow": return row.workflow;
    case "project": return row.project;
    case "run": return row.sessionId;
  }
}

export interface LedgerContext {
  readonly rateCard: readonly RateCardRow[];
  readonly priorLabels: Readonly<Record<string, string>>;
  readonly roleColors: Readonly<Record<string, string>>;
}

export interface LedgerRow {
  /** The group's value as a lens token. */
  readonly key: string;
  readonly title: string;
  /** Under the title: "n role-rows", or the run's id and attempt. */
  readonly detail: string;
  readonly provider: Provider | null;
  /** A role's configured colour. */
  readonly dot: string | null;
  /** Grouped by run, the session a click opens. */
  readonly run: string | null;
  readonly stats: Stats;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rankIn(order: readonly string[], value: string): number {
  const index = order.indexOf(value);
  return index < 0 ? order.length : index;
}

function describe(group: LedgerGroup, value: FacetValue, rows: readonly MetricsRoleRow[], all: readonly MetricsRoleRow[], context: LedgerContext):
  Pick<LedgerRow, "title" | "provider" | "dot" | "run"> & { readonly detail?: string } {
  const first = rows[0]!;
  switch (group) {
    case "route": {
      if (value === null) return { title: "no single route", provider: null, dot: null, run: null };
      const named = routeTitle(first.route, rows, context.rateCard, context.priorLabels);
      return { title: named.title, provider: routeProvider(first.route, named.card, all, context.rateCard), dot: null, run: null };
    }
    case "role": return { title: first.role, provider: null, dot: context.roleColors[first.role] ?? "var(--faint)", run: null };
    case "model": return { title: modelLabel(value, context.rateCard), provider: modelProvider(value, context.rateCard, all), dot: null, run: null };
    case "run": return { title: first.taskId, detail: `${shortSessionId(first.sessionId)} · attempt ${first.attempt}`, provider: null, dot: null, run: first.sessionId };
    default: return { title: value ?? "unknown", provider: null, dot: null, run: null };
  }
}

/** One Ledger row per group value among the rows, each with the module's stats over its rows. */
export function groupRows(rows: readonly MetricsRoleRow[], group: LedgerGroup, price: RowPrice, context: LedgerContext): LedgerRow[] {
  const groups = new Map<string, MetricsRoleRow[]>();
  for (const row of rows) {
    const key = toToken(groupValue(row, group));
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [row]);
    else members.push(row);
  }
  return [...groups.entries()].map(([key, members]) => {
    const s = stats(members, price);
    const described = describe(group, fromToken(key), members, rows, context);
    return { key, detail: described.detail ?? `${s.n} role-rows`, ...described, stats: s };
  });
}

/** The group's natural order, the tie-break under every sort: roles and efforts in the design's order, else by title. */
function naturalOrder(group: LedgerGroup): (a: LedgerRow, b: LedgerRow) => number {
  if (group === "role") return (a, b) => rankIn(ROLE_ORDER, a.key) - rankIn(ROLE_ORDER, b.key) || compareText(a.key, b.key);
  if (group === "effort") return (a, b) => rankIn(EFFORT_ORDER, a.key) - rankIn(EFFORT_ORDER, b.key) || compareText(a.key, b.key);
  return (a, b) => compareText(a.title, b.title) || compareText(a.key, b.key);
}

/** The column a sort names, or the count column when the Ledger does not show it. */
export function effectiveSort(sort: LedgerSort, columns: readonly LedgerColumn[]): LedgerSort {
  return sort.column === COUNT_COLUMN || columns.some((column) => column.id === sort.column) ? sort : { ...DEFAULT_SORT, dir: sort.dir };
}

/** Sorted by the column's value; a group with no value sorts last in either direction. */
export function sortRows(rows: readonly LedgerRow[], sort: LedgerSort, columns: readonly LedgerColumn[], group: LedgerGroup): LedgerRow[] {
  const active = effectiveSort(sort, columns);
  const column = columns.find((candidate) => candidate.id === active.column);
  const value = (row: LedgerRow): number | null => (column === undefined ? row.stats.n : column.value(row.stats));
  const sign = active.dir === "asc" ? 1 : -1;
  const natural = naturalOrder(group);
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || natural(a, b);
    return (va - vb) * sign || natural(a, b);
  });
}

/**
 * The flat-line rule: with two groups or more, a column whose value is the
 * same in every group carries no signal in this lens. One group compares
 * nothing, so nothing is flat.
 */
export function flatColumns(rows: readonly LedgerRow[], columns: readonly LedgerColumn[]): Set<string> {
  if (rows.length < 2) return new Set();
  return new Set(columns.filter((column) => {
    const first = column.value(rows[0]!.stats);
    return rows.every((row) => column.value(row.stats) === first);
  }).map((column) => column.id));
}

export interface StripSegment {
  readonly state: StateGroup;
  readonly runs: number;
  readonly tone: string;
}

/** The terminal-state strip: one segment per state that has runs, in `STATE_GROUPS` order, sized by runs. */
export function terminalStrip(s: Pick<Stats, "states">): StripSegment[] {
  return STATE_GROUPS.filter((group) => s.states[group] > 0).map((group) => ({ state: group, runs: s.states[group], tone: STATE_TONE[group] }));
}

export interface LedgerHeader {
  readonly id: string;
  readonly family: ColumnFamily | null;
  readonly label: string;
  readonly flat: boolean;
  readonly ariaSort: "ascending" | "descending" | undefined;
}

export interface LedgerFamilyHead {
  readonly family: ColumnFamily;
  readonly label: string;
  readonly span: number;
}

export interface Ledger {
  readonly group: LedgerGroup;
  readonly families: readonly LedgerFamilyHead[];
  /** The count column first, then every visible column. */
  readonly headers: readonly LedgerHeader[];
  readonly columns: readonly LedgerColumn[];
  readonly rows: readonly LedgerRow[];
  readonly flat: ReadonlySet<string>;
}

export function buildLedger(
  rows: readonly MetricsRoleRow[],
  view: { readonly group: LedgerGroup; readonly families: readonly ColumnFamily[]; readonly sort: LedgerSort },
  price: RowPrice,
  context: LedgerContext,
): Ledger {
  const columns = visibleColumns(view.families);
  const sort = effectiveSort(view.sort, columns);
  const grouped = sortRows(groupRows(rows, view.group, price, context), sort, columns, view.group);
  const flat = flatColumns(grouped, columns);
  const ariaSort = (id: string): LedgerHeader["ariaSort"] => (sort.column === id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined);
  return {
    group: view.group,
    families: COLUMN_FAMILIES.filter((family) => view.families.includes(family))
      .map((family) => ({ family, label: FAMILY_LABEL[family], span: columns.filter((column) => column.family === family).length })),
    headers: [
      { id: COUNT_COLUMN, family: null, label: `${GROUP_LABEL[view.group]} · rows`, flat: false, ariaSort: ariaSort(COUNT_COLUMN) },
      ...columns.map((column) => ({ id: column.id, family: column.family, label: column.label, flat: flat.has(column.id), ariaSort: ariaSort(column.id) })),
    ],
    columns,
    rows: grouped,
    flat,
  };
}
