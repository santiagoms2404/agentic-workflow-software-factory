import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dispatchPointFor,
  occurrenceKeyForAdoption,
  occurrenceKeyForMeasurement,
  occurrenceKeyForRework,
} from "../../../src/workflow/command-ledger-store.ts";

const SHA = "a".repeat(40);
const SESSION = "session-1";

test("dispatch point keys use the same occurrence-key helpers as their writers", () => {
  assert.deepEqual(dispatchPointFor(SESSION, `${SESSION}:adoption-tests`, 0, SHA), {
    dispatcherId: "adopt/adoption-tests",
    occurrenceKey: occurrenceKeyForAdoption(`${SESSION}:adoption-tests`, SHA),
  });
  assert.deepEqual(dispatchPointFor(SESSION, `${SESSION}:owner-rework-2`, 0, SHA), {
    dispatcherId: "rework/owner-gates",
    occurrenceKey: occurrenceKeyForRework("owner-rework-2", SHA),
  });
  assert.deepEqual(dispatchPointFor(SESSION, `${SESSION}:builder-tests`, 3, SHA), {
    dispatcherId: "production-run/measure-candidate",
    occurrenceKey: occurrenceKeyForMeasurement("builder-tests", SHA, 3),
  });
});

test("dispatch point ignores phase evidence from another session", () => {
  assert.equal(dispatchPointFor(SESSION, "other-session:builder-tests", 0, SHA), null);
});
