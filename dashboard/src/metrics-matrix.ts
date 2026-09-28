import type { MetricsResponse, RateCardRow, UntestedRoute } from "../shared/types.ts";
import {
  RAISED_HALF_WIDTH,
  canonicalModel,
  coverage,
  depth,
  routeCells,
  routeKey,
  stats,
  wilson,
  type Depth,
  type MetricsRoute,
  type MetricsRow,
  type RowPrice,
} from "../shared/route-metrics.ts";
import { formatListEquivalent } from "../shared/rate-card.ts";
import { EFFORT_ORDER, ROLE_ORDER, modelProvider, providerOf, type Provider } from "./metrics-lens.ts";

/**
 * The Matrix: routes down, roles across, one tile per role on a route. Every
 * number on a tile is the module's `stats` over that cell's rows, and its
 * depth is the module's `depth`. This file only arranges and labels them.
 */

/** The role order, keeping only roles the rows show; unknown roles follow in code-point order. */
export function roleColumns(rows: readonly Pick<MetricsRow, "role">[]): string[] {
  const seen = [...new Set(rows.map((row) => row.role))];
  const rank = (role: string) => {
    const index = (ROLE_ORDER as readonly string[]).indexOf(role);
    return index < 0 ? ROLE_ORDER.length : index;
  };
  return seen.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** A rate-card price pair per 1M tokens, as the row label shows it. It is a published price, not a list-price equivalent. */
export function formatRate(card: Pick<RateCardRow, "input" | "output">): string {
  return `$${card.input} / $${card.output}`;
}

export interface RouteTitle {
  /** "Opus 5 · high". */
  readonly title: string;
  /** "$5 / $25 · TB 4.0 52.3", or why there is no price. */
  readonly detail: string;
  /** The card that prices the route, when exactly one model answered on it. */
  readonly card: RateCardRow | null;
  /** Every card among the models that answered, or the selector's; the Matrix sorts a pooled route by the dearest. */
  readonly cards: readonly RateCardRow[];
}

/**
 * A route's name from the rows that ran on it. One model observed answering
 * names it; none falls back to the selector, which reads "(selector)" unless
 * it is itself a card id. Route keys are selector-based, so a key can pool two
 * models (T06 C10): the title names both and the Model rail splits them.
 */
export function routeTitle(
  route: MetricsRoute,
  rows: readonly Pick<MetricsRow, "resolvedModel">[],
  rateCard: readonly RateCardRow[],
  priorLabels: Readonly<Record<string, string>>,
): RouteTitle {
  const effort = route.effort ?? "unknown effort";
  const cardOf = (model: string) => rateCard.find((row) => row.model === model) ?? null;
  const models = [...new Set(rows.map((row) => row.resolvedModel).filter((model): model is string => model !== null))].sort();
  if (models.length > 1) {
    return {
      title: `${models.map((model) => cardOf(model)?.label ?? model).join(" / ")} · ${effort}`,
      detail: `${models.length} models answered · the Model rail splits them`,
      card: null,
      cards: models.map(cardOf).filter((card): card is RateCardRow => card !== null),
    };
  }
  const selector = canonicalModel(route);
  const model = models[0] ?? selector;
  const card = model === null ? null : cardOf(model);
  const name = card?.label ?? (model === null ? "unknown model" : models.length === 1 ? model : `${model} (selector)`);
  const prior = card === null ? undefined : priorLabels[card.model];
  const detail = card === null ? "not on the rate card" : prior === undefined ? formatRate(card) : `${formatRate(card)} · ${prior}`;
  return { title: `${name} · ${effort}`, detail, card, cards: card === null ? [] : [card] };
}

/**
 * The circle or diamond for a route: the provider its rows state, else the
 * card's, else another row on the same adapter's (config-derived rows carry
 * no provider; T04 C2).
 */
export function routeProvider(
  route: MetricsRoute,
  card: Pick<RateCardRow, "provider"> | null,
  rows: readonly MetricsRow[],
  rateCard: readonly RateCardRow[],
): Provider | null {
  const stated = providerOf(route.provider);
  if (stated !== null) return stated;
  if (card !== null) return card.provider;
  const fromModel = modelProvider(canonicalModel(route), rateCard, rows);
  if (fromModel !== null) return fromModel;
  return providerOf(rows.find((row) => row.route.adapter === route.adapter && row.route.provider !== null)?.route.provider ?? null);
}

export interface MatrixTile {
  readonly role: string;
  readonly key: string;
  /** Role-rows in the cell. */
  readonly n: number;
  readonly settled: number;
  readonly landed: number;
  /** First-pass yield over settled rows; `null` with none settled. */
  readonly firstPass: number | null;
  readonly blockedHere: number;
  readonly depth: Depth;
  /** "≈ list $1.58/row", or "≈ list —/row" when nothing in the cell is priced. */
  readonly perRow: string;
}

export interface MatrixRow {
  readonly key: string;
  readonly route: MetricsRoute;
  readonly tested: boolean;
  readonly title: string;
  readonly detail: string;
  readonly provider: Provider | null;
  /** One entry per column, in column order; `null` where the route has no row for that role. */
  readonly tiles: readonly (MatrixTile | null)[];
}

export interface Matrix {
  readonly columns: readonly string[];
  readonly rows: readonly MatrixRow[];
  /** Role-rows in the lens with no single route: they enter no tile. */
  readonly unkeyed: number;
  /** Untested routes the payload offers that are not already tested; shown only on request. */
  readonly untestedAvailable: number;
}

const PROVIDER_RANK: Readonly<Record<Provider, number>> = { anthropic: 0, openai: 1 };

function effortRank(effort: string | null): number {
  const index = effort === null ? -1 : (EFFORT_ORDER as readonly string[]).indexOf(effort);
  return index < 0 ? -1 : index;
}

type SortableRow = MatrixRow & { readonly cards: readonly RateCardRow[] };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tested first, then Anthropic before OpenAI, dearer before cheaper (a pooled route by its dearest model), higher effort first. */
function compareRows(a: SortableRow, b: SortableRow): number {
  const provider = (row: MatrixRow) => (row.provider === null ? 2 : PROVIDER_RANK[row.provider]);
  const dearest = (row: SortableRow) => [...row.cards].sort((x, y) => y.output - x.output || y.input - x.input)[0];
  const output = (row: SortableRow) => dearest(row)?.output ?? -1;
  const input = (row: SortableRow) => dearest(row)?.input ?? -1;
  const model = (row: MatrixRow) => row.title.slice(0, row.title.lastIndexOf(" · "));
  return Number(b.tested) - Number(a.tested) ||
    provider(a) - provider(b) ||
    output(b) - output(a) || input(b) - input(a) ||
    compareText(model(a), model(b)) ||
    effortRank(b.route.effort) - effortRank(a.route.effort) ||
    compareText(a.key, b.key);
}

/**
 * The Matrix over the rows in the lens. `showUntested` appends the payload's
 * untested routes whose key no tested route already has, each with its prior.
 */
export function buildMatrix(
  rows: readonly MetricsRow[],
  payload: Pick<MetricsResponse, "rateCard" | "priors" | "untestedRoutes">,
  price: RowPrice,
  showUntested: boolean,
): Matrix {
  const rateCard = payload.rateCard.rows;
  const cells = routeCells(rows);
  const columns = roleColumns(cells);
  const byKey = new Map<string, MetricsRow[]>();
  for (const cell of cells) byKey.set(cell.key, [...(byKey.get(cell.key) ?? []), ...cell.rows]);

  const tested = [...byKey].map(([key, keyed]) => {
    const route = cells.find((cell) => cell.key === key)!.route;
    const named = routeTitle(route, keyed, rateCard, payload.priors.modelLabels);
    const tiles = columns.map((role): MatrixTile | null => {
      const cell = cells.find((candidate) => candidate.key === key && candidate.role === role);
      if (cell === undefined) return null;
      const s = stats(cell.rows, price);
      return {
        role,
        key,
        n: s.n,
        settled: s.settled,
        landed: s.landed,
        firstPass: s.firstPass.p,
        blockedHere: s.blockedHere,
        depth: depth(s.firstPass, s.settled),
        perRow: `${formatListEquivalent(s.listPerRow)}/row`,
      };
    });
    return {
      key,
      route: { ...route, provider: route.provider ?? keyed.find((row) => row.route.provider !== null)?.route.provider ?? null },
      tested: true,
      title: named.title,
      detail: named.detail,
      provider: routeProvider(route, named.card, rows, rateCard),
      tiles,
      cards: named.cards,
    };
  });

  const untested = untestedRows(payload.untestedRoutes, new Set(byKey.keys()), rateCard, columns.length);
  const all = [...tested, ...(showUntested ? untested : [])].sort(compareRows)
    .map(({ cards: _cards, ...row }): MatrixRow => row);
  return { columns, rows: all, unkeyed: coverage(rows).unkeyed, untestedAvailable: untested.length };
}

function untestedRows(
  routes: readonly UntestedRoute[],
  testedKeys: ReadonlySet<string>,
  rateCard: readonly RateCardRow[],
  columns: number,
): SortableRow[] {
  return routes.flatMap((route) => {
    const key = routeKey(route);
    if (key === null || testedKeys.has(key)) return [];
    const card = rateCard.find((row) => row.model === canonicalModel(route)) ?? null;
    return [{
      key,
      route,
      tested: false,
      title: route.label,
      detail: `untested · ${route.prior}`,
      provider: providerOf(route.provider) ?? card?.provider ?? null,
      tiles: Array.from({ length: columns }, () => null),
      cards: card === null ? [] : [card],
    }];
  });
}

/** A tile's accessible name: what it shows, and what a click does. */
export function tileLabel(row: Pick<MatrixRow, "title">, tile: MatrixTile): string {
  const yieldText = tile.firstPass === null ? "nothing settled" : `first-pass yield ${Math.round(tile.firstPass * 100)}% of ${tile.settled} settled`;
  return `${tile.role} on ${row.title}: ${yieldText}, ${tile.n} role-rows, ${tile.landed} landed, ${tile.perRow}, ` +
    `${tile.blockedHere} blocked here with a model attribution. Opens the Ledger grouped by run.`;
}

// ---------------------------------------------------------------------------
// The depth legend.
// ---------------------------------------------------------------------------

/**
 * How many settled rows reach `raised` at the widest interval (a 50% yield):
 * the "≈N" the legend quotes, derived from the module's own `wilson` and
 * `depth` so it moves if the threshold does.
 */
export function rowsForRaised(): number {
  for (let n = 1; n < 10_000; n += 1) if (depth(wilson(Math.floor(n / 2), n), n) === "raised") return n;
  return Number.POSITIVE_INFINITY;
}

export interface LegendEntry {
  readonly depth: Depth;
  readonly text: string;
}

export function depthLegend(): LegendEntry[] {
  return [
    { depth: "raised", text: `raised · 95% CI within ±${Math.round(RAISED_HALF_WIDTH * 100)} pts (≈${rowsForRaised()} settled rows)` },
    { depth: "flat", text: "flat · evidence present, CI wider" },
    { depth: "sunk", text: "sunk · nothing settled" },
  ];
}
