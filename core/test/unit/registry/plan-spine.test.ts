import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN,
  INVARIANT_IDENTIFIER_PATTERN,
  spineCoverage,
} from "../../../src/registry/plan-spine.ts";
import {
  PlanIdentifierGrammarError,
  parseAwsfPlanHtmlV1,
} from "../../../src/registry/plan-source.ts";
import { repoRoot } from "../meta/_walk.ts";

function planWithSpine(spine: string, claims = ""): string {
  return `<section id="spine"><dl>${spine}</dl></section>
<section>
<h3><code class="status">[]</code> Milestone M1: Grammar</h3>
<h4>1. Parse identifiers</h4>
${claims}
<ul><li><code class="status">[]</code> Complete</li></ul>
</section>`;
}

function declaration(kind: "inv" | "ac", identifier: string): string {
  return `<dt><code class="${kind}">${identifier}</code></dt><dd>${identifier} statement.</dd>`;
}

function assertIdentifierFailure(
  html: string,
  identifier: string,
  message: RegExp,
): void {
  assert.throws(
    () => parseAwsfPlanHtmlV1(html, "fixture-plan"),
    (error: unknown) => {
      assert.ok(error instanceof PlanIdentifierGrammarError);
      assert.equal(error.identifier, identifier);
      assert.match(error.message, message);
      return true;
    },
  );
}

test("the plan identifier patterns require a positive integer without a leading zero", () => {
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.source, "^INV-[1-9][0-9]*$");
  assert.equal(ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.source, "^AC-[1-9][0-9]*$");
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.test("INV-1"), true);
  assert.equal(INVARIANT_IDENTIFIER_PATTERN.test("INV-01"), false);
  assert.equal(ACCEPTANCE_CRITERION_IDENTIFIER_PATTERN.test("AC-0"), false);
});

test("spineCoverage returns no violations for covered, mirrored, resolvable claims", () => {
  const violations = spineCoverage(
    {
      label: "fixture-plan",
      declarations: [
        { id: "INV-1", statement: "State stays pure." },
        { id: "AC-1", statement: "A dropped criterion fails." },
      ],
    },
    [{ id: "T01", serves: ["INV-1", "AC-1", "other-plan#AC-1"] }],
    [{ id: "T01", serves: ["other-plan#AC-1", "AC-1", "INV-1"] }],
    ["fixture-plan", "other-plan"],
  );

  assert.deepEqual(violations, []);
  assert.equal(Object.isFrozen(violations), true);
});

test("spineCoverage distinguishes all four rules and names the plan and identifier", () => {
  const violations = spineCoverage(
    {
      label: "drifted-plan",
      declarations: [
        { id: "INV-1", statement: "State stays pure." },
        { id: "AC-2", statement: "The declaration sequence has a gap." },
      ],
    },
    [
      { id: "T01", serves: ["INV-1", "AC-9", "missing-plan#AC-1"] },
      { id: "T02", serves: [] },
    ],
    [
      { id: "T01", serves: ["INV-1"] },
      { id: "T02", serves: [] },
    ],
    ["drifted-plan"],
  );

  assert.deepEqual(new Set(violations.map((violation) => violation.rule)), new Set([
    "COVERAGE",
    "ORPHANS",
    "MIRROR",
    "Q5",
  ]));
  assert.ok(violations.every((violation) => violation.message.includes(`drifted-plan/${violation.identifier}`)));
  assert.ok(violations.every((violation) => violation.message.includes(`${violation.rule} rule broken`)));
  assert.ok(violations.some((violation) => violation.rule === "COVERAGE" && violation.identifier === "AC-2"));
  assert.ok(violations.some((violation) => violation.rule === "ORPHANS" && violation.identifier === "AC-9"));
  assert.ok(violations.some((violation) => violation.rule === "MIRROR" && violation.identifier === "T01"));
  assert.ok(violations.some((violation) => violation.rule === "Q5" && violation.identifier === "missing-plan#AC-1"));
  assert.ok(violations.some((violation) => violation.rule === "Q5" && violation.identifier === "AC-2"));
});

test("spineCoverage skips ticket mirroring when the runtime caller has no ticket surface", () => {
  const violations = spineCoverage(
    {
      label: "runtime-plan",
      declarations: [{ id: "AC-1", statement: "The plan carries the criterion." }],
    },
    [{ id: "T01", serves: ["AC-1"] }],
    undefined,
    ["runtime-plan"],
  );

  assert.deepEqual(violations, []);
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

test("refuses INV-01 by name because declarations cannot have a leading zero", () => {
  assertIdentifierFailure(
    planWithSpine(declaration("inv", "INV-01")),
    "INV-01",
    /INV-01.*must match \^INV-\[1-9\]/u,
  );
});

test("refuses a gap between AC-1 and AC-3 and names the missing AC-2", () => {
  assertIdentifierFailure(
    planWithSpine([
      declaration("ac", "AC-1"),
      declaration("ac", "AC-3"),
    ].join("\n")),
    "AC-3",
    /AC declarations must be contiguous from AC-1; expected AC-2/u,
  );
});

test("refuses AC-1 declared twice as a duplicate", () => {
  assertIdentifierFailure(
    planWithSpine([
      declaration("ac", "AC-1"),
      declaration("ac", "AC-1"),
    ].join("\n")),
    "AC-1",
    /AC declarations must be unique/u,
  );
});

test("refuses other-plan#INV-1 because a declaration is never qualified", () => {
  assertIdentifierFailure(
    planWithSpine(declaration("inv", "other-plan#INV-1")),
    "other-plan#INV-1",
    /declarations must match.*must not be qualified/u,
  );
});

test("accepts a plan that declares no identifiers", () => {
  const parsed = parseAwsfPlanHtmlV1(planWithSpine(""), "fixture-plan");

  assert.deepEqual(parsed.declarations, []);
  assert.deepEqual(parsed, [{
    number: 1,
    milestone: "M1",
    milestoneMarker: "",
    checklist: [""],
  }]);
  assert.deepEqual(parsed[0]?.serves, []);
});

interface LegacyParsedPlanTask {
  readonly number: number;
  readonly milestone: string;
  readonly milestoneMarker: string;
  readonly checklist: readonly string[];
}

/** The task-only algorithm from before the additive identifier-spine parser. */
function legacyTaskList(html: string): readonly LegacyParsedPlanTask[] {
  const milestones = [...html.matchAll(/<h3><code class="status">\[([^\]]*)\]<\/code> Milestone (M\d+):/g)];
  const tasks: LegacyParsedPlanTask[] = [];
  for (const [index, milestone] of milestones.entries()) {
    const start = milestone.index;
    const closing = html.indexOf("</section>", start);
    const end = Math.min(milestones[index + 1]?.index ?? html.length, closing === -1 ? html.length : closing);
    const block = html.slice(start, end);
    const heads = [...block.matchAll(/<h4>(\d+)\./g)];
    for (const [headIndex, head] of heads.entries()) {
      const slice = block.slice(head.index, heads[headIndex + 1]?.index ?? block.length);
      const checklist = [...slice.matchAll(/<code class="status">\[([^\]]*)\]<\/code>/g)]
        .map((match) => match[1] ?? "");
      tasks.push({
        number: Number(head[1]),
        milestone: milestone[2] ?? "",
        milestoneMarker: milestone[1] ?? "",
        checklist,
      });
    }
  }
  return tasks.filter((task) => task.number > 0);
}

test("every committed specs plan preserves its pre-spine task list", () => {
  const specs = join(repoRoot(), "specs");
  const planNames = readdirSync(specs)
    .filter((name) => name.endsWith(".html"))
    .sort();
  assert.ok(planNames.length > 0, "specs contains no committed plan HTML files");

  for (const name of planNames) {
    const html = readFileSync(join(specs, name), "utf8");
    assert.deepEqual(parseAwsfPlanHtmlV1(html, name), legacyTaskList(html), name);
  }
});
