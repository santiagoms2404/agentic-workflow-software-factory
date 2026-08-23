import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
  INVARIANT_IDENTIFIER_PATTERN,
} from "../../../src/registry/plan-spine.ts";
import {
  PlanIdentifierGrammarError,
  parseAwsfPlanHtmlV1,
} from "../../../src/registry/plan-source.ts";

function planWithSpine(spine: string, claims = ""): string {
  return `<section id="spine"><dl>${spine}</dl></section>
<section>
<h3><code class="status">[]</code> Milestone M1: Grammar</h3>
<h4>1. Parse identifiers</h4>
${claims}
<ul><li><code class="status">[]</code> Complete</li></ul>
</section>`;
}

test("the plan identifier patterns require a positive integer without a leading zero", () => {
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.source, "^INV-[1-9][0-9]*$");
  assert.equal(ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.source, "^AC-[1-9][0-9]*$");
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.test("INV-1"), true);
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.test("INV-01"), false);
  assert.equal(ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.test("AC-0"), false);
});

test("the v1 parser carries spine declarations and local or qualified task claims", () => {
  const parsed = parseAwsfPlanHtmlV1(planWithSpine(
    `<dt><code class="inv">INV-1</code></dt><dd>State stays pure.</dd>
<dt><code class="ac">AC-1</code></dt><dd>A dropped criterion fails.</dd>`,
    `<p class="serves"><code class="serves">INV-1</code>
<code class="serves">other-plan#AC-2</code></p>`,
  ), "spine-fixture");

  assert.deepEqual(parsed.declarations, [
    { id: "INV-1", statement: "State stays pure." },
    { id: "AC-1", statement: "A dropped criterion fails." },
  ]);
  assert.deepEqual(parsed[0]?.serves, ["INV-1", "other-plan#AC-2"]);
  assert.equal(Object.isFrozen(parsed.declarations), true);
  assert.equal(Object.isFrozen(parsed[0]?.serves), true);
});

test("a malformed identifier fails by plan and offending string", () => {
  assert.throws(
    () => parseAwsfPlanHtmlV1(planWithSpine(
      `<dt><code class="inv">INV-01</code></dt><dd>Invalid leading zero.</dd>`,
    ), "malformed-plan"),
    (error: unknown) => {
      assert.ok(error instanceof PlanIdentifierGrammarError);
      assert.equal(error.code, "E_PLAN_IDENTIFIER_GRAMMAR");
      assert.equal(error.plan, "malformed-plan");
      assert.equal(error.identifier, "INV-01");
      assert.match(error.message, /INV-01/u);
      return true;
    },
  );
});

test("declarations reject gaps, qualification, and empty statements", () => {
  const invalidSpines = [
    `<dt><code class="ac">AC-1</code></dt><dd>First.</dd>
<dt><code class="ac">AC-3</code></dt><dd>Gap.</dd>`,
    `<dt><code class="inv">other-plan#INV-1</code></dt><dd>Qualified.</dd>`,
    `<dt><code class="ac">AC-1</code></dt><dd> </dd>`,
  ];

  for (const spine of invalidSpines) {
    assert.throws(
      () => parseAwsfPlanHtmlV1(planWithSpine(spine), "invalid-spine"),
      PlanIdentifierGrammarError,
    );
  }
});

test("a malformed task claim is a hard parse failure", () => {
  assert.throws(
    () => parseAwsfPlanHtmlV1(planWithSpine(
      `<dt><code class="ac">AC-1</code></dt><dd>Criterion.</dd>`,
      `<code class="serves">AC-01</code>`,
    ), "malformed-claim"),
    (error: unknown) => {
      assert.ok(error instanceof PlanIdentifierGrammarError);
      assert.equal(error.identifier, "AC-01");
      return true;
    },
  );
});
