import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PhaseSummary, SessionCard } from "../../../dashboard/shared/types.ts";
import {
  classifyFailure,
  failureCodes,
  failureCounts,
  FAILURE_CLASSES,
  runFailures,
} from "../../../dashboard/src/run-failures.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function phase(key: string, ordinal: number, status: string, code: string | null, message: string | null = null): PhaseSummary {
  return {
    phaseId: `s:${key}`, key, ordinal, name: key, kind: "agent", owner: "builder",
    description: key, status, correctionCount: 0, maxCorrections: 0,
    error: code === null && message === null ? null : { code, message },
    startedAt: `2026-09-0${ordinal}T00:00:00.000Z`, endedAt: `2026-09-0${ordinal}T01:00:00.000Z`,
    createdAt: `2026-09-0${ordinal}T00:00:00.000Z`,
  } as unknown as PhaseSummary;
}

function run(sessionId: string, state: string, phases: readonly PhaseSummary[]): SessionCard {
  return {
    sessionId, taskId: `task-${sessionId}`, workflowId: "build-review", state, phases,
  } as unknown as SessionCard;
}

test("a provider refusing to serve is not a harness defect", () => {
  // Both AdapterErrors on the owner's projection are quota, verbatim: "You have
  // hit your ChatGPT usage limit (plus plan). Try again in ~155 min.
  // (E_QUOTA_EXHAUSTED)". Counting that as machinery breaking would be wrong —
  // nothing was wrong with the work and the response is to wait or re-route,
  // which is a different answer from every other class here.
  assert.equal(classifyFailure("AdapterError", "pi-codex: Codex error: The usage limit has been reached (E_QUOTA_EXHAUSTED)"), "quota");
  assert.equal(classifyFailure("AdapterError", "You have hit your ChatGPT usage limit (plus plan). Try again in ~155 min."), "quota");
  // The adapter reports real transport faults through the same class, so the
  // class alone cannot separate them and the message has to.
  assert.equal(classifyFailure("AdapterError", "pi-codex: socket hang up"), "harness");
});

test("the three kinds of failure that demand different answers stay apart", () => {
  for (const code of ["PhaseGateFailure", "CommandPhaseFailure", "EnvelopeValidationFailure"]) {
    assert.equal(classifyFailure(code), "refusal", code);
  }
  for (const code of ["ReplacementReviewInconsistent", "ReplacementReviewMalformed", "OwnerReworkCredentialRejected", "ReviewEvidenceUnfit"]) {
    assert.equal(classifyFailure(code), "review", code);
  }
  for (const code of ["ExecutableNotFound", "PermissionBreach"]) {
    assert.equal(classifyFailure(code), "harness", code);
  }
});

test("a failure this dashboard has not been taught to read is shown, never guessed at", () => {
  // The codes are `Error` subclass NAMES thrown from production-run.ts, not a
  // designed vocabulary — core has one of those but it never reaches the
  // projection. So new names will appear, and the only safe answer is a bucket
  // that admits it. Both bare `Error`s on the real projection are an ENOENT on
  // a missing placement.yaml, which is exactly the finding this bucket exists
  // to surface rather than bury under a guess.
  assert.equal(classifyFailure("Error", "ENOENT: no such file or directory, open '.../placement.yaml'"), "unclassified");
  assert.equal(classifyFailure("SomethingAddedNextMonth"), "unclassified");
  assert.equal(classifyFailure(null), "unclassified");
  assert.deepEqual([...FAILURE_CLASSES], ["refusal", "review", "quota", "harness", "unclassified"]);
});

test("every failed phase counts, not every blocked run", () => {
  // A run that failed once, corrected and carried on is the factory working,
  // and counting blocked runs would never show it. On the owner's projection
  // one of the twenty-two sits in a run still REVIEWING.
  const sessions = [
    run("a", "BLOCKED", [phase("builder", 1, "SUCCEEDED", null), phase("reviewer", 2, "FAILED", "PhaseGateFailure")]),
    run("b", "REVIEWING", [phase("planner", 1, "FAILED", "EnvelopeValidationFailure"), phase("planner-c1", 2, "SUCCEEDED", null)]),
    run("c", "LANDED", [phase("builder", 1, "SUCCEEDED", null)]),
  ];
  const failures = runFailures(sessions);
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map((held) => held.runState).sort(), ["BLOCKED", "REVIEWING"]);
  assert.deepEqual(failureCounts(failures), { refusal: 2, review: 0, quota: 0, harness: 0, unclassified: 0 });
  // A run with no failed phase contributes nothing rather than an empty row.
  assert.equal(failures.some((held) => held.sessionId === "c"), false);
});

test("the list is newest first and does not reshuffle under a poll", () => {
  const sessions = [
    run("b", "BLOCKED", [phase("reviewer", 2, "FAILED", "AdapterError", "E_QUOTA_EXHAUSTED")]),
    run("a", "BLOCKED", [phase("reviewer", 2, "FAILED", "PermissionBreach")]),
    run("c", "BLOCKED", [phase("tests", 1, "FAILED", "CommandPhaseFailure")]),
  ];
  const failures = runFailures(sessions);
  assert.deepEqual(failures.map((held) => held.sessionId), ["a", "b", "c"]);
  // Two recorded in the same millisecond tie-break on session then ordinal, so
  // the order is the same on every poll rather than however the array arrived.
  assert.deepEqual(runFailures([...sessions].reverse()).map((held) => held.sessionId), ["a", "b", "c"]);
  assert.equal(failures[0]?.recoverable, null, "Task 8 answers this; until it lands it is not known");
});

test("what to go and fix, commonest first", () => {
  const sessions = [
    run("a", "BLOCKED", [phase("x", 1, "FAILED", "PhaseGateFailure")]),
    run("b", "BLOCKED", [phase("x", 1, "FAILED", "PhaseGateFailure")]),
    run("c", "BLOCKED", [phase("x", 1, "FAILED", "CommandPhaseFailure")]),
  ];
  const failures = runFailures(sessions);
  assert.deepEqual(failureCodes(failures, "refusal"), [
    { code: "PhaseGateFailure", count: 2 },
    { code: "CommandPhaseFailure", count: 1 },
  ]);
  assert.deepEqual(failureCodes(failures, "quota"), []);
});

test("the surface reads data already polled, adds no route, and keeps the message behind a click", () => {
  const view = source("dashboard/src/components/RunFailures.vue");
  const grid = source("dashboard/src/components/SessionsGrid.vue");
  // No fetch: `error.code` and `error.message` ride on every phase of the
  // sessions list the board already polls. A new route would also have to get
  // past the read-only route fence.
  assert.doesNotMatch(source("dashboard/src/run-failures.ts"), /fetch\(/u);
  assert.doesNotMatch(view, /fetch\(/u);
  // Fed the whole board, not the filtered set: a failure a filter is hiding is
  // still a failure, and this is the one place that says the factory fell over.
  assert.match(grid, /<RunFailures class="run-failures-area" :sessions="sessions" \/>/u);
  // Closed until asked for, and the message is one more click after that.
  assert.match(view, /const open = ref<FailureClass \| null>\(null\);/u);
  assert.match(view, /<pre v-if="expanded === rowKey\(/u);
  // The empty slot Task 8 fills, said plainly rather than left implying nothing
  // is recoverable.
  assert.match(view, /recoverable: not known until Task 8 lands/u);
  // Scrolling surfaces take the one shared scrollbar treatment.
  const shell = source("dashboard/src/styles/morphism.css");
  assert.match(shell, /\.run-failures-list::-webkit-scrollbar \{|\.run-failures-list::-webkit-scrollbar,/u);
  assert.match(shell, /\.run-failures \{[^}]*grid-area: failures;/su);
  assert.match(shell, /"rail failures workflows"/u);
});
