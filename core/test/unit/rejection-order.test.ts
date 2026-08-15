// T4 — the ordered rejection contract.
//
// "A rejection must name the REAL defect, or fixing what it named would let an
// illegitimate transition through." So the order is not a nicety: for every
// adjacent pair of the eleven rejections there is an input that violates both,
// and the earlier one must fire.
//
// Ten adjacencies, each with a purpose-built double violation, plus the
// single-violation inputs that prove all eleven are reachable at all, plus
// non-adjacent spot checks for transitivity.
//
// RED until T5 writes `core/src/state/{task-machine,errors}.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { REJECTION_ORDER, type RejectionName } from "./_lifecycle-tables.ts";
import {
  BASE_SHA,
  CANDIDATE_SHA,
  budget,
  expectRejection,
  inputFor,
  matrixInput,
  styleNote,
  validInput,
  withBudget,
  withEvidence,
  withReason,
  type TransitionInput,
} from "./_lifecycle-harness.ts";

test("the rejection contract is eleven ordered steps, two of them scoped", () => {
  assert.equal(REJECTION_ORDER.length, 11);
  assert.deepEqual(
    REJECTION_ORDER.map((r) => r.step),
    Array.from({ length: 11 }, (_, i) => i + 1),
  );
  const scoped = REJECTION_ORDER.filter((r) => r.error === "CorrectionAllowanceExhausted");
  assert.deepEqual(scoped.map((r) => [r.step, r.scope]), [[6, "global"], [9, "tranche"]]);
});

// ---------------------------------------------------------------------------
// The ten adjacencies.
// ---------------------------------------------------------------------------

test("1 before 2 — conversational evidence out of a sealed attempt is an evidence complaint", async () => {
  // If a fabricated source could reach the terminal check, a well-formed lie
  // would be indistinguishable from a real one at every later step.
  await expectRejection(
    "NonDeterministicEvidence",
    { ...matrixInput("LANDED", "PREPARED"), reason: { source: "conversation", detail: "the agent said it recovered" } },
    { because: "step 1 outranks step 2" },
  );
});

test("2 before 3 — a sealed attempt hears 'this attempt is over', except when it is standing still", async () => {
  // THE ONE PLACE THE PLAN'S TWO NORMATIVE TABLES DISAGREE.
  //
  // Read literally, step 2 ("from-state is BLOCKED / LANDED / CANCELLED")
  // would swallow the three terminal self-pairs and make the class counts
  // 30 TerminalAttempt / 7 AlreadyInState. The class table says 27 / 10, with
  // the arithmetic spelled out ("3 × 9", "all ten X → X pairs"), and 75 only
  // decomposes as 27 + 10 + 6 + 32 under that reading — which is also the
  // split the T4 checklist, the acceptance checklist and the build prompt all
  // repeat. So step 2 is read as narrowed to `from` terminal AND `from !== to`,
  // and this test pins the narrowing rather than leaving T5 to guess.
  for (const terminal of ["BLOCKED", "LANDED", "CANCELLED"] as const) {
    await expectRejection("TerminalAttempt", matrixInput(terminal, "DRAFT"), {
      because: "step 2 governs every non-self pair out of a terminal state",
    });
    await expectRejection("AlreadyInState", matrixInput(terminal, terminal), {
      because: "the class table counts terminal self-pairs among the ten, not the twenty-seven",
    });
  }
});

test("3 before 4 — 'you are already there' outranks the human-gate complaint", async () => {
  // LANDED → LANDED is both a self-transition and a target of LANDED from
  // something that is not LANDING. The self-transition is the truer complaint:
  // nothing is trying to land, the caller is looping.
  await expectRejection("AlreadyInState", matrixInput("LANDED", "LANDED"), {
    because: "step 3 outranks step 4",
  });
});

test("4 before 5 — an attempt to land names the violated invariant, not the unknown pair", async () => {
  // DRAFT → LANDED is not on the 24, so step 5 applies too. An automation bug
  // that tries to land must be identified as exactly that.
  await expectRejection("HumanGateBypass", matrixInput("DRAFT", "LANDED"), {
    because: "step 4 outranks step 5",
  });
});

test("5 before 6 — an illegal pair dressed as an exhausted correction still hears 'illegal pair'", async () => {
  // Every field says "inter-state correction with the budget gone": target
  // RUNNING, a declared spawn, an owner actor, both tranches spent. But
  // LANDING → RUNNING is not one of the 24, and that is the real defect —
  // restoring budget would not make this legal.
  const input: TransitionInput = {
    ...matrixInput("LANDING", "RUNNING"),
    actor: "owner",
    spawn: { cost: 1 },
    budget: budget({ correctionsAuto: 1, ownerReentries: 1 }),
  };
  await expectRejection("IllegalTransition", input, { because: "step 5 outranks step 6" });
});

test("6 before 7 — a spent global budget outranks actor legitimacy", async () => {
  // L16 by the host is an actor violation AND the whole correction budget is
  // gone. Reporting ActorNotPermitted first would invite switching actors,
  // which cannot help: no actor can restore a spent global budget.
  await expectRejection(
    "CorrectionAllowanceExhausted",
    { ...validInput("L16"), actor: "host", budget: budget({ callsSpent: 2, correctionsAuto: 1, ownerReentries: 1 }) },
    { scope: "global", because: "step 6 outranks step 7" },
  );
});

test("7 before 8 — the wrong actor outranks the wrong medium", async () => {
  // The host attempting `awsf land` from a non-interactive session violates
  // both. "You may never do this" beats "come to a terminal": telling the host
  // to find a TTY would be telling it to try harder at something forbidden.
  await expectRejection(
    "ActorNotPermitted",
    inputFor("L20", { actor: "host", interactive: false }),
    { because: "step 7 outranks step 8" },
  );
});

test("8 before 9 — the wrong medium outranks the actor's own spent tranche", async () => {
  // L19 is a human edge. Piped stdin plus a spent owner tranche: the human
  // must hear "come to a terminal" first, because the tranche complaint is
  // only meaningful once the request can be made at all.
  await expectRejection(
    "InteractiveOwnerRequired",
    { ...validInput("L19"), interactive: false, budget: budget({ callsSpent: 1, correctionsAuto: 0, ownerReentries: 1 }) },
    { because: "step 8 outranks step 9" },
  );
});

test("9 before 10 — a spent tranche outranks a critique of the evidence", async () => {
  // The owner's tranche is spent (the automatic one is not, so this is not the
  // global complaint) AND the correction carries no output. Naming the
  // evidence first would make fabricating output look like the fix.
  const base = validInput("L10");
  const input: TransitionInput = {
    ...base,
    actor: "owner",
    reason: { source: "gate", command: ["npm", "run", "test:unit"] },
    budget: budget({ correctionsAuto: 0, ownerReentries: 1 }),
  };
  await expectRejection("CorrectionAllowanceExhausted", input, {
    scope: "tranche",
    because: "step 9 outranks step 10",
  });
});

test("10 before 11 — a defective request is named before its price", async () => {
  // L4 with no compiled workflow, at the T1 ceiling. The ceiling must not mask
  // a defect the evidence check would have named: its remedy is economic, and
  // buying a new attempt would not fix an uncompiled workflow.
  const input: TransitionInput = {
    ...withEvidence("L4", { workflowCompiled: false }),
    budget: budget({ callsSpent: 3 }),
  };
  await expectRejection("InsufficientEvidence", input, { because: "step 10 outranks step 11" });
});

// ---------------------------------------------------------------------------
// Reachability — every step fires when it alone is violated.
// ---------------------------------------------------------------------------

test("each of the eleven rejections is reachable on its own", async () => {
  const cases: readonly {
    step: number;
    error: RejectionName;
    scope?: "global" | "tranche";
    input: TransitionInput;
  }[] = [
    { step: 1, error: "NonDeterministicEvidence", input: withReason("L1", { source: "model" }) },
    { step: 2, error: "TerminalAttempt", input: matrixInput("LANDED", "PREPARED") },
    { step: 3, error: "AlreadyInState", input: matrixInput("RUNNING", "RUNNING") },
    { step: 4, error: "HumanGateBypass", input: matrixInput("AWAITING_OWNER", "LANDED") },
    { step: 5, error: "IllegalTransition", input: matrixInput("DRAFT", "RUNNING") },
    {
      step: 6,
      error: "CorrectionAllowanceExhausted",
      scope: "global",
      input: withBudget("L10", { correctionsAuto: 1, ownerReentries: 1 }),
    },
    { step: 7, error: "ActorNotPermitted", input: inputFor("L16", { actor: "host" }) },
    { step: 8, error: "InteractiveOwnerRequired", input: inputFor("L20", { interactive: false }) },
    {
      step: 9,
      error: "CorrectionAllowanceExhausted",
      scope: "tranche",
      input: withBudget("L10", { correctionsAuto: 1, ownerReentries: 0 }),
    },
    { step: 10, error: "InsufficientEvidence", input: withEvidence("L7", { candidateSha: BASE_SHA }) },
    { step: 11, error: "CallCeilingExceeded", input: withBudget("L4", { callsSpent: 3 }) },
  ];

  assert.equal(cases.length, 11);
  const failures: string[] = [];
  for (const testCase of cases) {
    try {
      await expectRejection(testCase.error, testCase.input, {
        ...(testCase.scope ? { scope: testCase.scope } : {}),
        because: `step ${testCase.step} in isolation`,
      });
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// Transitivity — the order is total, not merely locally sorted.
// ---------------------------------------------------------------------------

test("the order holds across non-adjacent pairs too", async () => {
  const failures: string[] = [];
  const cases: readonly {
    label: string;
    error: RejectionName;
    scope?: "global" | "tranche";
    input: TransitionInput;
  }[] = [
    {
      label: "1 over 5 — a fabricated source on an illegal pair",
      error: "NonDeterministicEvidence",
      input: { ...matrixInput("DRAFT", "GATING"), reason: { source: "assistant" } },
    },
    {
      label: "1 over 10 — a fabricated source with a candidate SHA equal to base",
      error: "NonDeterministicEvidence",
      input: { ...withEvidence("L7", { candidateSha: BASE_SHA }), reason: { source: "transcript" } },
    },
    {
      label: "1 over 11 — a fabricated source at the ceiling",
      error: "NonDeterministicEvidence",
      input: { ...withBudget("L4", { callsSpent: 3 }), reason: { source: "llm" } },
    },
    {
      label: "2 over 5 — a terminal source on an illegal pair",
      error: "TerminalAttempt",
      input: matrixInput("LANDED", "RUNNING"),
    },
    {
      label: "5 over 10 — an illegal pair with unusable evidence",
      error: "IllegalTransition",
      input: { ...matrixInput("REVIEWING", "GATING"), evidence: { candidateSha: "not-a-sha" } },
    },
    {
      label: "6 over 11 — a spent global budget at the ceiling",
      error: "CorrectionAllowanceExhausted",
      scope: "global",
      input: withBudget("L10", { callsSpent: 3, correctionsAuto: 1, ownerReentries: 1 }),
    },
    {
      label: "7 over 10 — the wrong actor holding only a style note",
      error: "ActorNotPermitted",
      // T5 fix: `actor: "host"` was missing. `withEvidence` keeps the L16
      // fixture's actor, which is `owner` — the one actor L16 permits — so as
      // written the case carried no actor violation at all and could only ever
      // have produced the step-10 complaint it is here to outrank.
      input: {
        ...withEvidence("L16", {
          review: { verdict: "concern", reviewedSha: CANDIDATE_SHA, findings: [styleNote()] },
        }),
        actor: "host",
      },
    },
    {
      label: "7 over 11 — the wrong actor at the ceiling",
      error: "ActorNotPermitted",
      input: { ...inputFor("L16", { actor: "host" }), budget: budget({ callsSpent: 5 }) },
    },
    {
      label: "8 over 10 — no TTY and an unconfirmed landing",
      error: "InteractiveOwnerRequired",
      input: {
        ...inputFor("L20", { interactive: false }),
        evidence: {
          ...validInput("L20").evidence,
          landing: { ...validInput("L20").evidence!.landing!, confirmed: false },
        },
      },
    },
    {
      label: "9 over 11 — a spent tranche at the ceiling",
      error: "CorrectionAllowanceExhausted",
      scope: "tranche",
      input: withBudget("L10", { callsSpent: 3, correctionsAuto: 1, ownerReentries: 0 }),
    },
  ];

  for (const testCase of cases) {
    try {
      await expectRejection(testCase.error, testCase.input, {
        ...(testCase.scope ? { scope: testCase.scope } : {}),
        because: testCase.label,
      });
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
});
