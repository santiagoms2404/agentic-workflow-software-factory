// B11-06: unsatisfiable event cap must report a truncation notice
//
// When runtime.max_event_count is below MIN_WELL_FORMED_EVENTS (2), the cap cannot
// hold run.started plus a terminal event. The budget spends past the cap to preserve
// terminal settlement and must report the breach via a truncation notice rather than
// silently overrunning without announcement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OutputBudget, MIN_WELL_FORMED_EVENTS } from "../../../src/adapters/stream/output-budget.ts";
import { EventSequencer } from "../../../src/adapters/stream/event-sequencer.ts";

test("B11-06: budget created with unsatisfiable event cap queues a notice and allows claimNotice to report it", () => {
  const budget = new OutputBudget({ maxEventCount: 1 });
  assert.equal(budget.unsatisfiable, true);
  assert.equal(budget.capped, true, "unsatisfiable budget must start capped");

  const notice = budget.claimNotice();
  assert.notEqual(notice, null, "unsatisfiable budget must report a truncation notice");
  assert.equal(notice?.dimension, "events");
  assert.match(notice?.detail ?? "", /max_event_count 1/);
});

test("B11-06: unsatisfiable budget notice is announced only once and cleared", () => {
  const budget = new OutputBudget({ maxEventCount: 1 });
  const first = budget.claimNotice();
  assert.notEqual(first, null);
  assert.equal(budget.claimNotice(), null, "notice must only be announced once");
});

test("B11-06: EventSequencer with unsatisfiable budget emits output-truncated notice upon optional event", () => {
  const budget = new OutputBudget({ maxEventCount: 1 });
  const sequencer = new EventSequencer({
    runId: "run-test-b11-06",
    now: () => "2026-10-18T00:00:00.000Z",
    budget,
  });

  const startEvents = sequencer.started({
    adapter: "test-adapter",
    requestedModel: "test-model",
  });
  assert.equal(startEvents.length, 1);
  assert.equal(startEvents[0]?.kind, "run.started");

  // Attempt to emit optional text; since budget is capped, text is dropped and notice is drained
  const textEvents = sequencer.text("text.delta", "this text should be dropped");
  assert.equal(textEvents.length, 1);
  assert.equal(textEvents[0]?.kind, "notice");
  assert.equal((textEvents[0] as { code?: string }).code, "output-truncated");
});

test("B11-06: floor budget (MIN_WELL_FORMED_EVENTS = 2) remains satisfiable and suppresses notice", () => {
  const budget = new OutputBudget({ maxEventCount: MIN_WELL_FORMED_EVENTS });
  assert.equal(budget.unsatisfiable, false);
  assert.equal(budget.capped, false);
  budget.spend(); // run.started
  assert.equal(budget.offer(), false);
  assert.equal(budget.claimNotice(), null, "floor budget suppresses notice to stay within cap");
});
