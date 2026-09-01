import { test } from "node:test";
import assert from "node:assert/strict";
import { admitRisk, classifyRisk } from "../../../src/policy/risk.ts";
import { riskTierSufficient } from "../../../src/gates/risk.ts";

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

test("risk.paths admits or refuses an attempt by tier, which is the reader it never had", () => {
  const live = { default: "T1" as const, paths: {
    "core/src/state/**": "T2" as const,
    "dashboard/**": "T1" as const,
  } };

  // T1 attempt, T2 path: refused, and the glob that raised it is named.
  const refused = admitRisk(["core/src/state/task-machine.ts", "README.md"], 1, live);
  assert.equal(refused.sufficient, false);
  assert.equal(refused.classified, "T2");
  assert.deepEqual(refused.raisedBy, [
    { path: "core/src/state/task-machine.ts", glob: "core/src/state/**", tier: "T2" },
  ]);

  // Same paths at T2: admitted.
  assert.equal(admitRisk(["core/src/state/task-machine.ts"], 2, live).sufficient, true);
  // Nothing matched falls to the default, which a T1 attempt satisfies.
  assert.equal(admitRisk(["README.md"], 1, live).sufficient, true);
  assert.equal(admitRisk(["README.md"], 1, live).classified, "T1");
  // A T0 attempt is below the default, so an unmatched path still refuses.
  assert.equal(admitRisk(["README.md"], 0, live).sufficient, false);

  // Editing the globs changes the outcome — the whole point of the dial.
  assert.equal(admitRisk(["dashboard/App.vue"], 1, live).sufficient, true);
  assert.equal(
    admitRisk(["dashboard/App.vue"], 1, { ...live, paths: { "dashboard/**": "T2" } }).sufficient,
    false,
  );
});

test("the risk gate reports the glob and the retry tier rather than only failing", () => {
  const policy = { default: "T0" as const, paths: { "core/src/policy/**": "T2" as const } };
  const failing = riskTierSufficient(["core/src/policy/risk.ts"], 1, policy, "the plan declares");
  assert.equal(failing.passed, false);
  assert.match(failing.checks[0]?.note ?? "", /core\/src\/policy\/risk\.ts matches core\/src\/policy\/\*\* \(T2\)/u);
  assert.match(failing.checks[0]?.note ?? "", /retry at --tier T2/u);

  const passing = riskTierSufficient(["core/src/policy/risk.ts"], 2, policy, "the candidate changes");
  assert.equal(passing.passed, true);
  assert.match(passing.checks[0]?.note ?? "", /classifies them T2, and the attempt is T2/u);
});
