import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../../../src/policy/risk.ts";

const policy = {
  default: "T0" as const,
  paths: {
    "dashboard/**": "T1" as const,
    "core/src/**": "T1" as const,
    "core/src/policy/**": "T2" as const,
  },
};

test("risk.paths chooses the highest tier matched by any changed path", () => {
  const result = classifyRisk(["dashboard/App.vue", "core/src/policy/risk.ts"], policy);
  assert.equal(result.tier, "T2");
  assert.equal(result.source, "path");
  assert.deepEqual(result.matched.map((match) => match.tier), ["T1", "T2", "T1"]);
});

test("unmatched paths use the configured default", () => {
  assert.deepEqual(classifyRisk(["README.md"], policy), {
    tier: "T0",
    source: "default",
    matched: [],
    classifiedTier: "T0",
  });
});

test("an explicit operator override wins and requires an auditable reason", () => {
  const result = classifyRisk(["core/src/policy/risk.ts"], policy, {
    tier: "T1",
    reason: "owner reviewed the bounded change",
  });
  assert.equal(result.tier, "T1");
  assert.equal(result.classifiedTier, "T2");
  assert.equal(result.source, "operator-override");
  assert.throws(() => classifyRisk(["README.md"], policy, { tier: "T2", reason: " " }));
});
