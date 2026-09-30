import type { RateCardRow } from "../shared/types.ts";
import {
  MIN_SETTLED,
  routeCells,
  type Frontier,
  type FrontierX,
  type FrontierY,
  type MetricsRow,
  type Verdict,
  type VerdictTag,
} from "../shared/route-metrics.ts";
import { formatListEquivalent } from "../shared/rate-card.ts";
import {
  PERCENT_TICKS,
  formatPercentTick,
  formatTick,
  linearScale,
  logDomain,
  logScale,
  logTicks,
  placeLabels,
  thinTicks,
  type PlacedLabel,
  type Rect,
} from "./metrics-chart.ts";
import type { Provider } from "./metrics-lens.ts";
import { roleColumns, routeProvider, routeTitle } from "./metrics-matrix.ts";

/**
 * The Frontier: one role's routes, cost or minutes against a success rate.
 * The points, the Pareto line and the verdicts are the module's `frontier` and
 * `verdicts`; this file lays them out and words them. One role at a time, so
 * no mark ever compares routes across roles (INV-4).
 */

export const Y_PILLS: readonly { readonly id: FrontierY; readonly label: string }[] = [
  { id: "first-pass", label: "First-pass yield" },
  { id: "clean", label: "Clean completion" },
  { id: "not-blocked", label: "Not blocked here" },
  { id: "landed", label: "Run landed" },
];

export const X_PILLS: readonly { readonly id: FrontierX; readonly label: string }[] = [
  { id: "list-per-row", label: "≈ list $ per role-row" },
  { id: "median-minutes", label: "Median minutes per role-row" },
];

/** Roles with a keyed row in the lens, in the design's order: the only roles a Frontier can draw. */
export function frontierRoles(rows: readonly MetricsRow[]): string[] {
  return roleColumns(routeCells(rows));
}

/** The picked role when the lens still has it; otherwise the role with the most keyed rows, ties in role order. */
export function frontierRole(picked: string | null, rows: readonly MetricsRow[]): string | null {
  const roles = frontierRoles(rows);
  if (picked !== null && roles.includes(picked)) return picked;
  const counts = new Map<string, number>();
  for (const cell of routeCells(rows)) counts.set(cell.role, (counts.get(cell.role) ?? 0) + cell.rows.length);
  return [...roles].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || roles.indexOf(a) - roles.indexOf(b))[0] ?? null;
}

export function zoneLabels(x: FrontierX): { readonly good: string; readonly bad: string } {
  return x === "list-per-row"
    ? { good: "cheap and strong", bad: "costly and weak" }
    : { good: "fast and strong", bad: "slow and weak" };
}

/** A point's x as text, always with its unit; a list-price equivalent always through `formatListEquivalent`. */
export function formatX(value: number, x: FrontierX): string {
  return x === "list-per-row" ? `${formatListEquivalent(value)} per row` : `${value.toFixed(1)} min per row`;
}

function pct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

export interface RouteName {
  readonly title: string;
  readonly provider: Provider | null;
}

/** Each route key's title and glyph, named from every lens row on that route (the Matrix's row label). */
export function routeNames(
  rows: readonly MetricsRow[],
  rateCard: readonly RateCardRow[],
  priorLabels: Readonly<Record<string, string>>,
): Map<string, RouteName> {
  const names = new Map<string, RouteName>();
  const byKey = new Map<string, MetricsRow[]>();
  for (const cell of routeCells(rows)) byKey.set(cell.key, [...(byKey.get(cell.key) ?? []), ...cell.rows]);
  for (const [key, keyed] of byKey) {
    const route = routeCells(keyed)[0]!.route;
    const named = routeTitle(route, keyed, rateCard, priorLabels);
    names.set(key, { title: named.title, provider: routeProvider(route, named.card, rows, rateCard) });
  }
  return names;
}

export interface FrontierMark {
  readonly key: string;
  readonly title: string;
  readonly provider: Provider | null;
  readonly hollow: boolean;
  readonly badged: boolean;
  /** The actual x is below the log domain's lower end, so the mark is pinned there. */
  readonly belowFloor: boolean;
  readonly onFrontier: boolean;
  readonly cx: number;
  readonly cy: number;
  /** The whisker's ends, in px: the 95% Wilson interval. */
  readonly whiskerTop: number;
  readonly whiskerBottom: number;
  readonly label: PlacedLabel | null;
  readonly labelText: string;
  readonly labelLines: readonly string[];
  readonly tooltip: readonly string[];
  readonly ariaLabel: string;
}

export interface FrontierPlot {
  readonly width: number;
  readonly height: number;
  readonly plot: Rect;
  readonly xTicks: readonly { readonly x: number; readonly text: string }[];
  readonly yTicks: readonly { readonly y: number; readonly text: string }[];
  readonly marks: readonly FrontierMark[];
  /** The Pareto polyline's `points`, cheapest first; empty when fewer than two points shape it. */
  readonly line: string;
  readonly zones: readonly { readonly text: string; readonly x: number; readonly y: number; readonly anchor: "start" | "end" }[];
  readonly xTitle: string;
  readonly yTitle: string;
}

export const PLOT_SIZE = Object.freeze({ width: 960, height: 520, left: 86, right: 24, top: 22, bottom: 62 });
const MARK_RADIUS = 9;
const LABEL_FONT = Object.freeze({ charWidth: 7.8, lineHeight: 18, gap: 16 });

export function frontierPlot(front: Frontier, names: ReadonlyMap<string, RouteName>): FrontierPlot {
  const { width, height, left, right, top, bottom } = PLOT_SIZE;
  const plot: Rect = { x: left, y: top, width: width - left - right, height: height - top - bottom };
  const plotted = [...front.points, ...front.badged];
  const domain = logDomain(plotted.map((point) => point.x));
  const sx = logScale(domain, [plot.x, plot.x + plot.width]);
  const sy = linearScale([0, 1], [plot.y + plot.height, plot.y]);
  const yLabel = Y_PILLS.find((pill) => pill.id === front.y)!.label;
  const unit = front.y === "landed" ? "runs" : "settled rows";

  const badgedKeys = new Set(front.badged.map((point) => point.key));
  const base = plotted.map((point) => {
    const name = names.get(point.key) ?? { title: point.key, provider: null };
    const badged = badgedKeys.has(point.key);
    const belowFloor = point.x < domain[0];
    const tooltip = [
      name.title,
      `${yLabel} ${pct(point.interval.p)} · 95% CI ${pct(point.interval.lo)} to ${pct(point.interval.hi)}`,
      `n ${point.n} ${unit}`,
      formatX(point.x, front.x),
      ...(badged ? ["Identity unconfirmed: route-attributed, plotted but not ranked"]
        : point.hollow ? [`Hollow: fewer than ${MIN_SETTLED}, so it does not shape the line`] : []),
      ...(belowFloor ? [`At axis floor ${formatX(domain[0], front.x)}; actual value shown above`] : []),
      ...(point.onFrontier ? ["On the Pareto line"] : []),
    ];
    const labelLines = [
      `${name.title} · n${point.n}`,
      ...(badged ? ["identity unconfirmed"] : []),
      ...(belowFloor ? ["↓ at axis floor"] : []),
    ];
    return {
      point,
      name,
      badged,
      belowFloor,
      cx: sx(point.x),
      cy: sy(point.interval.p!),
      tooltip,
      labelLines,
      labelText: labelLines.join(" · "),
    };
  });
  const avoid = base.map((mark) => ({ x: mark.cx - MARK_RADIUS, y: mark.cy - MARK_RADIUS, width: MARK_RADIUS * 2, height: MARK_RADIUS * 2 }));
  const labels = placeLabels(
    base.map((mark) => ({
      id: mark.point.key,
      x: mark.cx,
      y: mark.cy,
      text: [...mark.labelLines].sort((a, b) => b.length - a.length)[0]!,
      lines: mark.labelLines.length,
      // The line's routes name themselves first, then the better-evidenced.
      priority: (mark.point.onFrontier ? 10_000 : 0) + mark.point.n,
    })),
    plot,
    { ...LABEL_FONT, avoid },
  );
  const marks = base.map((mark, index): FrontierMark => ({
    key: mark.point.key,
    title: mark.name.title,
    provider: mark.name.provider,
    hollow: mark.point.hollow,
    badged: mark.badged,
    belowFloor: mark.belowFloor,
    onFrontier: mark.point.onFrontier,
    cx: mark.cx,
    cy: mark.cy,
    whiskerTop: sy(mark.point.interval.hi),
    whiskerBottom: sy(mark.point.interval.lo),
    label: labels[index] ?? null,
    labelText: mark.labelText,
    labelLines: mark.labelLines,
    tooltip: mark.tooltip,
    ariaLabel: mark.tooltip.join(". "),
  }));
  const line = front.line.length < 2 ? "" : front.line.map((point) => `${sx(point.x).toFixed(1)},${sy(point.interval.p!).toFixed(1)}`).join(" ");
  const zones = zoneLabels(front.x);
  return {
    width,
    height,
    plot,
    xTicks: thinTicks(logTicks(domain), sx, 44).map((tick) => ({ x: sx(tick), text: formatTick(tick) })),
    yTicks: PERCENT_TICKS.map((tick) => ({ y: sy(tick), text: formatPercentTick(tick) })),
    marks,
    line,
    zones: [
      { text: zones.good, x: plot.x + 12, y: plot.y + 16, anchor: "start" },
      { text: zones.bad, x: plot.x + plot.width - 8, y: plot.y + plot.height - 12, anchor: "end" },
    ],
    xTitle: `${X_PILLS.find((pill) => pill.id === front.x)!.label} (log scale)`,
    yTitle: yLabel,
  };
}

export const TAG_TEXT: Readonly<Record<VerdictTag, string | null>> = {
  frontier: "frontier",
  overkill: "overkill?",
  underpowered: "underpowered",
  insufficient: null,
};

export interface VerdictCard {
  readonly key: string;
  readonly title: string;
  readonly provider: Provider | null;
  readonly tag: VerdictTag;
  readonly tagText: string | null;
  readonly text: string;
  /** The point's x with its unit. */
  readonly value: string;
}

/** One card per placed route, dearest first, each carrying the module's verdict word for word. */
export function verdictCards(front: Frontier, verdicts: readonly Verdict[], names: ReadonlyMap<string, RouteName>): VerdictCard[] {
  return [...front.points].reverse().map((point): VerdictCard => {
    const verdict = verdicts.find((candidate) => candidate.key === point.key)!;
    const name = names.get(point.key) ?? { title: point.key, provider: null };
    return {
      key: point.key,
      title: name.title,
      provider: name.provider,
      tag: verdict.tag,
      tagText: TAG_TEXT[verdict.tag],
      text: verdict.text,
      value: formatX(point.x, front.x),
    };
  });
}

/** Why a route of the role is not on the chart, in words. */
export function unplacedText(reason: "unpriced" | "no-minutes" | "no-observation"): string {
  return reason === "unpriced" ? "no priced rows" : reason === "no-minutes" ? "no minutes recorded" : "nothing settled";
}
