import { test } from "node:test";
import assert from "node:assert/strict";
import { CallCeilingExceeded } from "../../src/state/errors.ts";
import { MAX_CALL_CEILING } from "../../src/state/tiers.ts";
import {
  assertShiftAdmission,
  assessShiftAdmission,
  parseMilestoneSelection,
  raiseActsNeeded,
  shiftPlanReadout,
  type ShiftAdmission,
} from "../../src/cli/commands/shift.ts";

// The plan's own ticket-count table (specs/awsf-v2-w17-shift.html, milestone
// M3), reproduced whole as test cases. `minimumCalls` is always N + 1; the
// tier is T2, whose default ceiling is 5 — the same default every shipped
// review-bearing recipe already runs at.

const T2 = 2 as const;

test("N=1..3: fits T2's default ceiling with headroom, no raise needed", () => {
  for (const n of [1, 2, 3]) {
    const admission = assessShiftAdmission(n + 1, T2);
    assert.equal(admission.minimumCalls, n + 1);
    assert.equal(admission.ceiling, 5);
    assert.equal(admission.fits, true);
    assert.equal(admission.headroom, 5 - (n + 1));
    assert.ok(admission.headroom > 0, `N=${n} should leave headroom`);
    assert.equal(admission.coldCorrectionExhausted, false);
    assert.equal(admission.raise, null);
    assert.equal(admission.unfundable, false);
  }
});

test("N=4: fits exactly, zero headroom, the cold-correction consequence fires", () => {
  const admission = assessShiftAdmission(5, T2);
  assert.equal(admission.minimumCalls, 5);
  assert.equal(admission.ceiling, 5);
  assert.equal(admission.fits, true);
  assert.equal(admission.headroom, 0);
  assert.equal(admission.coldCorrectionExhausted, true);
  assert.equal(admission.raise, null);
  assert.equal(admission.unfundable, false);
});

test("N=5..6: does not fit; one raise act (5 -> 10) admits it with room to spare", () => {
  for (const n of [5, 6]) {
    const admission = assessShiftAdmission(n + 1, T2);
    assert.equal(admission.fits, false);
    assert.equal(admission.unfundable, false);
    assert.deepEqual(admission.raise, { acts: 1, finalCeiling: 10 });
    assert.equal(admission.coldCorrectionExhausted, false);
  }
});

test("N=19: does not fit; three raise acts (5 -> 20) admit it at zero headroom", () => {
  const admission = assessShiftAdmission(20, T2);
  assert.equal(admission.fits, false);
  assert.equal(admission.unfundable, false);
  assert.deepEqual(admission.raise, { acts: 3, finalCeiling: 20 });
  // 20 is exactly MAX_CALL_CEILING, so this is also the hard maximum for one shift.
  assert.equal(admission.raise!.finalCeiling, MAX_CALL_CEILING);
  assert.equal(admission.coldCorrectionExhausted, true);
});

test("N=31: refused for exceeding MAX_CALL_CEILING, not for exceeding a tier", () => {
  const admission = assessShiftAdmission(32, T2);
  assert.equal(admission.fits, false);
  assert.equal(admission.unfundable, true);
  assert.equal(admission.raise, null);
});

test("raiseActsNeeded: exact multiples, a remainder, and past the bound", () => {
  assert.deepEqual(raiseActsNeeded(5, 5), { acts: 0, finalCeiling: 5 });
  assert.deepEqual(raiseActsNeeded(5, 6), { acts: 1, finalCeiling: 10 });
  assert.deepEqual(raiseActsNeeded(5, 20), { acts: 3, finalCeiling: 20 });
  assert.equal(raiseActsNeeded(5, 21), null);
});

test("assertShiftAdmission is a no-op when the selection fits", () => {
  assert.doesNotThrow(() => assertShiftAdmission(assessShiftAdmission(4, T2), "shift x --milestone M1"));
});

test("assertShiftAdmission distinguishes a fundable refusal from an unfundable one", () => {
  let fundable: CallCeilingExceeded | undefined;
  try {
    assertShiftAdmission(assessShiftAdmission(6, T2), "shift x --milestone M1,M2");
  } catch (error) {
    fundable = error as CallCeilingExceeded;
  }
  assert.ok(fundable instanceof CallCeilingExceeded);
  assert.match(fundable!.message, /awsf raise act\(s\)/);
  assert.doesNotMatch(fundable!.message, /no awsf raise act, however many/);

  let unfundable: CallCeilingExceeded | undefined;
  try {
    assertShiftAdmission(assessShiftAdmission(32, T2), "shift x --milestone M1,...,M9");
  } catch (error) {
    unfundable = error as CallCeilingExceeded;
  }
  assert.ok(unfundable instanceof CallCeilingExceeded);
  assert.match(unfundable!.message, /no awsf raise act, however many, can fund this shift/);
  assert.match(unfundable!.message, /MAX_CALL_CEILING \(20\)/);
});

test("parseMilestoneSelection: comma-separated and repeated flags spell one ordered list", () => {
  assert.deepEqual(parseMilestoneSelection(["M4,M5,M6"]), ["M4", "M5", "M6"]);
  assert.deepEqual(parseMilestoneSelection(["M4", "M5", "M6"]), ["M4", "M5", "M6"]);
  assert.deepEqual(parseMilestoneSelection(["M4,M5", "M6"]), ["M4", "M5", "M6"]);
  assert.deepEqual(parseMilestoneSelection([" M4 , M5 "]), ["M4", "M5"]);
});

test("shiftPlanReadout prints the readout before any admission is asserted", () => {
  const admission: ShiftAdmission = assessShiftAdmission(5, T2);
  const lines = shiftPlanReadout({
    plan: "awsf-v2-w07-quota-telemetry",
    milestones: ["M4"],
    tickets: [
      { id: "T14", title: "one" },
      { id: "T15", title: "two" },
      { id: "T16", title: "three" },
      { id: "T17", title: "four" },
    ],
    admission,
  });
  assert.ok(lines.some((line) => line.includes("minimumCalls = 4 + 1 = 5")));
  assert.ok(lines.some((line) => line.includes("T17")));
  assert.ok(lines.some((line) => line.includes("cold-correction consequence")));
});
