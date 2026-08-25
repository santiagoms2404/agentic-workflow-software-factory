import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { observedPhaseDurationMedian } from "../../../src/observability/queries.ts";
import { renderObservedDurationComparison } from "../../../src/quota/readout.ts";

function seeded(durations: readonly number[], crashed = false) {
  const db = openDatabase(":memory:");
  db.prepare(`INSERT INTO sessions
    (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
     lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
    VALUES ('s','p','T',1,'w',1,0,'RUNNING','request',3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','{}','journal')`).run();
  const insert = db.prepare(`INSERT INTO phases
    (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status, started_at, ended_at, created_at)
    VALUES (?, 's', ?, 'build', 'Build', 'code', 'host', '', ?, ?, ?, ?)`);
  durations.forEach((minutes, index) => {
    const start = Date.parse("2026-01-01T00:00:00Z") + index * 3_600_000;
    insert.run(`p${index}`, index + 1, "SUCCEEDED", new Date(start).toISOString(), new Date(start + minutes * 60_000).toISOString(), new Date(start).toISOString());
  });
  if (crashed) insert.run("crashed", durations.length + 1, "FAILED", "2026-01-02T00:00:00Z", null, "2026-01-02T00:00:00Z");
  return db;
}

test("four observations are insufficient and five expose count and median", () => {
  const four = seeded([1, 2, 3, 4]);
  assert.deepEqual(observedPhaseDurationMedian(four, "build"), { status: "insufficient-history", count: 4 });
  four.close();
  const five = seeded([1, 2, 3, 4, 9]);
  assert.deepEqual(observedPhaseDurationMedian(five, "build"), { status: "observed", durationMinutes: 3, count: 5 });
  five.close();
});

test("even and odd completed histories use the expected median, excluding a crashed phase", () => {
  const odd = seeded([1, 9, 3, 7, 5], true);
  assert.deepEqual(observedPhaseDurationMedian(odd, "build"), { status: "observed", durationMinutes: 5, count: 5 });
  odd.close();
  const even = seeded([2, 8, 4, 6, 10, 12]);
  assert.deepEqual(observedPhaseDurationMedian(even, "build"), { status: "observed", durationMinutes: 7, count: 6 });
  even.close();
});

test("the advisory comparison has three verdicts and thin history never falls back", () => {
  assert.equal(renderObservedDurationComparison(10, { status: "observed", durationMinutes: 8, count: 5 }), "observed duration=fits (median=8 minutes, count=5)");
  assert.equal(renderObservedDurationComparison(7, { status: "observed", durationMinutes: 8, count: 5 }), "observed duration=does not fit (median=8 minutes, count=5)");
  assert.equal(renderObservedDurationComparison(1, { status: "insufficient-history", count: 4 }), "observed duration=insufficient history (count=4)");
});
