// The route-arm scorer (W18 DD7, task 11): `prompt-benchmark.ts` generalized
// from two prompt arms to two or more route arms, and left untouched there.
//
// A pair is one frozen item at one repetition, replayed once on every arm, in
// an order drawn for that repetition. Paired evidence is the point: an arm is
// only compared with the others on work they all did, so a pair with any
// invalid replay contributes to no arm's score. Every reason a pair is invalid
// is named, and the arm it belongs to is named with it.
//
// Scores are keyed by role and task class, never pooled across them (INV-4),
// and the module reads findings and gate results only: counts, never thoughts
// (INV-5). Pure: no I/O and no clock.

import { ROUTE_EFFORT_LEVELS } from "../config/schema.ts";
import type { ProvingGroundItem, SeededDefectRange } from "../contracts/proving-ground.ts";
import type { ReviewFinding } from "../contracts/review-output.ts";
import type { RouteEffort } from "../contracts/route-selection.ts";
import { wilson, type Interval } from "../../../dashboard/shared/route-metrics.ts";

/** A finding locates a planted defect when its line lies this many lines either side of the expected range, or inside it. */
export const LINE_WINDOW = 3;

// ---------------------------------------------------------------------------
// Arms.
// ---------------------------------------------------------------------------

/** One route arm: an explicit `<adapter>/<provider>/<model>@<effort>`, every part named. */
export interface RouteArm {
  readonly spec: string;
  readonly adapter: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: RouteEffort;
}

export class RouteArmSpecInvalid extends Error {
  readonly spec: string;

  constructor(spec: string, detail: string) {
    super(`route arm ${JSON.stringify(spec)} is invalid: ${detail}`);
    this.name = "RouteArmSpecInvalid";
    this.spec = spec;
  }
}

/**
 * Parses an arm. Unlike a `--route` override, an arm leaves nothing to the
 * configured default: the replay measures the route the arm names, so a part
 * left for config to fill would measure whatever config held that day.
 */
export function parseRouteArm(spec: string): RouteArm {
  const at = spec.lastIndexOf("@");
  if (at < 0) throw new RouteArmSpecInvalid(spec, "expected <adapter>/<provider>/<model>@<effort>");
  const segments = spec.slice(0, at).split("/");
  const effort = spec.slice(at + 1);
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new RouteArmSpecInvalid(spec, "an arm names its adapter, provider and model, each non-empty");
  }
  if (!(ROUTE_EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new RouteArmSpecInvalid(spec, `no effort level named ${JSON.stringify(effort)}; expected one of ${ROUTE_EFFORT_LEVELS.join(", ")}`);
  }
  const [adapter, provider, model] = segments as [string, string, string];
  return Object.freeze({ spec, adapter, provider, model, effort: effort as RouteEffort });
}

/** A model without the adapter's `family:` prefix: `claude:opus` and `opus` name one model on the claude adapter. */
function canonicalModel(adapter: string, model: string): string {
  return model.startsWith(`${adapter}:`) ? model.slice(adapter.length + 1) : model;
}

/** One key per route, so two spellings of the same arm are one arm. */
export function armKey(arm: RouteArm): string {
  return `${arm.adapter}/${arm.provider}/${canonicalModel(arm.adapter, arm.model)}@${arm.effort}`;
}

// ---------------------------------------------------------------------------
// Replays and invalidation.
// ---------------------------------------------------------------------------

export interface ReviewReplayOutcome {
  readonly kind: "review";
  readonly findings: readonly Pick<ReviewFinding, "file" | "line">[];
}

export interface BuildReplayOutcome {
  readonly kind: "build";
  /** Each gate's round-0 result, keyed by configured gate id. */
  readonly firstRoundGates: Readonly<Record<string, boolean>>;
}

/** What one replay of one item on one arm left behind. */
export interface RouteArmReplay {
  readonly itemId: string;
  /** The arm's spec, as the replay recorded it. */
  readonly arm: string;
  readonly repetition: number;
  /** This replay's place, from 1, in its repetition's randomized order. */
  readonly order: number;
  /** The route the provider was observed answering on; `null` when none was observed. */
  readonly observed: { readonly provider: string | null; readonly model: string | null };
  readonly usageAuthority: "provider" | "partial" | "none";
  /** False when the envelope was still invalid after its corrections. */
  readonly envelopeValid: boolean;
  /** True when the replay paused at its call ceiling. */
  readonly pausedAtCeiling: boolean;
  /** `null` when the replay produced nothing to score. */
  readonly outcome: ReviewReplayOutcome | BuildReplayOutcome | null;
}

export const ROUTE_ARM_INVALIDATIONS = [
  "provider-mismatch",
  "model-mismatch",
  "usage-authority-none",
  "envelope-invalid",
  "paused-at-ceiling",
  "outcome-missing",
  "replay-missing",
  "replay-duplicated",
  "order-invalid",
] as const;
export type RouteArmInvalidation = (typeof ROUTE_ARM_INVALIDATIONS)[number];

export interface RouteArmInvalidReason {
  readonly reason: RouteArmInvalidation;
  /** The arm's spec, or `null` for a reason that belongs to the pair rather than one arm. */
  readonly arm: string | null;
  readonly detail: string;
}

function invalid(reason: RouteArmInvalidation, arm: string | null, detail: string): RouteArmInvalidReason {
  return Object.freeze({ reason, arm, detail });
}

/** Why one replay cannot count; empty when it can. */
export function replayInvalidations(replay: RouteArmReplay, arm: RouteArm, item: ProvingGroundItem): RouteArmInvalidReason[] {
  const reasons: RouteArmInvalidReason[] = [];
  const { provider, model } = replay.observed;
  if (provider !== arm.provider) {
    reasons.push(invalid("provider-mismatch", arm.spec, `observed provider ${provider ?? "none"}, arm names ${arm.provider}`));
  }
  if (model === null || canonicalModel(arm.adapter, model) !== canonicalModel(arm.adapter, arm.model)) {
    reasons.push(invalid("model-mismatch", arm.spec, `observed model ${model ?? "none"}, arm names ${arm.model}`));
  }
  if (replay.usageAuthority === "none") {
    reasons.push(invalid("usage-authority-none", arm.spec, "no usage was reported with any authority"));
  }
  if (!replay.envelopeValid) reasons.push(invalid("envelope-invalid", arm.spec, "the envelope stayed invalid"));
  if (replay.pausedAtCeiling) reasons.push(invalid("paused-at-ceiling", arm.spec, "the replay paused at its call ceiling"));
  if (replay.envelopeValid && !replay.pausedAtCeiling) {
    const outcome = replay.outcome;
    if (outcome === null || outcome.kind !== item.kind) {
      reasons.push(invalid("outcome-missing", arm.spec, `no ${item.kind} outcome was recorded`));
    } else if (outcome.kind === "build" && item.kind === "build") {
      const missing = item.gates.filter((gate) => !Object.hasOwn(outcome.firstRoundGates, gate));
      if (missing.length > 0) {
        reasons.push(invalid("outcome-missing", arm.spec, `no round-0 result for gate(s) ${missing.join(", ")}`));
      }
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Matching a review against its planted defect.
// ---------------------------------------------------------------------------

export interface ReviewReplayScore {
  /** A finding named the defect's file and a line within the window. */
  readonly located: boolean;
  /** Not located, but a whole-file finding (`line: null`) named the defect's file. Reported apart from recall. */
  readonly fileOnly: boolean;
  /** Findings that neither locate the defect nor name its file as a whole. */
  readonly falseAlarms: number;
}

function withinWindow(line: number, range: SeededDefectRange): boolean {
  return line >= range.lineStart - LINE_WINDOW && line <= range.lineEnd + LINE_WINDOW;
}

/** Scores one review's findings against the item's expected ranges. */
export function scoreReviewFindings(
  findings: readonly Pick<ReviewFinding, "file" | "line">[],
  expected: readonly SeededDefectRange[],
): ReviewReplayScore {
  const locates = (finding: Pick<ReviewFinding, "file" | "line">): boolean =>
    finding.line !== null && expected.some((range) => range.file === finding.file && withinWindow(finding.line as number, range));
  const namesFile = (finding: Pick<ReviewFinding, "file" | "line">): boolean =>
    finding.line === null && expected.some((range) => range.file === finding.file);
  const located = findings.some(locates);
  return Object.freeze({
    located,
    fileOnly: !located && findings.some(namesFile),
    falseAlarms: findings.filter((finding) => !locates(finding) && !namesFile(finding)).length,
  });
}

/** A build replay passes first time when every one of the item's gates passed on round 0. */
export function buildFirstPass(outcome: BuildReplayOutcome, gates: readonly string[]): boolean {
  return gates.every((gate) => outcome.firstRoundGates[gate] === true);
}

// ---------------------------------------------------------------------------
// The suite.
// ---------------------------------------------------------------------------

export interface RouteArmProtocol {
  /** Two or more arm specs. */
  readonly arms: readonly string[];
  readonly repetitions: number;
  readonly items: readonly ProvingGroundItem[];
}

export interface RouteArmPair {
  readonly itemId: string;
  readonly repetition: number;
  /** Arm specs in the order they ran; `null` when the recorded order is not a permutation. */
  readonly order: readonly string[] | null;
  readonly valid: boolean;
  readonly reasons: readonly RouteArmInvalidReason[];
  /** Per arm spec, the replay's score. Present only for a valid pair. */
  readonly reviews: Readonly<Record<string, ReviewReplayScore>> | null;
  readonly builds: Readonly<Record<string, boolean>> | null;
}

export interface RouteArmScore {
  readonly arm: string;
  readonly review: {
    /** Valid review replays scored. */
    readonly replays: number;
    readonly located: number;
    readonly recall: Interval;
    readonly fileOnly: number;
    readonly falseAlarms: number;
  };
  readonly build: {
    readonly replays: number;
    readonly firstPass: number;
    readonly interval: Interval;
  };
  /** Invalid pairs whose reasons name this arm. */
  readonly invalidPairs: number;
}

export interface RouteArmItemScore {
  readonly itemId: string;
  readonly kind: ProvingGroundItem["kind"];
  readonly role: string;
  readonly taskClass: string;
  readonly arms: readonly RouteArmScore[];
}

/** One comparison scope: a role within a task class. Arms are never compared across scopes. */
export interface RouteArmScopeScore {
  readonly role: string;
  readonly taskClass: string;
  readonly items: readonly string[];
  readonly invalidPairs: number;
  readonly arms: readonly RouteArmScore[];
}

export interface RouteArmSuiteScore {
  /** Every expected pair is present and valid, and no replay fell outside the protocol. */
  readonly complete: boolean;
  readonly arms: readonly RouteArm[];
  readonly pairs: readonly RouteArmPair[];
  /** Replays naming an item, arm or repetition the protocol does not hold. */
  readonly stray: readonly Pick<RouteArmReplay, "itemId" | "arm" | "repetition">[];
  readonly byItem: readonly RouteArmItemScore[];
  readonly byScope: readonly RouteArmScopeScore[];
}

function assertProtocol(protocol: RouteArmProtocol): RouteArm[] {
  if (!Number.isInteger(protocol.repetitions) || protocol.repetitions < 1) {
    throw new RangeError("route-arm repetitions must be a positive integer");
  }
  const arms = protocol.arms.map(parseRouteArm);
  if (arms.length < 2) throw new RangeError("a route-arm comparison needs two or more arms");
  const keys = new Set(arms.map(armKey));
  if (keys.size !== arms.length) throw new RangeError("route arms must name distinct routes");
  const ids = new Set(protocol.items.map((item) => item.id));
  if (ids.size !== protocol.items.length) throw new RangeError("proving-ground item ids must be distinct");
  return arms;
}

function pairKey(itemId: string, repetition: number): string {
  return `${itemId}\u0000${String(repetition)}`;
}

function scorePair(
  item: ProvingGroundItem,
  repetition: number,
  arms: readonly RouteArm[],
  replays: readonly (RouteArmReplay & { readonly key: string })[],
): RouteArmPair {
  const reasons: RouteArmInvalidReason[] = [];
  const byArm = new Map<string, RouteArmReplay>();
  for (const arm of arms) {
    const own = replays.filter((replay) => replay.key === armKey(arm));
    if (own.length === 0) reasons.push(invalid("replay-missing", arm.spec, "no replay on this arm"));
    else if (own.length > 1) reasons.push(invalid("replay-duplicated", arm.spec, `${String(own.length)} replays on this arm`));
    else byArm.set(arm.spec, own[0]!);
  }

  let order: string[] | null = null;
  if (byArm.size === arms.length) {
    const ranked = arms.map((arm) => ({ spec: arm.spec, place: byArm.get(arm.spec)!.order }))
      .sort((left, right) => left.place - right.place);
    if (ranked.every((entry, index) => entry.place === index + 1)) order = ranked.map((entry) => entry.spec);
    else reasons.push(invalid("order-invalid", null, `recorded order ${ranked.map((entry) => String(entry.place)).join(",")} is not 1..${String(arms.length)}`));
  }
  for (const arm of arms) {
    const replay = byArm.get(arm.spec);
    if (replay !== undefined) reasons.push(...replayInvalidations(replay, arm, item));
  }

  const valid = reasons.length === 0;
  let reviews: Record<string, ReviewReplayScore> | null = null;
  let builds: Record<string, boolean> | null = null;
  if (valid) {
    for (const arm of arms) {
      const outcome = byArm.get(arm.spec)!.outcome!;
      if (item.kind === "review" && outcome.kind === "review") {
        (reviews ??= {})[arm.spec] = scoreReviewFindings(outcome.findings, item.seed.expected);
      } else if (item.kind === "build" && outcome.kind === "build") {
        (builds ??= {})[arm.spec] = buildFirstPass(outcome, item.gates);
      }
    }
  }
  return Object.freeze({
    itemId: item.id,
    repetition,
    order: order === null ? null : Object.freeze(order),
    valid,
    reasons: Object.freeze(reasons),
    reviews: reviews === null ? null : Object.freeze(reviews),
    builds: builds === null ? null : Object.freeze(builds),
  });
}

function armScores(arms: readonly RouteArm[], pairs: readonly RouteArmPair[]): RouteArmScore[] {
  return arms.map((arm) => {
    const reviews = pairs.flatMap((pair) => pair.reviews?.[arm.spec] ?? []);
    const builds = pairs.flatMap((pair) => pair.builds === null ? [] : [pair.builds[arm.spec] === true]);
    const located = reviews.filter((review) => review.located).length;
    const firstPass = builds.filter(Boolean).length;
    return Object.freeze({
      arm: arm.spec,
      review: Object.freeze({
        replays: reviews.length,
        located,
        recall: wilson(located, reviews.length),
        fileOnly: reviews.filter((review) => review.fileOnly).length,
        falseAlarms: reviews.reduce((sum, review) => sum + review.falseAlarms, 0),
      }),
      build: Object.freeze({ replays: builds.length, firstPass, interval: wilson(firstPass, builds.length) }),
      invalidPairs: pairs.filter((pair) => pair.reasons.some((reason) => reason.arm === arm.spec)).length,
    });
  });
}

/** Pair every replay, reject invalid evidence by name, and score each arm within each item and scope. */
export function scoreRouteArms(protocol: RouteArmProtocol, replays: readonly RouteArmReplay[]): RouteArmSuiteScore {
  const arms = assertProtocol(protocol);
  const armKeys = new Set(arms.map(armKey));
  const items = new Map(protocol.items.map((item) => [item.id, item]));

  const grouped = new Map<string, (RouteArmReplay & { readonly key: string })[]>();
  const stray: Pick<RouteArmReplay, "itemId" | "arm" | "repetition">[] = [];
  for (const replay of replays) {
    let key: string | null = null;
    try {
      key = armKey(parseRouteArm(replay.arm));
    } catch (error) {
      if (!(error instanceof RouteArmSpecInvalid)) throw error;
    }
    const inRange = Number.isInteger(replay.repetition) && replay.repetition >= 1 && replay.repetition <= protocol.repetitions;
    if (key === null || !armKeys.has(key) || !items.has(replay.itemId) || !inRange) {
      stray.push(Object.freeze({ itemId: replay.itemId, arm: replay.arm, repetition: replay.repetition }));
      continue;
    }
    const group = grouped.get(pairKey(replay.itemId, replay.repetition)) ?? [];
    group.push({ ...replay, key });
    grouped.set(pairKey(replay.itemId, replay.repetition), group);
  }

  const pairs: RouteArmPair[] = [];
  for (const item of protocol.items) {
    for (let repetition = 1; repetition <= protocol.repetitions; repetition += 1) {
      pairs.push(scorePair(item, repetition, arms, grouped.get(pairKey(item.id, repetition)) ?? []));
    }
  }

  const byItem = protocol.items.map((item) => Object.freeze({
    itemId: item.id,
    kind: item.kind,
    role: item.role,
    taskClass: item.taskClass,
    arms: Object.freeze(armScores(arms, pairs.filter((pair) => pair.itemId === item.id))),
  }));

  const scopes = new Map<string, { role: string; taskClass: string; items: string[] }>();
  for (const item of protocol.items) {
    const key = `${item.role}\u0000${item.taskClass}`;
    const scope = scopes.get(key) ?? { role: item.role, taskClass: item.taskClass, items: [] };
    scope.items.push(item.id);
    scopes.set(key, scope);
  }
  const byScope = [...scopes.values()].map((scope) => {
    const scoped = pairs.filter((pair) => scope.items.includes(pair.itemId));
    return Object.freeze({
      role: scope.role,
      taskClass: scope.taskClass,
      items: Object.freeze([...scope.items]),
      invalidPairs: scoped.filter((pair) => !pair.valid).length,
      arms: Object.freeze(armScores(arms, scoped)),
    });
  });

  return Object.freeze({
    complete: stray.length === 0 && pairs.every((pair) => pair.valid),
    arms: Object.freeze(arms),
    pairs: Object.freeze(pairs),
    stray: Object.freeze(stray),
    byItem: Object.freeze(byItem),
    byScope: Object.freeze(byScope),
  });
}
