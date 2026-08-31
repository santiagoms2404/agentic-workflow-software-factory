// T4 — the per-edge evidence guards.
//
// Step 10 is the last structural check before price: "only a fully legitimate
// request earns a critique of its evidence — otherwise fabricating evidence
// would look like the fix." So every guard in the L-table's Guard column is a
// test here, in both directions: satisfied, and each component removed.
//
// The load-bearing ones:
//   L7  — a real candidate SHA, or host-observed T0 read-only result evidence
//   L10 — the failed command AND its output, or a correction is hearsay
//   L16 — severity >= medium with file and detail; a style note is not a defect
//   L21 — record faults only; NO CLOCK may produce it, because AWAITING_OWNER
//         has no timeout and a task waiting on its owner waits forever
//   L23 — canonical HEAD equals the exact candidate, on a clean checkout
//
// RED until T5 writes `core/src/state/{task-machine,guards,errors}.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLOCKER_CODES,
  EDGE_BLOCKER_CODES,
  REVIEW_EVIDENCE_DEFECTS,
  edge,
  type EdgeId,
} from "./_lifecycle-tables.ts";
import {
  BASE_SHA,
  CANDIDATE_SHA,
  budget,
  expectAccepted,
  expectRejection,
  finding,
  stateErrors,
  styleNote,
  validInput,
  withEvidence,
  withoutEvidence,
  withReason,
  type GateEvidence,
  type LandingEvidence,
  type ReviewEvidence,
  type TransitionEvidence,
  type TransitionInput,
} from "./_lifecycle-harness.ts";

// ---------------------------------------------------------------------------
// Shared shapes.
// ---------------------------------------------------------------------------

/** Every way a value can fail to be a 40-hex git object id. */
const MALFORMED_SHAS: readonly string[] = [
  "",
  "abc123",
  "c".repeat(39),
  "c".repeat(41),
  "C".repeat(40), // uppercase — `^[0-9a-f]{40}$`, as the envelope contracts already hold
  "g".repeat(40), // not hex
  `${"c".repeat(39)}z`,
  ` ${"c".repeat(39)}`,
  `${"c".repeat(20)}-${"c".repeat(19)}`,
  "HEAD",
  "refs/heads/main",
];

function withLanding(patch: Partial<LandingEvidence>): TransitionInput {
  const base = validInput("L20");
  const landing = base.evidence?.landing;
  if (!landing) throw new Error("the L20 fixture must carry landing evidence");
  return { ...base, evidence: { ...base.evidence, landing: { ...landing, ...patch } } };
}

function withReview(id: EdgeId, patch: Partial<ReviewEvidence>): TransitionInput {
  const base = validInput(id);
  const review = base.evidence?.review;
  if (!review) throw new Error(`the ${id} fixture must carry review evidence`);
  return { ...base, evidence: { ...base.evidence, review: { ...review, ...patch } } };
}

function readOnlyCompletion(id: "L7" | "L12"): TransitionInput {
  const base = withoutEvidence(id, "candidateSha");
  return {
    ...base,
    tier: 0,
    evidence: {
      ...base.evidence,
      baseSha: BASE_SHA,
      hostCommitCreated: false,
      readOnlyResult: { schema: "awsf.plan-output/v1", writesObserved: false },
    },
  };
}

async function expectAllInsufficient(cases: readonly (readonly [string, TransitionInput])[]): Promise<void> {
  const failures: string[] = [];
  for (const [label, input] of cases) {
    try {
      await expectRejection("InsufficientEvidence", input, { because: label });
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
}

// ---------------------------------------------------------------------------
// L1 — preflight.
// ---------------------------------------------------------------------------

test("L1 requires a worktree, a pinned base SHA, a valid config, and three green preflights", async () => {
  await expectAllInsufficient([
    ["no worktree", withEvidence("L1", { worktreeCreated: false })],
    ["invalid config", withEvidence("L1", { configValid: false })],
    ["base SHA absent", withoutEvidence("L1", "baseSha")],
    ["preflight absent", withoutEvidence("L1", "preflight")],
    ["adapter preflight failed", withEvidence("L1", { preflight: { adapter: false, sandbox: true, observability: true } })],
    ["sandbox preflight failed", withEvidence("L1", { preflight: { adapter: true, sandbox: false, observability: true } })],
    ["observability preflight failed", withEvidence("L1", { preflight: { adapter: true, sandbox: true, observability: false } })],
    ["no evidence at all", { ...validInput("L1"), evidence: {} }],
  ]);
});

test("L1 rejects a base SHA that is not a 40-hex object id", async () => {
  await expectAllInsufficient(
    MALFORMED_SHAS.map((sha) => [`base SHA ${JSON.stringify(sha)}`, withEvidence("L1", { baseSha: sha })] as const),
  );
});

// ---------------------------------------------------------------------------
// L4 — the workflow must exist before a provider does.
// ---------------------------------------------------------------------------

test("L4 requires a compiled workflow", async () => {
  await expectAllInsufficient([
    ["workflow not compiled", withEvidence("L4", { workflowCompiled: false })],
    ["compilation not attested", withoutEvidence("L4", "workflowCompiled")],
  ]);
});

// ---------------------------------------------------------------------------
// L7 — the "said done, wrote nothing" gate.
// ---------------------------------------------------------------------------

test("L7 requires all required phases terminal-success and a host commit", async () => {
  await expectAllInsufficient([
    ["a required phase is not terminal-success", withEvidence("L7", { requiredPhasesTerminalSuccess: false })],
    ["phase outcomes not attested", withoutEvidence("L7", "requiredPhasesTerminalSuccess")],
    ["no host commit", withEvidence("L7", { hostCommitCreated: false })],
    ["commit not attested", withoutEvidence("L7", "hostCommitCreated")],
  ]);
});

test("L7 requires a 40-hex candidate SHA that differs from the base", async () => {
  await expectAllInsufficient([
    ["candidate equals base — the agent said done and wrote nothing", withEvidence("L7", { candidateSha: BASE_SHA })],
    ["candidate absent", withoutEvidence("L7", "candidateSha")],
    ["base absent, so 'differs from base' is unprovable", withoutEvidence("L7", "baseSha")],
    ...MALFORMED_SHAS.map((sha) => [`candidate ${JSON.stringify(sha)}`, withEvidence("L7", { candidateSha: sha })] as const),
  ]);
});

test("L7 accepts a real commit", async () => {
  const result = await expectAccepted(validInput("L7"));
  assert.equal(result.edge, "L7");
  assert.equal(result.to, "GATING");
});

test("L7 and L12 admit a host-observed T0 read-only result without inventing a candidate", async () => {
  assert.equal((await expectAccepted(readOnlyCompletion("L7"))).to, "GATING");
  assert.equal((await expectAccepted(readOnlyCompletion("L12"))).to, "AWAITING_OWNER");

  const l7 = readOnlyCompletion("L7");
  await expectAllInsufficient([
    ["read-only work wrote to the tree", {
      ...l7,
      evidence: { ...l7.evidence, readOnlyResult: { schema: "awsf.plan-output/v1", writesObserved: true } },
    }],
    ["read-only completion is restricted to T0", { ...readOnlyCompletion("L12"), tier: 1 }],
    ["read-only completion may not carry a candidate", {
      ...l7,
      evidence: { ...l7.evidence, candidateSha: CANDIDATE_SHA },
    }],
  ]);
});

// ---------------------------------------------------------------------------
// L9 — cancellation reports reality.
// ---------------------------------------------------------------------------

test("L9 requires the tree terminated and the survivors reported", async () => {
  // "Tree terminated, survivors reported" — a cancellation that cannot say what
  // is still alive is the ghost-process failure this system exists to prevent.
  await expectAllInsufficient([
    ["tree not terminated", withEvidence("L9", { treeTerminated: false })],
    ["survivors not reported", withEvidence("L9", { survivorsReported: false })],
    ["neither attested", { ...validInput("L9"), evidence: {} }],
  ]);
});

// ---------------------------------------------------------------------------
// L10 — a correction carries its own proof.
// ---------------------------------------------------------------------------

test("L10 requires both the failed command and its output", async () => {
  const base = validInput("L10");
  const noCommand: TransitionInput = { ...base, reason: { source: "gate", output: "1 failing" } };
  const noOutput: TransitionInput = { ...base, reason: { source: "gate", command: ["npm", "test"] } };
  const neither: TransitionInput = { ...base, reason: { source: "gate" } };
  await expectAllInsufficient([
    ["no command", noCommand],
    ["no output", noOutput],
    ["neither", neither],
    ["empty argv", { ...base, reason: { ...base.reason, command: [] } }],
    ["empty output", { ...base, reason: { ...base.reason, output: "" } }],
  ]);
});

test("L10 refuses a correction when the gates did not fail", async () => {
  // There is nothing to correct, and a call would be spent on nothing.
  await expectAllInsufficient([
    ["gates passed", withEvidence("L10", { gatesPass: true })],
    ["gate outcome not attested", withoutEvidence("L10", "gatesPass")],
  ]);
});

// ---------------------------------------------------------------------------
// L11 / L12 — the tier fork out of GATING.
// ---------------------------------------------------------------------------

test("L11 needs passing gates AND tier 2; L12 needs passing gates AND tier below 2", async () => {
  await expectAllInsufficient([
    ["L11 at T0", { ...validInput("L11"), tier: 0 }],
    ["L11 at T1", { ...validInput("L11"), tier: 1 }],
    ["L11 with failing gates", withEvidence("L11", { gatesPass: false })],
    ["L11 with no gate result", withoutEvidence("L11", "gatesPass")],
    ["L12 at T2 — a T2 task may not skip review", { ...validInput("L12"), tier: 2, budget: budget({ callsSpent: 2 }) }],
    ["L12 with failing gates", withEvidence("L12", { gatesPass: false })],
    ["L12 with no gate result", withoutEvidence("L12", "gatesPass")],
  ]);

  await expectAccepted({ ...validInput("L12"), tier: 0 });
  await expectAccepted({ ...validInput("L12"), tier: 1 });
  await expectAccepted(validInput("L11"));
});

// ---------------------------------------------------------------------------
// L13 — the budget must really be gone.
// ---------------------------------------------------------------------------

test("L13 requires failed gates and a genuinely exhausted correction budget", async () => {
  // Three counters, three ways out, and L13 must mean all of them: blocking a
  // task whose owner could still correct in-phase, or still re-enter, strands
  // work that had a remedy nobody was offered.
  const spent = { correctionsAuto: 1, correctionsOwner: 1, ownerReentries: 1, callsSpent: 3 };
  await expectAllInsufficient([
    ["gates passed", withEvidence("L13", { gatesPass: true })],
    ["the automatic tranche is still available", { ...validInput("L13"), budget: budget({ ...spent, correctionsAuto: 0 }) }],
    ["the per-phase owner tranche is still available", { ...validInput("L13"), budget: budget({ ...spent, correctionsOwner: 0 }) }],
    ["the owner re-entry allowance is still available", { ...validInput("L13"), budget: budget({ ...spent, ownerReentries: 0 }) }],
    ["nothing is spent at all", { ...validInput("L13"), budget: budget({ callsSpent: 3 }) }],
  ]);
  await expectAccepted({ ...validInput("L13"), budget: budget(spent) });
});

// ---------------------------------------------------------------------------
// L15 — a verdict must be internally consistent.
// ---------------------------------------------------------------------------

test("L15 requires a recorded, internally consistent verdict on the exact candidate", async () => {
  await expectAllInsufficient([
    ["no review at all", withoutEvidence("L15", "review")],
    ["accept carrying a high finding", withReview("L15", { verdict: "accept", findings: [finding({ severity: "high" })] })],
    ["accept carrying a critical finding", withReview("L15", { verdict: "accept", findings: [finding({ severity: "critical" })] })],
    ["concern with no concrete finding", withReview("L15", { verdict: "concern", findings: [] })],
    ["a review of a different tree", withReview("L15", { reviewedSha: BASE_SHA })],
    ...MALFORMED_SHAS.map((sha) => [`reviewed SHA ${JSON.stringify(sha)}`, withReview("L15", { reviewedSha: sha })] as const),
  ]);

  // Consistent verdicts pass: accept may carry low/medium notes, and concern
  // needs only one concrete finding.
  await expectAccepted(withReview("L15", { verdict: "accept", findings: [styleNote()] }));
  await expectAccepted(withReview("L15", { verdict: "concern", findings: [finding()] }));
});

// ---------------------------------------------------------------------------
// L16 — a style note is not a defect.
// ---------------------------------------------------------------------------

test("L16 refuses to spend a call on anything less than a medium-severity defect", async () => {
  // "If a style note authorized re-work, 'the reviewer had opinions' would be
  // indistinguishable from 'the code is wrong'."
  await expectAllInsufficient([
    ["only a style note", withReview("L16", { findings: [styleNote()] })],
    ["several style notes", withReview("L16", { findings: [styleNote(), styleNote(), styleNote()] })],
    ["no findings at all", withReview("L16", { findings: [] })],
    ["no review recorded", withoutEvidence("L16", "review")],
  ]);
});

test("L16 requires the qualifying finding to carry both a file and a detail", async () => {
  await expectAllInsufficient([
    ["medium finding with no detail", withReview("L16", { findings: [finding({ detail: "" })] })],
    ["medium finding with no file", withReview("L16", { findings: [finding({ file: "" })] })],
    ["high finding with no detail", withReview("L16", { findings: [finding({ severity: "high", detail: "" })] })],
    ["a defect-free file plus a detail-free defect", withReview("L16", { findings: [styleNote(), finding({ detail: "" })] })],
  ]);
});

test("L16 accepts medium, high and critical findings, and requires stale gates invalidated", async () => {
  for (const severity of ["medium", "high", "critical"] as const) {
    const result = await expectAccepted(withReview("L16", { findings: [finding({ severity })] }));
    assert.equal(result.edge, "L16");
  }
  // One qualifying finding among style notes is enough.
  await expectAccepted(withReview("L16", { findings: [styleNote(), finding({ severity: "high" })] }));

  await expectAllInsufficient([
    ["gates not invalidated — the old green would vouch for the new tree", withEvidence("L16", { gatesInvalidated: false })],
    ["invalidation not attested", withoutEvidence("L16", "gatesInvalidated")],
    ["a review of a different tree", withReview("L16", { reviewedSha: BASE_SHA })],
  ]);
});

// ---------------------------------------------------------------------------
// L17 — one transport retry, then block. Never a substitute provider.
// ---------------------------------------------------------------------------

test("L17 requires the mandatory review to have been retried once and still be unreachable", async () => {
  await expectAllInsufficient([
    ["no retry attempted", withEvidence("L17", { reviewTransportRetries: 0 })],
    ["retries not attested", withoutEvidence("L17", "reviewTransportRetries")],
  ]);
  await expectAccepted(withEvidence("L17", { reviewTransportRetries: 1 }));
});

test("L17 also blocks on review failures the host can classify after process exit", async () => {
  // The dead end this repairs predates L25: a malformed reviewer envelope
  // satisfies neither L15 (no valid verdict) nor L16 (no finding of severity
  // >= medium exists to accept) nor the old L17 (a review that ANSWERED was
  // never a transport failure), so cancel was the only edge and a parse error
  // cost the whole candidate.
  const noRetry = (patch: Partial<TransitionEvidence>): TransitionInput => {
    const base = withoutEvidence("L17", "reviewTransportRetries");
    return { ...base, evidence: { ...base.evidence, ...patch } };
  };
  for (const code of [
    "review-malformed",
    "review-evidence-invalid",
    "review-inconsistent",
    "quota-exhausted",
    "silence",
    "phase-abort",
    "permission-breach",
    "budget-exhausted",
  ] as const) {
    const accepted = await expectAccepted({
      ...noRetry({ reviewFailure: code }),
      reason: { source: "process", code },
    });
    assert.equal(accepted.edge, "L17");
    assert.equal(accepted.to, "BLOCKED");
  }
});

test("L17 records an inconsistent verdict without interpreting it", async () => {
  const base = withoutEvidence("L17", "reviewTransportRetries");
  const accepted = await expectAccepted({
    ...base,
    reason: { source: "process", code: "review-inconsistent" },
    evidence: { reviewFailure: "review-inconsistent" },
  });
  assert.equal(accepted.edge, "L17");

  await expectAllInsufficient([[
    "the evidence must match the blocker code",
    {
      ...base,
      reason: { source: "process", code: "review-inconsistent" },
      evidence: { reviewFailure: "reviewer-was-unconvincing" },
    },
  ]]);
});

test("L17's blocker vocabulary covers every exited review classification", async () => {
  assert.deepEqual([...EDGE_BLOCKER_CODES.L17], [
    "review-unavailable",
    "review-malformed",
    "review-evidence-invalid",
    "review-inconsistent",
    "quota-exhausted",
    "silence",
    "phase-abort",
    "permission-breach",
    "budget-exhausted",
  ]);
});

// ---------------------------------------------------------------------------
// L19 — owner rework invalidates what it supersedes.
// ---------------------------------------------------------------------------

test("L19 requires a concrete rework request and invalidates both the gates and the review", async () => {
  await expectAllInsufficient([
    ["no rework request", withoutEvidence("L19", "reworkRequest")],
    ["a blank rework request", withEvidence("L19", { reworkRequest: "" })],
    ["whitespace is not a request", withEvidence("L19", { reworkRequest: "   " })],
    ["gates left standing", withEvidence("L19", { gatesInvalidated: false })],
    ["review left standing", withEvidence("L19", { reviewInvalidated: false })],
  ]);
});

// ---------------------------------------------------------------------------
// L20 — the human gate's evidence.
// ---------------------------------------------------------------------------

test("L20 requires the exact SHA and summary displayed and confirmed", async () => {
  await expectAllInsufficient([
    ["not confirmed", withLanding({ confirmed: false })],
    ["a different SHA was displayed", withLanding({ shaDisplayed: BASE_SHA })],
    ["no summary shown", withLanding({ summaryDisplayed: "" })],
    ["no landing evidence at all", withoutEvidence("L20", "landing")],
    ...MALFORMED_SHAS.map((sha) => [`displayed SHA ${JSON.stringify(sha)}`, withLanding({ shaDisplayed: sha })] as const),
  ]);
});

test("L20 requires passing gates and a fast-forward preflight", async () => {
  await expectAllInsufficient([
    ["gates not passing", withEvidence("L20", { gatesPass: false })],
    ["gate result absent", withoutEvidence("L20", "gatesPass")],
    ["fast-forward preflight failed", withLanding({ fastForwardPreflightPasses: false })],
    ["protected approvals not valid", withLanding({ protectedApprovalsValid: false })],
  ]);
});

test("L20 demands the review and journey at T2, and does not invent them below it", async () => {
  // "T2 plus opposite-provider review and end-user journey" — required there,
  // and only there.
  await expectAllInsufficient([
    ["T2 landing with no review", withLanding({ requiredReviewPresent: false })],
    ["T2 landing with no journey", withLanding({ journeyApproved: false })],
  ]);
  for (const tier of [0, 1] as const) {
    await expectAccepted({
      ...withLanding({ requiredReviewPresent: false, journeyApproved: false }),
      tier,
      budget: budget({ callsSpent: 1 }),
    });
  }
});

// ---------------------------------------------------------------------------
// L21 — record faults only. No clock.
// ---------------------------------------------------------------------------

test("L21 accepts exactly the four record-fault codes, with source 'record'", async () => {
  const failures: string[] = [];
  for (const code of EDGE_BLOCKER_CODES.L21) {
    try {
      const result = await expectAccepted(withReason("L21", { source: "record", code }));
      if (result.edge !== "L21") failures.push(`${code}: reported ${result.edge}`);
    } catch (error) {
      failures.push(`${code}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(EDGE_BLOCKER_CODES.L21, [
    "record-corrupt", "unknown-state", "ambiguous-pid", "unreadable-worktree",
  ]);
});

test("L21 refuses every source other than 'record' — the fault must be in the record", async () => {
  await expectAllInsufficient(
    (["process", "exit-code", "git", "gate", "human"] as const).map(
      (source) => [`source ${source}`, withReason("L21", { source, code: "record-corrupt" })] as const,
    ),
  );
});

test("NO CLOCK may produce AWAITING_OWNER -> BLOCKED", async () => {
  // AWAITING_OWNER has no timeout. A task waiting on the owner waits forever;
  // that is the point. A clock is not on the deterministic-evidence allowlist,
  // so it cannot even reach the guard — step 1 refuses it first.
  const failures: string[] = [];
  for (const source of ["clock", "timer", "timeout", "deadline", "elapsed", "scheduler", "cron"]) {
    for (const code of EDGE_BLOCKER_CODES.L21) {
      try {
        await expectRejection("NonDeterministicEvidence", withReason("L21", { source, code }), {
          because: `${source} attempting to time the owner out`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("L21 refuses a record source carrying a code from any other edge's vocabulary", async () => {
  await expectAllInsufficient([
    ["quota exhaustion is not a record fault", withReason("L21", { source: "record", code: "quota-exhausted" })],
    ["a crash is not a record fault", withReason("L21", { source: "record", code: "crash" })],
    ["a non-FF is not a record fault", withReason("L21", { source: "record", code: "non-fast-forward" })],
    ["an unknown code", withReason("L21", { source: "record", code: "owner-took-too-long" })],
    ["no code at all", { ...validInput("L21"), reason: { source: "record" } }],
  ]);
});

// ---------------------------------------------------------------------------
// L23 / L24 — landing is confirmed against reality.
// ---------------------------------------------------------------------------

test("L23 requires canonical HEAD to equal the exact candidate on a clean checkout", async () => {
  await expectAllInsufficient([
    ["HEAD is not the candidate", withEvidence("L23", { headSha: BASE_SHA })],
    ["HEAD not attested", withoutEvidence("L23", "headSha")],
    ["candidate not attested", withoutEvidence("L23", "candidateSha")],
    ["a dirty checkout", withEvidence("L23", { checkoutClean: false })],
    ["cleanliness not attested", withoutEvidence("L23", "checkoutClean")],
    ...MALFORMED_SHAS.map((sha) => [`HEAD ${JSON.stringify(sha)}`, withEvidence("L23", { headSha: sha })] as const),
  ]);
  const result = await expectAccepted(validInput("L23"));
  assert.equal(result.to, "LANDED");
});

// ---------------------------------------------------------------------------
// L25 — the owner re-buys a review of an UNCHANGED candidate.
// ---------------------------------------------------------------------------

test("L25 accepts only with all eleven checks satisfied", async () => {
  const result = await expectAccepted(validInput("L25"));
  assert.equal(result.edge, "L25");
  assert.equal(result.to, "REVIEWING");
  assert.equal(result.spawnSite, true);
  assert.equal(result.spends.calls, 1);
  assert.equal(result.spends.correctionTranche, "owner");
});

test("L25 requires an owner's own reason, recorded, at T2, on a green 40-hex candidate", async () => {
  await expectAllInsufficient([
    ["a gate result is not an owner", withReason("L25", { source: "gate" })],
    ["no reason was recorded", withoutEvidence("L25", "reviewInvalidationReason")],
    ["a blank reason is not a record", withEvidence("L25", { reviewInvalidationReason: "" })],
    ["whitespace is not a record", withEvidence("L25", { reviewInvalidationReason: "   " })],
    ["T0 has no review to replace", { ...validInput("L25"), tier: 0 }],
    ["T1 has no review to replace", { ...validInput("L25"), tier: 1 }],
    ["a red candidate is never re-reviewed", withEvidence("L25", { gatesPass: false })],
    ["no gate result at all", withoutEvidence("L25", "gatesPass")],
    ["candidate absent", withoutEvidence("L25", "candidateSha")],
    ...MALFORMED_SHAS.map((sha) => [`candidate ${JSON.stringify(sha)}`, withEvidence("L25", { candidateSha: sha })] as const),
  ]);
});

test("L25 checks the green itself, not the boolean summarising it", async () => {
  // `gatesPass: true` is one flag an earlier transition wrote. The edge that
  // PRESERVES a green must read the rows.
  const rows = (patch: Partial<GateEvidence>): TransitionInput =>
    withEvidence("L25", {
      gateEvidence: { ...validInput("L25").evidence!.gateEvidence!, ...patch },
    });
  await expectAllInsufficient([
    ["no gate rows attested at all", withoutEvidence("L25", "gateEvidence")],
    ["gatesPass true with no configured gate", rows({ configured: [], rows: [] })],
    ["a configured gate with no recorded row", rows({ configured: ["tests", "typecheck", "lint"] })],
    [
      "a recorded row that did not pass",
      rows({ rows: [{ gateId: "tests", passed: false, candidateSha: CANDIDATE_SHA }] }),
    ],
    [
      "a row measured against a superseded candidate",
      rows({ rows: [{ gateId: "tests", passed: true, candidateSha: BASE_SHA }] }),
    ],
    [
      "a row whose SHA is not an object id",
      rows({ rows: [{ gateId: "tests", passed: true, candidateSha: "HEAD" }] }),
    ],
  ]);
});

test("L25 may only supersede a review that exists and named this tree", async () => {
  await expectAllInsufficient([
    ["no review to supersede", withoutEvidence("L25", "review")],
    ["the superseded review was not invalidated", withEvidence("L25", { reviewInvalidated: false })],
    ["invalidation not attested", withoutEvidence("L25", "reviewInvalidated")],
    ["a review of a different tree", withReview("L25", { reviewedSha: BASE_SHA })],
    ...MALFORMED_SHAS.map((sha) => [`reviewed SHA ${JSON.stringify(sha)}`, withReview("L25", { reviewedSha: sha })] as const),
  ]);
});

test("L25's eligibility is a two-member host enum — a disliked verdict buys nothing", async () => {
  // §5.3.1, the anti-shopping rule. A fully evidenced review is not replaceable
  // at all; if disliking a verdict could buy a cold second opinion, the
  // mandatory opposite-provider review would be a one-shot lottery, and
  // "you may only do it once" is no answer, because once is enough.
  assert.deepEqual([...REVIEW_EVIDENCE_DEFECTS], ["evidence-gate-absent", "evidence-gate-failed"]);
  for (const defect of REVIEW_EVIDENCE_DEFECTS) {
    await expectAccepted(withEvidence("L25", { reviewEvidenceDefect: defect }));
  }
  await expectAllInsufficient([
    ["no defect named", withoutEvidence("L25", "reviewEvidenceDefect")],
    ["a passing evidence gate is not a defect", withEvidence("L25", { reviewEvidenceDefect: "evidence-gate-present" })],
    ["the owner disagrees with the verdict", withEvidence("L25", { reviewEvidenceDefect: "verdict-unconvincing" })],
    ["an empty defect", withEvidence("L25", { reviewEvidenceDefect: "" })],
    ["a near-miss of an allowlisted code", withEvidence("L25", { reviewEvidenceDefect: "Evidence-Gate-Absent" })],
  ]);
});

test("L25 requires the host's observation that the candidate has not moved", async () => {
  await expectAllInsufficient([
    ["the tree moved or was dirty", withEvidence("L25", { candidateUnchanged: false })],
    ["nobody looked", withoutEvidence("L25", "candidateUnchanged")],
  ]);
});

test("L25 refuses to speak to invalidating the gates — that is the whole point of the edge", async () => {
  // L16 and L19 MUST invalidate the gates, because they change the tree. L25
  // exists precisely because the tree does not change, so the old green
  // vouches for exactly the tree it saw. A request that asserts invalidation
  // either way is a rework wearing a review's name.
  await expectAllInsufficient([
    ["claiming the gates are stale", withEvidence("L25", { gatesInvalidated: true })],
    ["even denying it is a claim this edge does not make", withEvidence("L25", { gatesInvalidated: false })],
  ]);
});

// ---------------------------------------------------------------------------
// Blocker codes — the closed vocabulary of every `→ BLOCKED` edge.
// ---------------------------------------------------------------------------

test("the module's blocker vocabulary is exactly the plan's", async () => {
  const errors = await stateErrors();
  assert.deepEqual([...errors.BLOCKER_CODES].sort(), [...BLOCKER_CODES].sort());
});

test("every blocking edge accepts its own codes and refuses every other edge's", async () => {
  const blockingEdges = Object.keys(EDGE_BLOCKER_CODES) as (keyof typeof EDGE_BLOCKER_CODES)[];
  assert.deepEqual(blockingEdges, ["L2", "L5", "L8", "L13", "L17", "L21", "L24"]);

  const failures: string[] = [];
  for (const id of blockingEdges) {
    const own: readonly string[] = EDGE_BLOCKER_CODES[id];
    assert.equal(edge(id).to, "BLOCKED");

    for (const code of own) {
      try {
        const input = withReason(id, { code });
        await expectAccepted(id === "L17" && code !== "review-unavailable"
          ? { ...input, evidence: { ...input.evidence, reviewFailure: code } }
          : input);
      } catch (error) {
        failures.push(`${id} must accept ${code}: ${(error as Error).message}`);
      }
    }

    const foreign = BLOCKER_CODES.filter((code) => !own.includes(code));
    for (const code of foreign) {
      try {
        await expectRejection("InsufficientEvidence", withReason(id, { code }), {
          because: `${code} is not in ${id}'s vocabulary`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("a blocking edge with no code, or an invented code, refuses to halt silently", async () => {
  const failures: string[] = [];
  for (const id of ["L2", "L5", "L8", "L13", "L17", "L21", "L24"] as const) {
    const base = validInput(id);
    const cases: readonly (readonly [string, TransitionInput])[] = [
      [`${id} with no reason code`, { ...base, reason: { source: base.reason.source } }],
      [`${id} with an invented code`, withReason(id, { code: "something-went-wrong" })],
      [`${id} with an empty code`, withReason(id, { code: "" })],
    ];
    for (const [label, input] of cases) {
      try {
        await expectRejection("InsufficientEvidence", input, { because: label });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// Cancellation is explicit human input, always.
// ---------------------------------------------------------------------------

test("every cancel edge requires explicit human input as its evidence", async () => {
  const failures: string[] = [];
  for (const id of ["L3", "L6", "L9", "L14", "L18", "L22"] as const) {
    assert.equal(edge(id).to, "CANCELLED");
    for (const source of ["process", "exit-code", "git", "gate", "record"] as const) {
      try {
        await expectRejection("InsufficientEvidence", withReason(id, { source }), {
          because: `${id} cancelled by ${source} rather than a person`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// The whole guard surface, in one sweep.
// ---------------------------------------------------------------------------

test("every legal edge that declares a SHA holds it to the same 40-hex rule", async () => {
  // The T3 lesson, applied to the state layer: one path field left unguarded is
  // one place the rule does not hold. Same here for object ids.
  const base = (sha: string): Partial<TransitionEvidence> => ({ baseSha: sha });
  const candidate = (sha: string): Partial<TransitionEvidence> => ({ candidateSha: sha });
  const head = (sha: string): Partial<TransitionEvidence> => ({ headSha: sha });
  const declaredShaFields: readonly (readonly [EdgeId, string, (sha: string) => Partial<TransitionEvidence>])[] = [
    ["L1", "baseSha", base],
    ["L7", "baseSha", base],
    ["L7", "candidateSha", candidate],
    ["L10", "candidateSha", candidate],
    ["L11", "candidateSha", candidate],
    ["L12", "candidateSha", candidate],
    ["L15", "candidateSha", candidate],
    ["L16", "candidateSha", candidate],
    ["L19", "candidateSha", candidate],
    ["L20", "candidateSha", candidate],
    ["L23", "candidateSha", candidate],
    ["L23", "headSha", head],
  ];
  const failures: string[] = [];
  for (const [id, field, patch] of declaredShaFields) {
    for (const sha of ["", "abc", "C".repeat(40), "g".repeat(40), "c".repeat(41)]) {
      try {
        await expectRejection("InsufficientEvidence", withEvidence(id, patch(sha)), {
          because: `${id}.${field} = ${JSON.stringify(sha)}`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("the candidate SHA a landing displays, reviews, and confirms is one and the same", async () => {
  // Three independent records of the same object id. If they may drift, the
  // human confirms one tree and the host lands another.
  assert.equal(validInput("L20").evidence?.candidateSha, CANDIDATE_SHA);
  assert.equal(validInput("L20").evidence?.landing?.shaDisplayed, CANDIDATE_SHA);
  await expectAccepted(validInput("L20"));
  await expectRejection(
    "InsufficientEvidence",
    withLanding({ shaDisplayed: `${"a".repeat(39)}b` }),
    { because: "displayed a SHA that is not the candidate" },
  );
});
