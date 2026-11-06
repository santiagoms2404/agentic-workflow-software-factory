import assert from "node:assert/strict";
import { test } from "node:test";
import { CallCeilingExceeded } from "../../../src/state/errors.ts";
import { PhaseSilenceTimeout, persistedPhaseBlocker, phaseBlocker } from "../../../src/cli/commands/phase-blocker.ts";

const ceilingFailure = new CallCeilingExceeded({
  from: null,
  to: null,
  subject: "phase admission",
  tier: 1,
  ceiling: 3,
  requested: 1,
  committed: 3,
});

test("host-owned budget and silence failures classify by type", () => {
  assert.equal(phaseBlocker(ceilingFailure, "call limit reached")?.code, "budget-exhausted");
  assert.equal(phaseBlocker(new PhaseSilenceTimeout(), "configured silence timeout elapsed")?.code, "silence");
});

test("provider wording cannot select budget or silence blocker codes", () => {
  assert.equal(phaseBlocker(new Error("provider reported a budget timeout"), "provider reported a budget timeout"), null);
  assert.equal(phaseBlocker(new Error("backend allowance unavailable"), "backend allowance unavailable"), null);
});

test("recovery classifies the persisted host failure name rather than its message", () => {
  assert.equal(persistedPhaseBlocker("CallCeilingExceeded", "call budget detail")?.code, "budget-exhausted");
  assert.equal(persistedPhaseBlocker("PhaseSilenceTimeout", "no output detail")?.code, "silence");
  assert.equal(persistedPhaseBlocker("Error", "provider timeout detail"), null);
});
