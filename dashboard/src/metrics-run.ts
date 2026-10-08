import type { MetricsAttribution, MetricsResponse, MetricsRoleRow, MetricsRun, MetricsRunPhase, PhaseStatus, RateCardRow } from "../shared/types.ts";
import { TOOL_CLASSES, type RowPrice } from "../shared/route-metrics.ts";
import { formatListEquivalent, priceRow } from "../shared/rate-card.ts";
import { formatTokens, shortSessionId } from "./display.ts";
import { ROLE_ORDER, runsInLens, type MetricsRouteState, type Provider } from "./metrics-lens.ts";
import { TOOL_LETTER } from "./metrics-ledger.ts";
import { routeProvider, routeTitle } from "./metrics-matrix.ts";

/**
 * The Run view: one run's facts, its phase strip, its per-role table, and for
 * a BLOCKED run the attribution panel that composes the owner's
 * `awsf attribute` command. The tab writes nothing (Q6, O3): the command is
 * text the owner copies into a terminal, where the CLI asks for a y/N.
 */

// ---------------------------------------------------------------------------
// The picker.
// ---------------------------------------------------------------------------

export interface RunPicker {
  /** The picker's options: the runs in the lens, newest first, and the shown run first when the lens leaves it out. */
  readonly runs: readonly MetricsRun[];
  /** The run shown: the route's, else the newest in the lens; `null` with neither. */
  readonly selected: MetricsRun | null;
  /** The route names a run the projection does not hold. */
  readonly missing: string | null;
}

export function runPicker(payload: Pick<MetricsResponse, "runs" | "roleRows">, state: MetricsRouteState): RunPicker {
  const inLens = runsInLens(payload, state);
  if (state.run === null) return { runs: inLens, selected: inLens[0] ?? null, missing: null };
  const selected = payload.runs.find((run) => run.sessionId === state.run) ?? null;
  if (selected === null) return { runs: inLens, selected: null, missing: state.run };
  return { runs: inLens.includes(selected) ? inLens : [selected, ...inLens], selected, missing: null };
}

export function runOptionLabel(run: MetricsRun): string {
  return `${run.taskId} · ${shortSessionId(run.sessionId)} · ${run.stateGroup === "OPEN" ? "in flight" : run.stateGroup.toLowerCase().replace("_", " ")}`;
}

// ---------------------------------------------------------------------------
// The fact grid.
// ---------------------------------------------------------------------------

export interface RunFact {
  readonly label: string;
  readonly value: string;
  /** The terminal state reads as the sessions board's chip. */
  readonly chip?: true;
}

function minutesBetween(start: string, end: string | null): number | null {
  if (end === null) return null;
  const span = Date.parse(end) - Date.parse(start);
  return Number.isFinite(span) ? span / 60_000 : null;
}

/** The run's list-price equivalent: the sum over its priced role-rows, `null` when none is priced. */
export function runListTotal(rows: readonly MetricsRoleRow[], price: RowPrice): number | null {
  const priced = rows.map(price).filter((usd): usd is number => usd !== null);
  return priced.length === 0 ? null : priced.reduce((sum, usd) => sum + usd, 0);
}

export function runFacts(run: MetricsRun, rows: readonly MetricsRoleRow[], price: RowPrice): RunFact[] {
  const wall = minutesBetween(run.startedAt, run.endedAt);
  // Every role-row of a run carries the run's rework count; a run with none has no row to read it from.
  const rework = rows[0]?.reworkPhases;
  return [
    { label: "Task", value: `${run.taskId} · attempt ${run.attempt}` },
    { label: "Project", value: run.project },
    { label: "Workflow · tier", value: `${run.workflow} · T${run.tier}` },
    { label: "Terminal state", value: run.lifecycleState, chip: true },
    { label: "Review verdict", value: run.reviewVerdict ?? "none" },
    { label: "Wall time", value: wall === null ? "open" : `${Math.round(wall)} min` },
    { label: "Owner rework", value: `${rework ?? "–"} phases · ${run.ownerReentries} re-entries` },
    { label: "List equivalent", value: formatListEquivalent(runListTotal(rows, price)) },
  ];
}

// ---------------------------------------------------------------------------
// The phase strip.
// ---------------------------------------------------------------------------

/** A phase narrower than this many minutes is drawn this wide, so a quick phase stays visible. */
export const MIN_PHASE_WIDTH = 0.3;
/** A host phase shorter than this is left off the strip; an agent phase always shows. */
export const MIN_HOST_MINUTES = 0.05;

export type PhaseTone = "succeeded" | "failed" | "running" | "cancelled";

export const PHASE_TONE: Readonly<Record<PhaseTone, string>> = {
  succeeded: "var(--green)",
  failed: "var(--red)",
  running: "var(--blue)",
  cancelled: "var(--faint)",
};

export const PHASE_LEGEND: readonly { readonly tone: PhaseTone; readonly label: string }[] = Object.freeze([
  { tone: "succeeded", label: "succeeded" },
  { tone: "failed", label: "failed" },
  { tone: "running", label: "running or queued" },
  { tone: "cancelled", label: "cancelled or skipped" },
]);

export function phaseTone(status: PhaseStatus): PhaseTone {
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED" || status === "SKIPPED") return "cancelled";
  return "running";
}

export interface PhaseSegment {
  readonly phaseId: string;
  readonly label: string;
  readonly tone: PhaseTone;
  /** The segment's flex weight: its minutes, at least `MIN_PHASE_WIDTH`. */
  readonly weight: number;
  /** Its share of the strip, 0 to 1. */
  readonly share: number;
  readonly title: string;
}

export interface PhaseStrip {
  readonly segments: readonly PhaseSegment[];
  /** Recorded minutes across the drawn phases; the floor widens a segment, never this. */
  readonly minutes: number;
}

export function phaseStrip(phases: readonly MetricsRunPhase[]): PhaseStrip {
  const drawn = [...phases]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((phase) => phase.kind === "agent" || (phase.minutes ?? 0) > MIN_HOST_MINUTES);
  const weights = drawn.map((phase) => Math.max(phase.minutes ?? 0, MIN_PHASE_WIDTH));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    segments: drawn.map((phase, index) => ({
      phaseId: phase.phaseId,
      label: phase.key,
      tone: phaseTone(phase.status),
      weight: weights[index]!,
      share: total === 0 ? 0 : weights[index]! / total,
      title: [
        phase.key,
        phase.owner,
        phase.status.toLowerCase(),
        phase.minutes === null ? "minutes not recorded" : `${phase.minutes.toFixed(1)} min`,
        ...(phase.correctionCount > 0 ? [`${phase.correctionCount} corrections`] : []),
        ...(phase.errorCode === null ? [] : [phase.errorCode]),
      ].join(" · "),
    })),
    minutes: drawn.reduce((sum, phase) => sum + (phase.minutes ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// The per-role table.
// ---------------------------------------------------------------------------

export type FirstPassMark = "open" | "yes" | "blocked here" | "no";

export const TOKEN_KINDS = ["input", "cache read", "cache write", "output"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface KindShare {
  readonly kind: TokenKind;
  readonly usd: number;
  /** Of the row's list-price equivalent, 0 to 1. */
  readonly share: number;
}

/**
 * The row's list-price equivalent split by token kind, at the card's rates.
 * Reasoning joins output only when a usage event called it additive, as
 * `listEquivalentUsd` counts it. `null` when the row is unpriced.
 */
export function listByKind(row: Pick<MetricsRoleRow, "route" | "resolvedModel" | "tokens">): KindShare[] | null {
  const pricing = priceRow(row);
  if (!pricing.priced) return null;
  const { rate } = pricing;
  const t = row.tokens;
  const reasoning = t.reasoningRelation === "additive" ? t.reasoningTokens ?? 0 : 0;
  const usd: Record<TokenKind, number> = {
    input: ((t.inputTokens ?? 0) * rate.input) / 1_000_000,
    "cache read": ((t.cacheReadTokens ?? 0) * rate.cacheRead) / 1_000_000,
    "cache write": ((t.cacheWriteTokens ?? 0) * rate.cacheWrite) / 1_000_000,
    output: (((t.outputTokens ?? 0) + reasoning) * rate.output) / 1_000_000,
  };
  const total = TOKEN_KINDS.reduce((sum, kind) => sum + usd[kind], 0);
  return TOKEN_KINDS.map((kind) => ({ kind, usd: usd[kind], share: total === 0 ? 0 : usd[kind] / total }));
}

export interface RoleLine {
  readonly role: string;
  readonly taskClass: string;
  readonly dot: string;
  readonly provenance: string;
  readonly route: string;
  readonly provider: Provider | null;
  readonly turns: number;
  readonly minutes: string;
  /** "R37 S14 E4 X25 O0": counts, not shares. */
  readonly toolMix: string;
  readonly gates: string;
  readonly firstPass: FirstPassMark;
  readonly tokens: string;
  readonly list: string;
  readonly byKind: readonly KindShare[] | null;
}

export interface RoleContext {
  readonly rateCard: readonly RateCardRow[];
  readonly priorLabels: Readonly<Record<string, string>>;
  readonly roleColors: Readonly<Record<string, string>>;
  /** Every role-row the payload holds, so a route's glyph can borrow its adapter's provider (T04 C2). */
  readonly allRows: readonly MetricsRoleRow[];
}

export function firstPassMark(row: Pick<MetricsRoleRow, "settled" | "firstPass" | "blockedHere">): FirstPassMark {
  if (!row.settled) return "open";
  if (row.firstPass) return "yes";
  return row.blockedHere ? "blocked here" : "no";
}

function roleRank(role: string): number {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role);
  return index < 0 ? ROLE_ORDER.length : index;
}

export function roleLines(rows: readonly MetricsRoleRow[], price: RowPrice, context: RoleContext): RoleLine[] {
  return [...rows]
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0))
    .map((row) => {
      const named = routeTitle(row.route, [row], context.rateCard, context.priorLabels);
      return {
        role: row.role,
        taskClass: row.taskClass ?? "unclassified",
        dot: context.roleColors[row.role] ?? "var(--faint)",
        provenance: row.identityProvenance ?? "no identity",
        route: row.routeMixed ? "more than one route" : named.title,
        provider: routeProvider(row.route, named.card, context.allRows, context.rateCard),
        turns: row.turns,
        minutes: row.minutes === null ? "–" : row.minutes.toFixed(1),
        toolMix: TOOL_CLASSES.map((name) => `${TOOL_LETTER[name]}${row.tools[name]}`).join(" "),
        gates: row.gates.total === 0 ? "–" : `${row.gates.pass}/${row.gates.total}`,
        firstPass: firstPassMark(row),
        tokens: `${formatTokens(row.tokens.cacheReadTokens)} · ${formatTokens(row.tokens.outputTokens)}`,
        list: formatListEquivalent(price(row)),
        byKind: listByKind(row),
      };
    });
}

// ---------------------------------------------------------------------------
// The attribution panel (D4, Q6).
// ---------------------------------------------------------------------------

/** `ATTRIBUTION_CAUSES` in `core/src/contracts/attribution-record.ts`, which the dashboard cannot import. */
export const ATTRIBUTION_CAUSES = ["model", "factory", "environment", "driver", "owner", "unknown"] as const satisfies readonly MetricsAttribution[];

export const ATTRIBUTION_LABELS: Readonly<Record<MetricsAttribution, string>> = {
  model: "model",
  factory: "factory",
  environment: "environment",
  driver: "driver (pre-call check)",
  owner: "owner",
  unknown: "unknown",
};

export const ATTRIBUTION_NOTE = "Run this in a terminal at the AWSF checkout. The dashboard records nothing itself.";

export interface BlockedAt {
  /** The failed phase's owner (a role or a host phase), or `null` when no phase failed. */
  readonly owner: string | null;
  readonly phase: string | null;
  readonly errorCode: string | null;
}

/** Where the run blocked: its last failed phase in ordinal order. */
export function blockedAt(run: Pick<MetricsRun, "phases">): BlockedAt {
  const failed = [...run.phases].sort((a, b) => a.ordinal - b.ordinal).filter((phase) => phase.status === "FAILED").at(-1);
  return failed === undefined
    ? { owner: null, phase: null, errorCode: null }
    : { owner: failed.owner, phase: failed.key, errorCode: failed.errorCode };
}

/**
 * "documenter" when an agent phase blocked; "t01-tests (host)" when a host
 * phase did, since the heuristic then judges the agent phase before it.
 */
export function blockedLabel(blocked: BlockedAt): string {
  if (blocked.phase === null) return "no failed phase";
  return blocked.owner === null || blocked.owner === blocked.phase ? blocked.phase : `${blocked.phase} (${blocked.owner})`;
}

/**
 * The reason as one shell word. Double quotes as the ticket spells it, unless
 * the text holds a character a POSIX shell expands inside them (`"`, `\`, `$`,
 * a backtick, or `!` in an interactive shell); then single quotes, which expand
 * nothing, with each `'` closed, escaped and reopened. Line breaks collapse to
 * spaces: a reason is one line.
 */
export function quoteReason(reason: string): string {
  const line = reason.replace(/\s+/g, " ").trim();
  if (!/["\\$`!]/.test(line)) return `"${line}"`;
  return `'${line.replace(/'/g, `'\\''`)}'`;
}

export const REASON_PLACEHOLDER = "<why>";
export const CAUSE_PLACEHOLDER = "<cause>";

/**
 * How a pasted command reaches the CLI. `awsf` is the package's bin, not a
 * command on the owner's PATH, so the command runs through the root script.
 * The `--` is required: without it npm takes `--project`, `--attempt`,
 * `--cause` and `--reason` as its own options and passes only their values.
 */
export const AWSF_INVOCATION = "npm run awsf --";

/**
 * `npm run awsf -- attribute <task> --project <slug> --attempt <n> --cause <c> --reason "<why>"`.
 * `--project` is always written: the state root is global, and without it the
 * CLI reads the project from the terminal's `awsf.config.yaml`, which names
 * another project's attempt whenever the run is not that project's.
 */
export function attributeCommand(
  run: Pick<MetricsRun, "taskId" | "project" | "attempt">,
  cause: MetricsAttribution | null,
  reason: string,
): string {
  const why = reason.trim().length === 0 ? `"${REASON_PLACEHOLDER}"` : quoteReason(reason);
  return `${AWSF_INVOCATION} attribute ${run.taskId} --project ${run.project} --attempt ${run.attempt} --cause ${cause ?? CAUSE_PLACEHOLDER} --reason ${why}`;
}

/** The command is ready to paste once a cause is picked and a reason written. */
export function commandReady(cause: MetricsAttribution | null, reason: string): boolean {
  return cause !== null && reason.trim().length > 0;
}

/** Mirrored attribution/v2 link; no trap field on a v1 owner record means pre-link. */
export type AttributionTrapLink = { readonly kind: "trap"; readonly id: string }
  | { readonly kind: "none"; readonly because: "fixed" | "after-spend" | "owner" | "unexplained" | "not-a-stop"; readonly reason: string };
export type LinkedMetricsRun = Omit<MetricsRun, "ownerAttribution"> & {
  readonly ownerAttribution: (NonNullable<MetricsRun["ownerAttribution"]> & { readonly trap?: AttributionTrapLink }) | null;
};

export interface AttributionPanel {
  readonly blocked: BlockedAt;
  readonly heuristic: MetricsAttribution | null;
  /** The owner's latest record, shown with its reason and date. */
  readonly override: { readonly cause: MetricsAttribution; readonly reason: string; readonly date: string; readonly trap?: AttributionTrapLink } | null;
  readonly inForce: MetricsAttribution | null;
  readonly source: "owner" | "heuristic" | null;
}

/** `null` unless the run is BLOCKED: only a blocked attempt can be attributed (`AttributeAttemptNotBlocked`). */
export function attributionPanel(run: LinkedMetricsRun): AttributionPanel | null {
  if (run.stateGroup !== "BLOCKED") return null;
  return {
    blocked: blockedAt(run),
    heuristic: run.heuristicAttribution,
    override: run.ownerAttribution === null ? null : { ...run.ownerAttribution, date: run.ownerAttribution.at.slice(0, 10) },
    inForce: run.attribution,
    source: run.attributionSource,
  };
}
