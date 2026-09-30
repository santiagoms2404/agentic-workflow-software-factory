// The shadow policy (W19 task 5, DD5, INV-2, INV-3).
//
// A pure, closed table from one stop's facts, the stop-judgment decision and
// (when task 10 supplies it) the quota plan to exactly one proposed act with a
// rationale code. Numbers decide first, in code. Jev refines only judgment: a
// code-decided act that needs judgment survives only when stop-judgment
// answered, the run is progressing (>= 0.7) and next_act picked that act at
// >= 0.85 confidence. Everything else becomes wait-for-owner.
//
// Nothing here executes. A proposal never moves lifecycle state, the ceiling
// or a checkpoint. land-shadow is proposed after an approving review and is
// never executable, whatever the input (INV-3).

import type { StopJudgmentResult, StopJudgmentWaitReason } from "../decision/question-sets/stop-judgment.ts";
import { raiseActsNeeded } from "../cli/commands/shift.ts";
import type { ReviewFindingFact, StopFacts, StopFactsConfig, StopKind } from "./stop-facts.ts";

export const PROPOSED_ACT_NAMES = [
  "raise",
  "resume",
  "wait-until",
  "cancel",
  "replacement-review",
  "rework",
  "degrade-review",
  "route-fallback",
  "continue",
  "land-shadow",
  "wait-for-owner",
] as const;
export type ProposedActName = (typeof PROPOSED_ACT_NAMES)[number];

export type ProposedAct =
  | { readonly act: "raise"; readonly calls: number; readonly raiseActs: number; readonly finalCeiling: number }
  | { readonly act: "resume" }
  | { readonly act: "wait-until"; readonly at: string }
  | { readonly act: "cancel" }
  | { readonly act: "replacement-review" }
  | { readonly act: "rework"; readonly findingIndex: number }
  | { readonly act: "degrade-review" }
  | { readonly act: "route-fallback"; readonly role: string; readonly route: string }
  | { readonly act: "continue" }
  | { readonly act: "land-shadow" }
  | { readonly act: "wait-for-owner" };

/** Why the table chose the act. Closed: every code names one row of the table. */
export const RATIONALE_CODES = [
  // Code-decided.
  "ceiling-short",
  "ceiling-funded",
  "ceiling-unreachable",
  "quota-plan-absent",
  "quota-recovered",
  "quota-reset-ahead",
  "quota-plan-stop",
  "leased-fallback-route",
  "lease-names-degrade",
  "review-accepted",
  "blocked-needs-owner",
  // Judgment, refined by stop-judgment.
  "jev-picked",
  "jev-unavailable",
  "not-progressing",
  "low-confidence",
  "chose-wait",
  "chose-other",
  "act-not-allowed",
  // Replay without Jev (task 7): a judgment act waits, a code-decided one stands.
  "numbers-only",
] as const;
export type RationaleCode = (typeof RATIONALE_CODES)[number];

/** The stop-judgment call as the policy sees it. */
export interface JudgmentInput {
  /**
   * `answered`, or why there is no answer. `numbers-only` is a replay run
   * without Jev on purpose: rows numbers decide stand as numbers decided them,
   * and every judgment row waits (`numbers-only`). It is not "unavailable",
   * which at a live stop turns even a code-decided raise into wait-for-owner.
   */
  readonly outcome: "answered" | "unavailable" | "refused-by-switch" | "contract-error" | "numbers-only";
  /** stop-judgment's own policy result; null unless answered. */
  readonly result: StopJudgmentResult | null;
}

/** Task 10's plan, when it exists. Absent means the quota stop waits for the owner. */
export type QuotaPlan =
  | { readonly kind: "resume-now" }
  | { readonly kind: "wait-until"; readonly at: string }
  | { readonly kind: "stop"; readonly reason: string };

/** The parts of a lease the table reads (task 9). Absent means no lease. */
export interface PolicyLease {
  readonly acts: readonly ProposedActName[];
  /** role -> adapter id the owner leased as that role's fallback. */
  readonly fallbackRoutes: Readonly<Record<string, string>>;
}

/** A phase's role, which the stop facts do not carry. Keyed by phase id. */
export type PhaseRoles = Readonly<Record<string, string>>;

export interface PolicyInput {
  readonly facts: StopFacts;
  readonly judgment: JudgmentInput;
  /** The compiled phases the facts were built from. */
  readonly config: StopFactsConfig;
  readonly quotaPlan?: QuotaPlan;
  readonly lease?: PolicyLease;
  readonly roles?: PhaseRoles;
}

export interface Proposal {
  readonly act: ProposedAct;
  readonly rationale: RationaleCode;
  /** False for land-shadow and wait-for-owner, always. A later lease may act only on a true one. */
  readonly executable: boolean;
}

const NEVER_EXECUTABLE: readonly ProposedActName[] = ["land-shadow", "wait-for-owner"];

/** land-shadow and wait-for-owner are never executable, whatever else a record says. */
export function isExecutableAct(act: ProposedActName): boolean {
  return !NEVER_EXECUTABLE.includes(act);
}

function proposal(act: ProposedAct, rationale: RationaleCode): Proposal {
  return Object.freeze({ act: Object.freeze(act), rationale, executable: isExecutableAct(act.act) });
}

const WAIT = { act: "wait-for-owner" } as const;

/**
 * The acts stop-judgment is offered at this stop (its `allowedActs`), in
 * preference order. The runner asks with exactly this list, so a pick outside
 * it comes back as act-not-allowed.
 */
export function allowedActsFor(facts: StopFacts, lease?: PolicyLease): readonly string[] {
  switch (facts.stopKind) {
    case "ceiling-pause":
      return ["raise", "cancel"];
    case "quota-pause":
    case "quota-stop":
      return ["resume", "cancel"];
    case "ticket-block":
      return ["continue", "cancel"];
    case "gating-hold":
      return ["cancel"];
    case "review-hold": {
      const acts: string[] = [];
      if ((facts.review?.findings?.length ?? 0) > 0) acts.push("rework");
      if (replacementReviewEligible(facts)) acts.push("replacement-review");
      if (lease?.acts.includes("degrade-review") === true) acts.push("degrade-review");
      acts.push("cancel");
      return acts;
    }
    case "blocked":
      return [];
  }
}

/**
 * Host eligibility for L25, read from the review phase's own gate rows: the
 * review_evidence_present row is absent or failed. The owner's dislike of a
 * verdict is never eligibility.
 */
export function replacementReviewEligible(facts: StopFacts): boolean {
  const review = facts.review;
  const gates = facts.gates;
  if (review === null || gates === null || gates.phaseId !== review.phaseId) return false;
  const row = gates.rows.find((candidate) => candidate.name === "review_evidence_present");
  return row === undefined || !row.passed;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

/** The first finding of the highest severity present. Task 13 lets Jev pick instead. */
export function topFindingIndex(findings: readonly ReviewFindingFact[]): number {
  for (const severity of SEVERITY_ORDER) {
    const index = findings.findIndex((finding) => finding.severity === severity);
    if (index >= 0) return index;
  }
  return 0;
}

function waitReason(reason: StopJudgmentWaitReason): RationaleCode {
  return reason;
}

/**
 * The judgment step. `candidate` is what numbers already chose for `pick`; a
 * judgment-only stop passes none and takes Jev's pick from the allowed acts.
 */
function refine(
  judgment: JudgmentInput,
  build: (act: string) => Proposal | null,
  numbersAct?: string,
): Proposal {
  if (judgment.outcome === "numbers-only") {
    return (numbersAct === undefined ? null : build(numbersAct)) ?? proposal(WAIT, "numbers-only");
  }
  if (judgment.outcome !== "answered" || judgment.result === null) return proposal(WAIT, "jev-unavailable");
  const result = judgment.result;
  if (result.kind === "wait") return proposal(WAIT, waitReason(result.reason));
  return build(result.act) ?? proposal(WAIT, "act-not-allowed");
}

/** Counts the agent calls from the next phase on: the phases with a route. */
function agentCallsFrom(config: StopFactsConfig, nextPhase: string | null): number {
  const start = nextPhase === null ? -1 : config.phases.findIndex((phase) => phase.id === nextPhase);
  if (start < 0) return 0;
  return config.phases.slice(start).filter((phase) => phase.route !== null).length;
}

function ceilingPause(input: PolicyInput): Proposal {
  const { facts } = input;
  // production-run.ts's rule: every agent call ahead plus the ticket's declared correction round.
  const target = facts.callsSpent + facts.callsReserved + agentCallsFrom(input.config, facts.nextPhase) + 1;
  const plan = raiseActsNeeded(facts.ceiling, target);
  if (plan === null) return proposal(WAIT, "ceiling-unreachable");
  if (plan.acts === 0) return proposal({ act: "resume" }, "ceiling-funded");
  return refine(input.judgment, (act) => {
    if (act === "raise") {
      return proposal({ act: "raise", calls: plan.finalCeiling - facts.ceiling, raiseActs: plan.acts, finalCeiling: plan.finalCeiling }, "ceiling-short");
    }
    if (act === "cancel") return proposal({ act: "cancel" }, "jev-picked");
    return null;
  }, "raise");
}

function quotaStop(input: PolicyInput): Proposal {
  const plan = input.quotaPlan;
  if (plan === undefined) return proposal(WAIT, "quota-plan-absent");
  if (plan.kind === "resume-now") return proposal({ act: "resume" }, "quota-recovered");
  if (plan.kind === "wait-until") return proposal({ act: "wait-until", at: plan.at }, "quota-reset-ahead");
  const next = input.facts.nextPhase;
  const role = next === null ? undefined : input.roles?.[next];
  const lease = input.lease;
  if (role !== undefined && lease !== undefined && lease.acts.includes("route-fallback")) {
    const route = lease.fallbackRoutes[role];
    if (route !== undefined && route !== input.facts.nextRoute) return proposal({ act: "route-fallback", role, route }, "leased-fallback-route");
  }
  if (role === "reviewer" && lease?.acts.includes("degrade-review") === true) return proposal({ act: "degrade-review" }, "lease-names-degrade");
  return proposal(WAIT, "quota-plan-stop");
}

function reviewHold(input: PolicyInput): Proposal {
  const { facts } = input;
  if (facts.review?.verdict === "accept") return proposal({ act: "land-shadow" }, "review-accepted");
  const allowed = allowedActsFor(facts, input.lease);
  return refine(input.judgment, (act) => {
    if (!allowed.includes(act)) return null;
    switch (act) {
      case "rework": return proposal({ act: "rework", findingIndex: topFindingIndex(facts.review!.findings!) }, "jev-picked");
      case "replacement-review": return proposal({ act: "replacement-review" }, "jev-picked");
      case "degrade-review": return proposal({ act: "degrade-review" }, "lease-names-degrade");
      case "cancel": return proposal({ act: "cancel" }, "jev-picked");
      default: return null;
    }
  });
}

function judgmentOnly(input: PolicyInput, acts: Readonly<Partial<Record<string, ProposedAct>>>): Proposal {
  return refine(input.judgment, (act) => {
    const chosen = acts[act];
    return chosen === undefined ? null : proposal(chosen, "jev-picked");
  });
}

/** The one proposed act for this stop. Pure: no clock, no file, no provider. */
export function proposeAct(input: PolicyInput): Proposal {
  const kind: StopKind = input.facts.stopKind;
  switch (kind) {
    case "ceiling-pause":
      return ceilingPause(input);
    case "quota-pause":
    case "quota-stop":
      return quotaStop(input);
    case "ticket-block":
      return judgmentOnly(input, { continue: { act: "continue" }, cancel: { act: "cancel" } });
    case "gating-hold":
      return judgmentOnly(input, { cancel: { act: "cancel" } });
    case "review-hold":
      return reviewHold(input);
    case "blocked":
      // Sealed. Continuation from an admitted code is task 15's; until then the owner decides.
      return proposal(WAIT, "blocked-needs-owner");
  }
}
