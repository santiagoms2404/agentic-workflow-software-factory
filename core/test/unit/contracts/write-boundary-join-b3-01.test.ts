// B3-01: every K1 reason is capped at K1_REASON_MAX_LENGTH by the record
// schemas, so a refusal that lists its problems must stay under that cap or
// the refusal itself cannot be journaled.
//
// Under test: verdict() in core/src/preflight/fields.ts and the grant-refused
// reason in core/src/cli/commands/production-run.ts list as many items as fit
// and end the list with an exact count of the ones left out, while a short
// list is spelled in full exactly as before.

import assert from "node:assert/strict";
import { test } from "node:test";
import { grantRefusedReason } from "../../../src/cli/commands/production-run.ts";
import {
  DRIVER_PREFLIGHT_SCHEMA_ID,
  GRANT_REFUSED_SCHEMA_ID,
  K1_FIELD_IDS,
  K1_REASON_MAX_LENGTH,
  assertDriverPreflightRecord,
  assertGrantRefusedRecord,
  boundedJoin,
  k1FieldKind,
  type DriverPreflightRecord,
  type GrantRefusedRecord,
  type K1FieldId,
} from "../../../src/contracts/driver-preflight.ts";
import { evaluateDuplicate, evaluateWriteBoundary, type FieldVerdict } from "../../../src/preflight/fields.ts";
import { k1Request } from "../../fixtures/k1-preflight.ts";

const BASE = "a".repeat(40);
const DIGEST = "b".repeat(64);
const SUFFIX = /… and (\d+) more$/u;

/** `count` distinct, long repository paths outside a shift builder's `core/src/**`. */
function longPaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `specs/unclassified/${"context-".repeat(6)}${String(index).padStart(2, "0")}.html`);
}

function boundary(paths: readonly string[]): FieldVerdict {
  return evaluateWriteBoundary({
    request: k1Request("run selected tickets", "core/src/example.ts"), where: ["core/src/example.ts"], read: [], protectedPaths: [],
    writers: [{ phase: "builder", writes: ["core/src/**"] }],
    shift: { builderWrites: ["core/src/**"], tickets: [{ id: "T02", doBlock: `  Read ${paths.join(" ")} then build core/src/example.ts.\n` }] },
  });
}

function problem(path: string): string {
  return `ticket T02 DO token ${path} is outside what a shift builder can write; classify it with --read if it is only read`;
}

function refusedReason(outcome: FieldVerdict): string {
  assert.equal(outcome.passed, false);
  return outcome.passed ? "" : outcome.reason;
}

function preflightRecord(id: K1FieldId, reason: string): DriverPreflightRecord {
  return {
    schema: DRIVER_PREFLIGHT_SCHEMA_ID, project: "demo", taskId: "T", attempt: 1, sessionId: "session-1", baseSha: BASE,
    configDigest: DIGEST, requestDigest: DIGEST, where: ["core/src/example.ts"], read: [], consulted: [],
    fields: K1_FIELD_IDS.map((field) => field === id
      ? { id: field, kind: k1FieldKind(field), passed: false, reason }
      : { id: field, kind: k1FieldKind(field), passed: true, reason: null }),
    suite: null, protectedPlan: [], at: "2026-10-06T00:00:00.000Z",
  };
}

test("30 long unclassified DO paths give a bounded write-boundary reason ending in the omitted count, and the refusal is a valid record", () => {
  const paths = longPaths(30);
  // The unbounded join is past the cap: this is the case B3-01 found.
  assert.ok(paths.map(problem).join("; ").length > K1_REASON_MAX_LENGTH);
  const reason = refusedReason(boundary(paths));
  assert.ok(reason.length <= K1_REASON_MAX_LENGTH, `reason is ${String(reason.length)} characters`);
  assert.match(reason, SUFFIX);
  assert.doesNotThrow(() => assertDriverPreflightRecord(preflightRecord("write-boundary", reason)));
});

test("the omitted count is exact, the listed problems are the first ones in order, and no further one would fit", () => {
  const paths = longPaths(30);
  const reason = refusedReason(boundary(paths));
  const omitted = Number(SUFFIX.exec(reason)?.[1]);
  const listed = paths.length - omitted;
  assert.ok(listed > 0 && listed < paths.length, `listed ${String(listed)} of ${String(paths.length)}`);
  assert.equal(reason, `${paths.slice(0, listed).map(problem).join("; ")}; … and ${String(omitted)} more`);
  const oneMore = `${paths.slice(0, listed + 1).map(problem).join("; ")}; … and ${String(omitted - 1)} more`;
  assert.ok(oneMore.length > K1_REASON_MAX_LENGTH, "one more problem would still have fit");
});

test("two short unclassified DO paths are listed in full with no count suffix", () => {
  const reason = refusedReason(boundary(["specs/a.html", "specs/b.html"]));
  assert.equal(reason, `${problem("specs/a.html")}; ${problem("specs/b.html")}`);
  assert.doesNotMatch(reason, /more$/u);
});

test("another verdict() evaluator, duplicate, is bounded the same way and stays journalable", () => {
  const others = Array.from({ length: 80 }, (_, index) => ({
    taskId: `task-${"duplicate-".repeat(5)}${String(index).padStart(2, "0")}`, requestDigest: DIGEST, planRef: null, latestState: "PREPARED" as const,
  }));
  const reason = refusedReason(evaluateDuplicate({ taskId: "T", chain: [], requestDigest: DIGEST, planRef: null, others }));
  assert.ok(reason.length <= K1_REASON_MAX_LENGTH, `reason is ${String(reason.length)} characters`);
  const omitted = Number(SUFFIX.exec(reason)?.[1]);
  assert.equal((reason.match(/already carries the same request/gu) ?? []).length + omitted, others.length);
  assert.doesNotThrow(() => assertDriverPreflightRecord(preflightRecord("duplicate", reason)));
});

function grantRecord(reason: string, paths: readonly string[]): GrantRefusedRecord {
  return { schema: GRANT_REFUSED_SCHEMA_ID, project: "demo", taskId: "T", attempt: 1, sessionId: "session-1", phase: "builder",
    paths: [...paths], grantId: null, boundary: "before-l4", callsSpent: 0, preflightAt: "2026-10-06T00:00:00.000Z", reason,
    at: "2026-10-06T00:00:01.000Z" };
}

test("a long planned-path list gives a bounded grant-refused reason with an exact omitted count, and the record validates", () => {
  const paths = Array.from({ length: 200 }, (_, index) => `core/src/state/${"protected-".repeat(4)}${String(index).padStart(3, "0")}.ts`);
  const reason = grantRefusedReason({ phase: "builder", paths, grantId: null });
  assert.ok(reason.length <= K1_REASON_MAX_LENGTH, `reason is ${String(reason.length)} characters`);
  const match = /, … and (\d+) more and no grant for it is recorded$/u.exec(reason);
  assert.ok(match !== null, reason.slice(-120));
  const omitted = Number(match[1]);
  assert.ok(reason.startsWith(`phase builder writes planned protected path(s) ${paths.slice(0, paths.length - omitted).join(", ")}, … and`));
  assert.doesNotThrow(() => assertGrantRefusedRecord(grantRecord(reason, paths)));
});

test("a short planned-path list keeps the grant-refused reason spelled in full", () => {
  assert.equal(grantRefusedReason({ phase: "builder", paths: ["core/src/state/a.ts", "core/src/state/b.ts"], grantId: "grant-1" }),
    "phase builder writes planned protected path(s) core/src/state/a.ts, core/src/state/b.ts and its recorded grant grant-1 covers none of them");
});

test("boundedJoin keeps a list that fits, and otherwise ends with the exact count of what it left out", () => {
  const items = ["alpha", "beta", "gamma-delta-epsilon-zeta"];
  assert.equal(boundedJoin(items, ", ", 37), "alpha, beta, gamma-delta-epsilon-zeta");
  assert.equal(boundedJoin(items, ", ", 30), "alpha, beta, … and 1 more");
  assert.equal(boundedJoin(items, ", ", 24), "alpha, … and 2 more");
  assert.equal(boundedJoin(items, ", ", 15), "… and 3 more");
  assert.equal(boundedJoin([], ", ", 10), "");
});
