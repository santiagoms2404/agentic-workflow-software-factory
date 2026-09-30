/**
 * Geometry for the metrics tab's hand-drawn SVG: scales, ticks, the tile ring
 * and label placement. Pure, with no statistic of its own: every value it
 * places was computed by the shared route-metrics module (W18 DD3). No chart
 * library (invariant 7).
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Scale = (value: number) => number;

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain, [r0, r1] = range;
  const span = d1 - d0;
  return (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** Values at or below zero have no logarithm; they are pinned to the domain's lower end. */
export function logScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1]);
  const inner = linearScale([l0, l1], range);
  return (value) => inner(value > 0 ? Math.max(l0, Math.min(l1, Math.log10(value))) : l0);
}

const STEPS = [1, 2, 5] as const;

/** Rounded to 12 significant digits, so 2 × 10⁻¹ reads 0.2 and not 0.20000000000000004. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

function stepValue(exponent: number, step: number): number {
  return clean(step * 10 ** exponent);
}

/** The 1-2-5 value at or below `value`. */
function stepBelow(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const candidates = [...STEPS].reverse().map((step) => stepValue(exponent, step));
  return candidates.find((candidate) => candidate <= value * (1 + 1e-9)) ?? stepValue(exponent - 1, 5);
}

/** The 1-2-5 value at or above `value`. */
function stepAbove(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const candidates = STEPS.map((step) => stepValue(exponent, step));
  return candidates.find((candidate) => candidate >= value * (1 - 1e-9)) ?? stepValue(exponent + 1, 1);
}

/**
 * A log axis's domain for these values: padded by `pad` either side so no
 * mark sits on a frame edge, then widened to the nearest 1-2-5 values so both
 * ends carry a tick. Non-positive values are ignored; with none left the
 * domain is one decade.
 */
export function logDomain(values: readonly number[], pad = 1.6): [number, number] {
  const positive = values.filter((value) => value > 0 && Number.isFinite(value));
  if (positive.length === 0) return [0.1, 1];
  const lo = stepBelow(Math.min(...positive) / pad);
  const hi = stepAbove(Math.max(...positive) * pad);
  return lo === hi ? [lo, stepAbove(hi * 1.01)] : [lo, hi];
}

/** Every 1-2-5 value inside the domain, ascending. */
export function logTicks(domain: readonly [number, number]): number[] {
  const [lo, hi] = domain;
  if (!(lo > 0) || !(hi >= lo)) return [];
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(lo)); exponent <= Math.ceil(Math.log10(hi)); exponent += 1) {
    for (const step of STEPS) {
      const value = stepValue(exponent, step);
      if (value >= lo * (1 - 1e-9) && value <= hi * (1 + 1e-9)) ticks.push(value);
    }
  }
  return ticks;
}

/** The percentage axis: 0 to 100 in quarters. */
export const PERCENT_TICKS: readonly number[] = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

/** A tick's text with no unit: the axis title carries it ("≈ list $ per role-row", "minutes"). */
export function formatTick(value: number): string {
  if (value >= 1000) return `${clean(value / 1000)}k`;
  return String(clean(value));
}

export function formatPercentTick(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Drops ticks that would print closer than `minGap` px to the one kept before
 * them, so a narrow axis thins its labels instead of overprinting them. The
 * first and last ticks are preferred.
 */
export function thinTicks(ticks: readonly number[], scale: Scale, minGap: number): number[] {
  if (ticks.length <= 2) return [...ticks];
  const kept: number[] = [ticks[0]!];
  for (const tick of ticks.slice(1, -1)) {
    if (Math.abs(scale(tick) - scale(kept[kept.length - 1]!)) >= minGap) kept.push(tick);
  }
  const last = ticks[ticks.length - 1]!;
  while (kept.length > 1 && Math.abs(scale(last) - scale(kept[kept.length - 1]!)) < minGap) kept.pop();
  kept.push(last);
  return kept;
}

// ---------------------------------------------------------------------------
// The tile ring.
// ---------------------------------------------------------------------------

export interface Ring {
  readonly circumference: number;
  /** The drawn arc's length; 0 draws only the round cap, a dot at twelve o'clock. */
  readonly arc: number;
  /** For `stroke-dasharray`. */
  readonly dasharray: string;
  /** The ring's centre text: a whole percentage without its sign, or "–" with nothing settled. */
  readonly text: string;
}

export function ring(p: number | null, radius: number): Ring {
  const circumference = 2 * Math.PI * radius;
  const share = p === null ? 0 : Math.max(0, Math.min(1, p));
  const arc = circumference * share;
  return {
    circumference,
    arc,
    dasharray: `${arc.toFixed(2)} ${circumference.toFixed(2)}`,
    text: p === null ? "–" : String(Math.round(share * 100)),
  };
}

// ---------------------------------------------------------------------------
// Label placement.
// ---------------------------------------------------------------------------

export interface LabelRequest {
  readonly id: string;
  /** The mark the label names, in plot coordinates. */
  readonly x: number;
  readonly y: number;
  /** The longest line, used to measure width. */
  readonly text: string;
  /** Number of lines; one unless specified. */
  readonly lines?: number;
  /** Higher places first and so wins a contested spot. */
  readonly priority: number;
}

export interface PlacedLabel {
  readonly id: string;
  /** The text's anchor point: `x` is its start or end, `y` its baseline. */
  readonly x: number;
  readonly y: number;
  readonly anchor: "start" | "end";
  readonly box: Rect;
}

export interface LabelOptions {
  /** Width of one character; the labels are monospace. */
  readonly charWidth: number;
  /** Line box height. */
  readonly lineHeight: number;
  /** Space between a mark's centre and its label; wider than the mark, so a label never covers its own. */
  readonly gap: number;
  /** Areas no label may cover, such as the marks themselves. */
  readonly avoid?: readonly Rect[];
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(box: Rect, bounds: Rect): boolean {
  return box.x >= bounds.x && box.y >= bounds.y &&
    box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height;
}

/**
 * Places each label beside its mark without overlapping another label, a
 * mark, or the bounds' edge. Candidates are tried right, left, then above and
 * below on either side; a label with no free spot is left out (`null`), and
 * the mark's tooltip still names it. Result order follows the requests.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  bounds: Rect,
  options: LabelOptions,
): (PlacedLabel | null)[] {
  const { charWidth, lineHeight, gap } = options;
  const taken: Rect[] = [...(options.avoid ?? [])];
  const placed = new Map<string, PlacedLabel | null>();
  const order = [...requests].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const request of order) {
    const width = request.text.length * charWidth;
    const height = lineHeight * (request.lines ?? 1);
    const ascent = lineHeight * 0.72;
    const shifts = [0, -height, height, -height * 2, height * 2, -height * 3, height * 3];
    const candidates: PlacedLabel[] = [];
    for (const shift of shifts) {
      for (const anchor of ["start", "end"] as const) {
        const x = anchor === "start" ? request.x + gap : request.x - gap;
        const y = request.y + lineHeight * 0.34 + shift;
        const box = { x: anchor === "start" ? x : x - width, y: y - ascent, width, height };
        candidates.push({ id: request.id, x, y, anchor, box });
      }
    }
    const free = candidates.find((candidate) => inside(candidate.box, bounds) &&
      !taken.some((rect) => intersects(rect, candidate.box)));
    placed.set(request.id, free ?? null);
    if (free !== undefined) taken.push(free.box);
  }
  return requests.map((request) => placed.get(request.id) ?? null);
}
