import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactsExist } from "../../../src/gates/artifacts.ts";

const artifacts = [
  { path: "a.txt", kind: "report" as const, description: "A" },
  { path: "b.txt", kind: "report" as const, description: "B" },
];

test("artifacts_exist positive records size for every artifact", () => {
  const report = artifactsExist(artifacts, () => ({ exists: true, size: 12 }));
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 2);
  assert.match(report.checks[0]!.note, /size=12/);
});

test("artifacts_exist negative does not stop after a missing artifact", () => {
  const report = artifactsExist(artifacts, (path) => ({ exists: path === "b.txt", size: 1 }));
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 2);
  assert.deepEqual(report.checks.map((check) => check.ok), [false, true]);
});
