import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { lightTicketAgreement } from "../../../src/registry/plan-agreement.ts";
import { intakeStateGate } from "../../../src/gates/intake-state.ts";
import type { Ticket } from "../../../src/contracts/ticket.ts";
import { closureDelta } from "../../../src/closure/delta.ts";
import { evaluateProtectedPaths } from "../../../src/preflight/fields.ts";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../../src/config/load.ts";

const ticket: Ticket = { id: "T00", title: "Small change", milestone: "M1", tier: 1, state: "todo", depends_on: [],
  workflow: "build-review", outcome: "Small change works", context: ["Fixture context"], acceptance: ["Observable result"], non_goals: ["Other work"] };
const records = (frontmatter: unknown) => [{ path: "plans/tickets/T00.md", frontmatter }];
const source = (ticket: Ticket) => `---\n${stringify(ticket)}---\nBody\n`;

test("flat agreement accepts the Ticket vocabulary without a plan and does not mutate inputs", () => {
  const rows = records(ticket), before = structuredClone(rows);
  assert.deepEqual(lightTicketAgreement(rows), []);
  assert.deepEqual(rows, before);
  assert.deepEqual(lightTicketAgreement([]), []);
});

for (const [field, value] of [
  ["id", "W01"], ["title", ""], ["milestone", "wrong"], ["tier", 3], ["state", "closed"],
  ["workflow", "shift"], ["task_class", "unknown"], ["depends_on", ["W01"]], ["context", [1]],
  ["outcome", ""], ["acceptance", [1]], ["non_goals", [1]], ["extra", true],
] as const) test(`flat agreement refuses ${field} outside its vocabulary`, () => {
  const violations = lightTicketAgreement(records({ ...ticket, [field]: value }));
  assert.ok(violations.some(row => row.rule === "VOCABULARIES" && row.message.includes(field)));
});

for (const cycle of [["T00"], ["T00", "T01"], ["T00", "T01", "T02"]]) test(`flat agreement refuses a dependency cycle of ${cycle.length} ticket(s)`, () => {
  const rows = cycle.map((id, i) => ({ path: `plans/tickets/${id}.md`, frontmatter: { ...ticket, id, depends_on: [cycle[(i + 1) % cycle.length]] } }));
  const violations = lightTicketAgreement(rows);
  assert.ok(violations.some(row => row.rule === "DEPENDENCY_CYCLES" && cycle.every(id => row.message.includes(id))));
});

test("flat agreement accepts acyclic forward dependencies, unlike paired plan ordering", () => {
  assert.deepEqual(lightTicketAgreement([
    { path: "plans/tickets/T00.md", frontmatter: { ...ticket, depends_on: ["T01"] } },
    { path: "plans/tickets/T01.md", frontmatter: { ...ticket, id: "T01" } },
  ]), []);
});

for (const state of ["todo", "wip", "done", "failed"] as const) test(`intake new permits only todo, not ${state} by exception`, () => {
  assert.equal(intakeStateGate("plans/tickets/T00.md", null, { ...ticket, state }).passed, state === "todo");
});

for (const before of ["todo", "wip", "done", "failed"] as const) {
  for (const after of ["todo", "wip", "done", "failed"] as const) test(`intake refine ${before} -> ${after} is allowed exactly when state is unchanged`, () => {
    assert.equal(intakeStateGate("plans/tickets/T00.md", source({ ...ticket, state: before }), { ...ticket, state: after, title: "Refined" }).passed,
      before === after);
  });
}

test("K1 does not invent a descendant of a flat ticket, while paired and directly protected tickets still need grants", () => {
  const config = loadConfig(readFileSync("awsf.config.yaml", "utf8"));
  const check = (path: string, protectedPaths = config.policy.protected_paths) => evaluateProtectedPaths({
    request: `Ask: Refine one ticket\nWhere: ${path}\nDone means: it validates\nOut of scope: other work`,
    where: [path], read: [], protectedPaths, writers: [{ phase: "intake", writes: ["specs/tickets/**"] }], shift: null,
  });
  assert.deepEqual(check("specs/tickets/T00.md").plan, []);
  assert.ok(check("specs/tickets/paired/T00.md").plan.length > 0);
  assert.ok(check("specs/tickets/T00.md", ["specs/tickets/*.md"]).plan.length > 0);
  assert.ok(check("specs/tickets/T00.md", ["specs/**"]).plan.length > 0);
});

for (const [oldText, newText] of [
  ["Small change", "Other change"], ["milestone: M1", "milestone: M2"], ["tier: 1", "tier: 2"],
  ["depends_on: []", "depends_on: [T01]"], ["workflow: build-review", "workflow: build"],
  ["Small change works", "Other outcome"], ["Fixture context", "Other context"],
  ["Observable result", "Other acceptance"], ["Other work", "More work"], ["Body", "Changed body"],
] as const) test(`light delta refuses changing ${oldText} even alongside an allowed state substitution`, () => {
  const path = "plans/tickets/T00.md", text = source(ticket);
  const before = new Map([[path, Buffer.from(text)]]);
  const after = new Map([[path, Buffer.from(text.replace("state: todo", "state: done").replace(oldText, newText))]]);
  const result = closureDelta(before, after, { plans: [], lightTickets: new Map([["T00", path]]) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, "content");
});

test("intake refuses invalid base bytes instead of treating them as a new ticket", () => {
  assert.equal(intakeStateGate("plans/tickets/T00.md", "bad frontmatter", ticket).passed, false);
});
