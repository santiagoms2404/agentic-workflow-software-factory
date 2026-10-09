import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  planAgreement,
  validTaskClass,
  type AgreementTicket,
  type PlanAgreementInput,
  type PlanAgreementRule,
} from "../../../src/registry/plan-agreement.ts";
import { TICKET_TASK_CLASSES } from "../../../src/contracts/ticket.ts";
import { parseAwsfPlanHtmlV1, type ParsedAwsfPlan, type ParsedPlanTask } from "../../../src/registry/plan-source.ts";
import { repoRoot } from "../meta/_walk.ts";

const LABEL = "fixture-plan";
const RULES: readonly PlanAgreementRule[] = [
  "TICKET_COVERAGE", "MILESTONE", "MILESTONE_STATE", "CHECKLIST", "CHECKLIST_STATE",
  "PROMPT", "DEPENDENCIES", "COMPLETED_DEPENDENCIES", "VOCABULARIES",
  "COVERAGE", "ORPHANS", "MIRROR", "Q5",
];

function parsed(tasks: readonly ParsedPlanTask[], declarations = [{ id: "INV-1", statement: "One rule." }]): ParsedAwsfPlan {
  const out = [...tasks];
  Object.defineProperty(out, "declarations", { value: declarations });
  return Object.freeze(out) as ParsedAwsfPlan;
}

function fixture(): PlanAgreementInput {
  return {
    label: LABEL,
    plan: parsed([
      { number: 1, milestone: "M1", milestoneMarker: "wip", checklist: ["x"], serves: ["INV-1"] },
      { number: 2, milestone: "M1", milestoneMarker: "wip", checklist: ["", "wip"], serves: [] },
    ]),
    tickets: [
      { id: "T01", number: 1, title: "First", milestone: "M1", tier: 1, state: "done", depends_on: [], workflow: "build-review", task_class: undefined, serves: ["INV-1"], prompt: "```\nFirst\n```" },
      { id: "T02", number: 2, title: "Second", milestone: "M1", tier: undefined, state: "todo", depends_on: ["T01"], workflow: undefined, task_class: undefined, serves: undefined, prompt: "```\nSecond\n```" },
    ],
    sectionB: new Map([
      [1, { title: "First", prompt: "```\nFirst\n```" }],
      [2, { title: "Second", prompt: "```\nSecond\n```" }],
    ]),
    knownStems: [LABEL, "other-plan"],
  };
}

function changeTicket(input: PlanAgreementInput, number: number, change: Partial<AgreementTicket>): PlanAgreementInput {
  return { ...input, tickets: input.tickets.map((ticket) => ticket.number === number ? { ...ticket, ...change } : ticket) };
}

function changeTask(input: PlanAgreementInput, number: number, change: Partial<ParsedPlanTask>): PlanAgreementInput {
  return { ...input, plan: parsed(input.plan.map((task) => task.number === number ? { ...task, ...change } : task), [...input.plan.declarations]) };
}

function expectMessages(input: PlanAgreementInput, rule: PlanAgreementRule, messages: readonly string[]): void {
  assert.deepEqual(planAgreement(input, rule).map(({ plan, rule: actualRule, message }) => ({ plan, rule: actualRule, message })),
    messages.map((message) => ({ plan: input.label, rule, message })));
}

for (const rule of RULES) {
  test(`agreement ${rule} accepts the in-memory passing set`, () => {
    expectMessages(fixture(), rule, []);
  });
}

test("all agreement rules compose without mutating caller inputs", () => {
  const input = fixture();
  const before = structuredClone(input);
  for (const ticket of input.tickets) Object.freeze(ticket);
  for (const task of input.plan) Object.freeze(task);
  Object.freeze(input.tickets);
  Object.freeze(input);
  const out = planAgreement(input);
  assert.deepEqual(out, []);
  assert.equal(Object.isFrozen(out), true);
  assert.deepEqual(structuredClone(input), before);
  assert.deepEqual(planAgreement(input), out);
});

test("coverage rejects a gap, unsorted numbers, and an orphan with unchanged diagnostics", () => {
  const input = fixture();
  expectMessages({ ...input, tickets: input.tickets.slice(1) }, "TICKET_COVERAGE", [
    "ticket ids must be T01..Tnn with no gaps", "a plan task below the highest ticket has no ticket",
  ]);
  expectMessages({ ...input, tickets: input.tickets.toReversed() }, "TICKET_COVERAGE", ["ticket ids must be T01..Tnn with no gaps"]);
  expectMessages({ ...input, plan: parsed(input.plan.slice(0, 1)) }, "TICKET_COVERAGE", ["a ticket names a task the plan does not have"]);
});

test("coverage retains a contiguous ticket prefix, including an empty set", () => {
  const input = fixture();
  expectMessages({ ...input, tickets: input.tickets.slice(0, 1) }, "TICKET_COVERAGE", []);
  expectMessages({ ...input, tickets: [] }, "TICKET_COVERAGE", []);
});

test("milestone agreement rejects a different or missing task's milestone", () => {
  expectMessages(changeTicket(fixture(), 2, { milestone: "M2" }), "MILESTONE", [`${LABEL}/T02: ticket says M2, plan says M1`]);
  expectMessages({ ...fixture(), plan: parsed([]) }, "MILESTONE", [
    `${LABEL}/T01: ticket says M1, plan says undefined`, `${LABEL}/T02: ticket says M1, plan says undefined`,
  ]);
});

test("milestone state rejects both checked/not-done and idle/done directions", () => {
  expectMessages(changeTask(fixture(), 2, { milestoneMarker: "x" }), "MILESTONE_STATE", [`${LABEL}/T02: milestone M1 is [x] but ticket is todo`]);
  expectMessages(changeTask(fixture(), 1, { milestoneMarker: "" }), "MILESTONE_STATE", [`${LABEL}/T01: milestone M1 is [] but ticket is done`]);
});

test("milestone state keeps wip and failed markers unconstrained as before", () => {
  for (const milestoneMarker of ["wip", "f"]) {
    expectMessages(changeTask(fixture(), 1, { milestoneMarker }), "MILESTONE_STATE", []);
    expectMessages(changeTask(fixture(), 2, { milestoneMarker }), "MILESTONE_STATE", []);
  }
});

test("checklist presence covers every plan task, even past the ticket prefix", () => {
  const input = changeTask(fixture(), 2, { checklist: [] });
  expectMessages({ ...input, tickets: input.tickets.slice(0, 1) }, "CHECKLIST", [`${LABEL}: task 2 (M1) has no checklist to check state against`]);
});

test("checklist state rejects both all-checked/not-done and unchecked/done directions", () => {
  expectMessages(changeTicket(fixture(), 1, { state: "wip" }), "CHECKLIST_STATE", [`${LABEL}/T01: every plan checklist box is [x] but ticket is wip`]);
  expectMessages(changeTicket(fixture(), 2, { state: "done" }), "CHECKLIST_STATE", [`${LABEL}/T02: ticket is done but the plan still has unchecked boxes`]);
  expectMessages(changeTask(fixture(), 1, { checklist: [] }), "CHECKLIST_STATE", []);
});

test("prompt agreement rejects a missing block, a byte change, and a different title", () => {
  expectMessages({ ...fixture(), sectionB: new Map() }, "PROMPT", [
    `${LABEL}/T01: no Section B block in awsf-plan-build-prompts.md`, `${LABEL}/T02: no Section B block in awsf-plan-build-prompts.md`,
  ]);
  expectMessages(changeTicket(fixture(), 1, { title: "Changed", prompt: "```\nFirst \n```" }), "PROMPT", [
    `${LABEL}/T01: build prompt has drifted from Section B`, `${LABEL}/T01: title differs from its Section B heading`,
  ]);
});

test("dependencies reject missing, self, and later ids but accept existing earlier ids", () => {
  expectMessages(changeTicket(fixture(), 1, { depends_on: ["T03", "T01", "T02"] }), "DEPENDENCIES", [
    `${LABEL}/T01: depends on T03, which does not exist`, `${LABEL}/T01: depends on T01, which is not earlier`, `${LABEL}/T01: depends on T02, which is not earlier`,
  ]);
});

test("completion dependencies reject every unfinished state and missing work", () => {
  for (const state of ["todo", "wip", "failed"]) {
    const input = changeTicket(changeTicket(fixture(), 2, { state: "done" }), 1, { state });
    expectMessages(input, "COMPLETED_DEPENDENCIES", [`${LABEL}/T02 is done but T01 is ${state}`]);
  }
  expectMessages(changeTicket(fixture(), 1, { depends_on: ["T03"] }), "COMPLETED_DEPENDENCIES", [`${LABEL}/T01 is done but T03 is undefined`]);
});

test("only the declared G1 inversion exempts unfinished dependencies, never failed ones", () => {
  const input = fixture();
  const inversion = {
    ...input,
    label: "awsf-v2-plan",
    tickets: [
      { ...input.tickets[0]!, id: "W05", state: "wip" },
      { ...input.tickets[1]!, id: "W06", state: "done", depends_on: ["W05"] },
    ],
  };
  expectMessages(inversion, "COMPLETED_DEPENDENCIES", []);
  expectMessages(changeTicket(inversion, 1, { state: "failed" }), "COMPLETED_DEPENDENCIES", ["awsf-v2-plan/W06 is done but W05 is failed"]);
  expectMessages({ ...inversion, label: LABEL }, "COMPLETED_DEPENDENCIES", [`${LABEL}/W06 is done but W05 is wip`]);
});

const badVocabulary: readonly [Partial<AgreementTicket>, string][] = [
  [{ state: "unknown" }, 'state "unknown"'],
  [{ tier: 3 }, 'tier "3"'],
  [{ workflow: "shift" }, 'workflow "shift"'],
  [{ task_class: null }, "task_class null"],
  [{ serves: ["INV-01"] }, 'serves ["INV-01"]'],
  [{ serves: [1] as unknown as string[] }, "serves [1]"],
  [{ serves: "INV-1" as unknown as string[] }, 'serves "INV-1"'],
  [{ id: "T1" }, "id is not zero-padded Tnn or Wnn"],
];
for (const [change, suffix] of badVocabulary) {
  test(`vocabularies reject ${suffix}`, () => {
    const input = changeTicket(fixture(), 2, change);
    expectMessages(input, "VOCABULARIES", [`${LABEL}/${change.id ?? "T02"}: ${suffix}`]);
  });
}

test("vocabularies retain all allowed values and optional fields", () => {
  for (const state of ["todo", "wip", "done", "failed"]) expectMessages(changeTicket(fixture(), 2, { state }), "VOCABULARIES", []);
  for (const tier of [undefined, 0, 1, 2]) expectMessages(changeTicket(fixture(), 2, { tier }), "VOCABULARIES", []);
  for (const workflow of [undefined, "scout", "plan", "build", "plan-build-test", "build-review", "simple-sdlc", "intake"]) {
    expectMessages(changeTicket(fixture(), 2, { workflow }), "VOCABULARIES", []);
  }
  for (const id of ["T00", "T99", "W01"]) expectMessages(changeTicket(fixture(), 2, { id }), "VOCABULARIES", []);
  for (const task_class of [undefined, ...TICKET_TASK_CLASSES]) {
    assert.equal(validTaskClass(task_class), true);
    expectMessages(changeTicket(fixture(), 2, { task_class }), "VOCABULARIES", []);
  }
  for (const value of [null, 1, [], "", "unknown", [TICKET_TASK_CLASSES[0]]]) assert.equal(validTaskClass(value), false);
  expectMessages(changeTicket(fixture(), 2, { serves: ["INV-1", "AC-1", "other-plan#AC-1"] }), "VOCABULARIES", []);
});

test("identifier COVERAGE rejects an unserved declaration", () => {
  expectMessages(changeTask(fixture(), 1, { serves: [] }), "COVERAGE", [`${LABEL}/INV-1: COVERAGE rule broken: the declaration is served by no plan task`]);
});

test("identifier ORPHANS rejects undeclared task and ticket claims", () => {
  const input = changeTicket(changeTask(fixture(), 2, { serves: ["AC-1"] }), 2, { serves: ["AC-1"] });
  expectMessages(input, "ORPHANS", [
    `${LABEL}/AC-1: ORPHANS rule broken: plan task T02 claims an identifier the plan does not declare`,
    `${LABEL}/AC-1: ORPHANS rule broken: ticket T02 claims an identifier the plan does not declare`,
  ]);
});

test("identifier MIRROR rejects differing serves and missing tickets", () => {
  expectMessages(changeTicket(fixture(), 1, { serves: [] }), "MIRROR", [`${LABEL}/T01: MIRROR rule broken: plan task serves [INV-1], ticket serves []`]);
  const input = fixture();
  expectMessages({ ...input, tickets: input.tickets.slice(0, 1) }, "MIRROR", [`${LABEL}/T02: MIRROR rule broken: plan task serves [], ticket serves []`]);
});

test("identifier Q5 rejects unresolvable qualified stems and declaration gaps or duplicates", () => {
  expectMessages(changeTask(fixture(), 2, { serves: ["missing#AC-1"] }), "Q5", [`${LABEL}/missing#AC-1: Q5 rule broken: plan task T02 names unresolvable plan stem missing`]);
  expectMessages(changeTicket(fixture(), 2, { serves: ["missing#AC-1"] }), "Q5", [`${LABEL}/missing#AC-1: Q5 rule broken: ticket T02 names unresolvable plan stem missing`]);
  const input = fixture();
  expectMessages({ ...input, plan: parsed(input.plan, [...input.plan.declarations, ...input.plan.declarations]) }, "Q5", [`${LABEL}/INV-1: Q5 rule broken: INV declarations must be unique`]);
  expectMessages({ ...input, plan: parsed(input.plan, [{ id: "AC-2", statement: "Gap" }]) }, "Q5", [`${LABEL}/AC-2: Q5 rule broken: AC declarations must be contiguous from AC-1; expected AC-1`]);
});

test("identifier rules preserve legacy no-spine plans, served sets, and qualified resolution", () => {
  const input = fixture();
  const legacy = { ...input, plan: parsed(input.plan.map((task) => ({ ...task, serves: [] })), []), tickets: input.tickets.map((ticket) => ({ ...ticket, serves: undefined })) };
  assert.deepEqual(planAgreement(legacy), []);
  const qualified = changeTicket(changeTask(input, 2, { serves: ["other-plan#AC-1"] }), 2, { serves: ["other-plan#AC-1"] });
  assert.deepEqual(planAgreement(qualified), []);
  assert.deepEqual(planAgreement(changeTicket(input, 1, { serves: ["INV-1", "INV-1"] })), []);
});

test("registered W03 scratch bytes still reject Section B drift, duplicate task number, and done under idle", () => {
  // Scratch copies are strings only. No spec, ticket or prompt is ever written.
  const root = repoRoot();
  const html = readFileSync(join(root, "specs/awsf-v3-w03-ticket-closure.html"), "utf8");
  const md = readFileSync(join(root, "specs/awsf-v3-w03-ticket-closure-build-prompts.md"), "utf8");
  const raw = readFileSync(join(root, "specs/tickets/awsf-v3-w03-ticket-closure/T03.md"), "utf8");
  const heads = [...md.matchAll(/^### T(\d+) — (.+)$/gm)];
  const head = heads.find((match) => match[1] === "03")!;
  const next = heads[heads.indexOf(head) + 1]!;
  const block = { title: head[2]!, prompt: md.slice(head.index! + head[0].length, next.index).trim() };
  const input = {
    ...fixture(), label: "awsf-v3-w03-ticket-closure", plan: parseAwsfPlanHtmlV1(html, "awsf-v3-w03-ticket-closure"),
    tickets: [{ ...fixture().tickets[1]!, id: "T03", number: 3, milestone: "M2", title: block.title, prompt: raw.split("## Build prompt\n\n")[1]!.replace(/\n+$/, "") }],
    sectionB: new Map([[3, block]]),
  };
  expectMessages(input, "PROMPT", []);
  expectMessages({ ...input, sectionB: new Map([[3, { ...block, prompt: `${block.prompt} ` }]]) }, "PROMPT", ["awsf-v3-w03-ticket-closure/T03: build prompt has drifted from Section B"]);
  const duplicate = html.replace("<h4>3.", "<h4>2.");
  assert.notEqual(duplicate, html);
  const duplicateViolations = planAgreement({ ...input, plan: parseAwsfPlanHtmlV1(duplicate, input.label) }, "TICKET_COVERAGE");
  assert.ok(duplicateViolations.some(({ message }) => message === "a ticket names a task the plan does not have"));
  expectMessages(changeTicket(input, 3, { state: "done" }), "MILESTONE_STATE", ["awsf-v3-w03-ticket-closure/T03: milestone M2 is [] but ticket is done"]);
});
