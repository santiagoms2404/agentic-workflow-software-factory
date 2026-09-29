// The shadow policy (W19 task 5): a table test over every stop kind and every
// rationale code, the unavailable decision, and land-shadow never becoming
// executable under any input.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROPOSED_ACT_NAMES,
  RATIONALE_CODES,
  allowedActsFor,
  isExecutableAct,
  proposeAct,
  replacementReviewEligible,
  topFindingIndex,
  type JudgmentInput,
  type PolicyInput,
  type Proposal,
  type QuotaPlan,
  type RationaleCode,
} from "../../../src/delegate/policy.ts";
import { STOP_KINDS, type ReviewFact, type StopFacts, type StopFactsConfig, type StopKind } from "../../../src/delegate/stop-facts.ts";
import { MAX_CALL_CEILING } from "../../../src/state/tiers.ts";

const CONFIG: StopFactsConfig = {
  phases: [
    { id: "plan", ticket: null, route: "claude-code" },
    { id: "T01-build", ticket: "T01", route: "pi-codex" },
    { id: "T01-gates", ticket: "T01", route: null },
    { id: "T02-build", ticket: "T02", route: "pi-codex" },
    { id: "T02-gates", ticket: "T02", route: null },
    { id: "review", ticket: null, route: "claude-code" },
  ],
};
const ROLES = { plan: "planner", "T01-build": "builder", "T02-build": "builder", review: "reviewer" };

const EDGE: Record<StopKind, string | null> = {
  "ceiling-pause": null, "quota-pause": null, "ticket-block": null,
  "gating-hold": "L12", "review-hold": "L15", "quota-stop": "L26", blocked: "L8",
};

function facts(stopKind: StopKind, extra: Partial<StopFacts> = {}): StopFacts {
  return {
    schema: "awsf.stop-facts/v1", project: "awsf", task: "task-1", attempt: 1, sessionId: "s-1", workflow: "shift", tier: 2,
    lifecycle: stopKind === "blocked" ? "BLOCKED" : stopKind.endsWith("hold") || stopKind === "quota-stop" ? "AWAITING_OWNER" : "RUNNING",
    stopKind, edge: EDGE[stopKind], reasonCode: null, checkpointId: null, ticket: null,
    callsSpent: 3, callsReserved: 0, ceiling: 5, maxCallCeiling: MAX_CALL_CEILING,
    nextPhase: "T02-build", nextRoute: "pi-codex", ticketsDone: ["T01"], ticketsRemaining: ["T02"],
    corrections: { auto: 0, autoAllowance: 2, owner: 0, ownerAllowance: 1, ownerReentries: 0, ownerReentriesAllowance: 1 },
    gates: null, review: null, quota: null,
    ...extra,
  };
}

const CONCERN: ReviewFact = {
  phaseId: "review", verdict: "concern", reviewedSha: "b".repeat(40), findingCount: 3,
  findings: [
    { id: "F1", severity: "low", file: "a.ts", line: 1, title: "t1", text: "x1" },
    { id: "F2", severity: "high", file: "b.ts", line: 2, title: "t2", text: "x2" },
    { id: "F3", severity: "high", file: "c.ts", line: null, title: "t3", text: "x3" },
  ],
};
const ACCEPT: ReviewFact = { ...CONCERN, verdict: "accept", findings: [], findingCount: 0 };

const picked = (act: string, confidence = 0.9): JudgmentInput => ({ outcome: "answered", result: { kind: "act", act, confidence } });
const waited = (reason: "not-progressing" | "low-confidence" | "chose-wait" | "chose-other" | "act-not-allowed"): JudgmentInput =>
  ({ outcome: "answered", result: { kind: "wait", reason } });
const UNAVAILABLE: JudgmentInput = { outcome: "unavailable", result: null };

function run(f: StopFacts, judgment: JudgmentInput, extra: Partial<PolicyInput> = {}): Proposal {
  return proposeAct({ facts: f, judgment, config: CONFIG, roles: ROLES, ...extra });
}

interface Row {
  readonly name: string;
  readonly facts: StopFacts;
  readonly judgment: JudgmentInput;
  readonly extra?: Partial<PolicyInput>;
  readonly act: string;
  readonly rationale: RationaleCode;
  readonly detail?: Record<string, unknown>;
}

const spentWeek: QuotaPlan = { kind: "stop", reason: "weekly-limiter" };
const leaseAll = { acts: [...PROPOSED_ACT_NAMES], fallbackRoutes: { builder: "pi-openrouter", reviewer: "pi-openrouter" } };

const TABLE: readonly Row[] = [
  // ceiling-pause: numbers first (3 spent + T02-build, review + 1 = 6 > 5).
  { name: "ceiling short, Jev agrees", facts: facts("ceiling-pause"), judgment: picked("raise"), act: "raise", rationale: "ceiling-short",
    detail: { calls: 5, raiseActs: 1, finalCeiling: 10 } },
  { name: "ceiling funded", facts: facts("ceiling-pause", { callsSpent: 1 }), judgment: UNAVAILABLE, act: "resume", rationale: "ceiling-funded" },
  { name: "ceiling past MAX_CALL_CEILING", facts: facts("ceiling-pause", { callsSpent: 18, ceiling: 19 }), judgment: picked("raise"), act: "wait-for-owner", rationale: "ceiling-unreachable" },
  { name: "ceiling, not progressing", facts: facts("ceiling-pause"), judgment: waited("not-progressing"), act: "wait-for-owner", rationale: "not-progressing" },
  { name: "ceiling, low confidence", facts: facts("ceiling-pause"), judgment: waited("low-confidence"), act: "wait-for-owner", rationale: "low-confidence" },
  { name: "ceiling, Jev unavailable", facts: facts("ceiling-pause"), judgment: UNAVAILABLE, act: "wait-for-owner", rationale: "jev-unavailable" },
  { name: "ceiling, Jev picks cancel", facts: facts("ceiling-pause"), judgment: picked("cancel"), act: "cancel", rationale: "jev-picked" },
  // quota-pause and L26: the quota plan decides, Jev does not.
  { name: "quota-pause, no plan yet", facts: facts("quota-pause"), judgment: picked("resume"), act: "wait-for-owner", rationale: "quota-plan-absent" },
  { name: "quota-pause, recovered", facts: facts("quota-pause"), judgment: UNAVAILABLE, extra: { quotaPlan: { kind: "resume-now" } }, act: "resume", rationale: "quota-recovered" },
  { name: "quota-stop, reset ahead", facts: facts("quota-stop"), judgment: UNAVAILABLE, extra: { quotaPlan: { kind: "wait-until", at: "2026-09-30T03:05:00Z" } },
    act: "wait-until", rationale: "quota-reset-ahead", detail: { at: "2026-09-30T03:05:00Z" } },
  { name: "quota-stop, plan stops, no lease", facts: facts("quota-stop"), judgment: UNAVAILABLE, extra: { quotaPlan: spentWeek }, act: "wait-for-owner", rationale: "quota-plan-stop" },
  { name: "quota-pause, leased fallback route", facts: facts("quota-pause"), judgment: UNAVAILABLE, extra: { quotaPlan: spentWeek, lease: leaseAll },
    act: "route-fallback", rationale: "leased-fallback-route", detail: { role: "builder", route: "pi-openrouter" } },
  { name: "quota-stop before review, lease names degrade", facts: facts("quota-stop", { nextPhase: "review", nextRoute: "claude-code" }), judgment: UNAVAILABLE,
    extra: { quotaPlan: spentWeek, lease: { acts: ["degrade-review"], fallbackRoutes: {} } }, act: "degrade-review", rationale: "lease-names-degrade" },
  // ticket-block: judgment only.
  { name: "ticket-block, Jev picks continue", facts: facts("ticket-block", { reasonCode: "phase-abort" }), judgment: picked("continue"), act: "continue", rationale: "jev-picked" },
  { name: "ticket-block, Jev chose wait", facts: facts("ticket-block"), judgment: waited("chose-wait"), act: "wait-for-owner", rationale: "chose-wait" },
  { name: "ticket-block, pick not allowed", facts: facts("ticket-block"), judgment: picked("raise"), act: "wait-for-owner", rationale: "act-not-allowed" },
  // gating-hold (L12).
  { name: "gating-hold, Jev picks cancel", facts: facts("gating-hold"), judgment: picked("cancel"), act: "cancel", rationale: "jev-picked" },
  { name: "gating-hold, Jev chose other", facts: facts("gating-hold"), judgment: waited("chose-other"), act: "wait-for-owner", rationale: "chose-other" },
  // review-hold (L15).
  { name: "review accepted", facts: facts("review-hold", { review: ACCEPT }), judgment: picked("cancel"), act: "land-shadow", rationale: "review-accepted" },
  { name: "review concern, rework the top finding", facts: facts("review-hold", { review: CONCERN }), judgment: picked("rework"), act: "rework", rationale: "jev-picked",
    detail: { findingIndex: 1 } },
  { name: "review concern, eligible replacement", facts: facts("review-hold", { review: CONCERN, gates: { phaseId: "review", round: 0, rows: [{ name: "review_evidence_present", passed: false }] } }),
    judgment: picked("replacement-review"), act: "replacement-review", rationale: "jev-picked" },
  { name: "review concern, replacement not eligible", facts: facts("review-hold", { review: CONCERN, gates: { phaseId: "review", round: 0, rows: [{ name: "review_evidence_present", passed: true }] } }),
    judgment: picked("replacement-review"), act: "wait-for-owner", rationale: "act-not-allowed" },
  { name: "review concern, leased degrade", facts: facts("review-hold", { review: CONCERN }), judgment: picked("degrade-review"),
    extra: { lease: { acts: ["degrade-review"], fallbackRoutes: {} } }, act: "degrade-review", rationale: "lease-names-degrade" },
  { name: "review concern, Jev unavailable", facts: facts("review-hold", { review: CONCERN }), judgment: { outcome: "refused-by-switch", result: null }, act: "wait-for-owner", rationale: "jev-unavailable" },
  // blocked: sealed; continuation is task 15's.
  { name: "blocked", facts: facts("blocked", { reasonCode: "silence" }), judgment: picked("continue"), act: "wait-for-owner", rationale: "blocked-needs-owner" },
];

for (const row of TABLE) {
  test(`policy: ${row.facts.stopKind} / ${row.name} -> ${row.act} (${row.rationale})`, () => {
    const result = run(row.facts, row.judgment, row.extra);
    assert.equal(result.act.act, row.act);
    assert.equal(result.rationale, row.rationale);
    for (const [key, value] of Object.entries(row.detail ?? {})) assert.deepEqual((result.act as unknown as Record<string, unknown>)[key], value, key);
    assert.equal(result.executable, isExecutableAct(result.act.act));
  });
}

test("policy: the table reaches every stop kind, every act and every rationale code", () => {
  assert.deepEqual(new Set(TABLE.map((row) => row.facts.stopKind)), new Set(STOP_KINDS));
  assert.deepEqual(new Set(TABLE.map((row) => row.act)), new Set(PROPOSED_ACT_NAMES));
  assert.deepEqual(new Set(TABLE.map((row) => row.rationale)), new Set(RATIONALE_CODES));
});

test("policy: every judgment-refined act becomes wait-for-owner (jev-unavailable) when the decision is not answered", () => {
  for (const outcome of ["unavailable", "refused-by-switch", "contract-error"] as const) {
    for (const f of [facts("ceiling-pause"), facts("ticket-block"), facts("gating-hold"), facts("review-hold", { review: CONCERN })]) {
      const result = run(f, { outcome, result: null });
      assert.deepEqual([result.act.act, result.rationale, result.executable], ["wait-for-owner", "jev-unavailable", false], `${f.stopKind} ${outcome}`);
    }
  }
});

test("policy: land-shadow is never executable, whatever the judgment, quota plan or lease", () => {
  const judgments: JudgmentInput[] = [
    UNAVAILABLE, picked("land"), picked("land-shadow"), picked("rework"), picked("cancel", 1), waited("chose-wait"),
    { outcome: "answered", result: { kind: "act", act: "land-shadow", confidence: 1 } },
  ];
  const plans: (QuotaPlan | undefined)[] = [undefined, { kind: "resume-now" }, spentWeek];
  const leases = [undefined, leaseAll, { acts: ["land-shadow" as const], fallbackRoutes: {} }];
  let landShadows = 0;
  for (const judgment of judgments) for (const quotaPlan of plans) for (const lease of leases) {
    for (const f of [facts("review-hold", { review: ACCEPT }), facts("review-hold", { review: CONCERN }), ...STOP_KINDS.map((kind) => facts(kind))]) {
      const result = run(f, judgment, { ...(quotaPlan === undefined ? {} : { quotaPlan }), ...(lease === undefined ? {} : { lease }) });
      if (result.act.act === "land-shadow") {
        landShadows += 1;
        assert.equal(result.executable, false);
        assert.equal(f.review?.verdict, "accept", "land-shadow only after an approving review");
      }
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.act));
    }
  }
  assert.ok(landShadows > 0);
  assert.equal(isExecutableAct("land-shadow"), false);
  assert.equal(isExecutableAct("wait-for-owner"), false);
  assert.throws(() => { (run(facts("review-hold", { review: ACCEPT }), UNAVAILABLE) as { executable: boolean }).executable = true; });
});

test("policy: allowed acts, replacement eligibility and the top finding", () => {
  assert.deepEqual(allowedActsFor(facts("ceiling-pause")), ["raise", "cancel"]);
  assert.deepEqual(allowedActsFor(facts("blocked")), []);
  assert.deepEqual(allowedActsFor(facts("review-hold", { review: CONCERN })), ["rework", "cancel"]);
  assert.deepEqual(allowedActsFor(facts("review-hold", { review: { ...CONCERN, findings: null } })), ["cancel"]);
  assert.equal(replacementReviewEligible(facts("review-hold", { review: CONCERN, gates: { phaseId: "review", round: 0, rows: [] } })), true, "row absent");
  assert.equal(replacementReviewEligible(facts("review-hold", { review: CONCERN, gates: { phaseId: "T02-gates", round: 0, rows: [] } })), false, "other phase's rows");
  assert.equal(topFindingIndex(CONCERN.findings!), 1);
});
