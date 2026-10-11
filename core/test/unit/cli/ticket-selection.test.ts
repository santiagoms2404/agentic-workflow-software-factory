import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { main } from "../../../src/cli/main.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { parseTicketSelection, sealPlanTicketSelection, sealLightTicketSelection } from "../../../src/cli/commands/ticket-selection.ts";
import { assertTicketSelection, sealTicketSelection, TicketSelectionSchema, TICKET_SELECTION_SCHEMA_ID } from "../../../src/contracts/ticket-selection-record.ts";
import { RECORD_SCHEMAS, ENVELOPE_SCHEMAS } from "../../../src/contracts/registry.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { stringify } from "yaml";
import type { Ticket } from "../../../src/contracts/ticket.ts";

const flatTicket: Ticket = { id: "T00", title: "Small change", milestone: "M1", tier: 1, state: "todo", depends_on: [],
  workflow: "build-review", outcome: "Small change works", context: [], acceptance: ["Observable result"], non_goals: [] };
const flatSource = (ticket: Ticket) => `---\n${stringify(ticket)}---\n# Small change\n`;

function world(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-selection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  const directory = join(repository, "plans", "tickets", "selected-plan");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: agentic-workflow-software-factory}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, "plans", "selected-plan.html"), "<title>selected plan</title>\n");
  for (const id of ["T01", "T02"]) writeFileSync(join(directory, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nmilestone: M1\nstate: todo\ndepends_on: []\n---\n## Build prompt\nWrite a source.\n`);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, readFileSync(resolve("awsf.config.yaml")));
  const stateRoot = join(root, "state");
  const projectDir = join(stateRoot, "projects", "agentic-workflow-software-factory");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "placement.yaml"), `version: awsf.placement/v1\nproject: agentic-workflow-software-factory\nrepositories:\n  app:\n    path: ${repository}\n`);
  const args = ["--config", configPath, "--state-root", stateRoot];
  const cli = async (argv: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main({ argv: [...argv, ...args], cwd: repository, writeOut: line => out.push(line), writeError: line => err.push(line) });
    return { code, out, err };
  };
  return { root, repository, directory, stateRoot, cli, options: { repository, stateRoot, project: "agentic-workflow-software-factory", stem: "selected-plan" } };
}

for (const [name, flags, message] of [
  ["outside registered set", ["--plan", "selected-plan", "--ticket", "T03"], /outside the registered ticket set/],
  ["duplicate comma ids", ["--plan", "selected-plan", "--ticket", "T01,T01"], /duplicate ticket id/],
  ["duplicate repeated ids", ["--plan", "selected-plan", "--ticket", "T01", "--ticket", "T01"], /duplicate ticket id/],
  ["shift selection", ["--workflow", "shift", "--plan", "selected-plan", "--milestone", "M1", "--ticket", "T01"], /cannot select a shift/],
  ["paired ticket without plan", ["--ticket", "T01"], /not a flat light ticket/],
  ["empty selection", ["--plan", "selected-plan", "--ticket="], /requires one or more ticket ids/],
] as const) test(`new refuses ${name} before any attempt exists`, async t => {
  const w = world(t);
  const result = await w.cli(["new", "refused", "request", ...flags]);
  assert.equal(result.code, 1);
  assert.match(result.err.join("\n"), message);
  assert.equal(existsSync(join(w.stateRoot, "projects", w.options.project, "tasks", "refused")), false);
});

test("repeatable selection seals registered paths and exact bytes, journals and renders text and JSON without inference", async t => {
  const w = world(t);
  const result = await w.cli(["new", "unrelated-name", "no ticket inference", "--plan", "selected-plan", "--ticket", "T02", "--ticket", "T01"]);
  assert.equal(result.code, 0, result.err.join("\n"));
  const dir = join(w.stateRoot, "projects", w.options.project, "tasks", "unrelated-name", "1");
  const status = await readAttempt(dir);
  const selection = status.ticketSelection!;
  assert.equal(Value.Check(TicketSelectionSchema, selection), true);
  assert.equal(status.shift, undefined);
  assert.deepEqual(selection.tickets.map(ticket => ticket.id), ["T02", "T01"]);
  for (const ticket of selection.tickets) {
    assert.equal(ticket.path, `plans/tickets/selected-plan/${ticket.id}.md`);
    assert.equal(ticket.digest, ticketFileDigest(readFileSync(join(w.repository, ticket.path))));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "journal.jsonl"), "utf8").trim()).event.next.ticketSelection, selection);
  assert.match((await w.cli(["status", "unrelated-name"])).out.join("\n"), /Tickets: selected-plan T02,T01/);
  assert.deepEqual(JSON.parse((await w.cli(["status", "unrelated-name", "--json"])).out.join("\n")).ticketSelection, selection);
  writeFileSync(join(w.directory, "T01.md"), readFileSync(join(w.directory, "T01.md"), "utf8") + "changed\n");
  assert.notEqual((await sealPlanTicketSelection(w.options, ["T02,T01"])).selectionDigest, selection.selectionDigest);
  assert.deepEqual((await readAttempt(dir)).ticketSelection, selection, "journal remains the sealed authority");
});

test("host record is closed, disjoint from envelopes, and newCommand refuses invalid or misbound selections", async t => {
  const w = world(t);
  assert.equal(RECORD_SCHEMAS[TICKET_SELECTION_SCHEMA_ID], TicketSelectionSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, TICKET_SELECTION_SCHEMA_ID), false);
  const selection = await sealPlanTicketSelection(w.options, ["T01"]);
  assert.throws(() => assertTicketSelection({ ...selection, selectionDigest: "a".repeat(64) }), /not a sealed/);
  assert.throws(() => sealTicketSelection({ plan: selection.plan, tickets: [...selection.tickets, ...selection.tickets] }), /not a sealed/);
  assert.throws(() => parseTicketSelection(["T01,"]), /requires one or more/);
  assert.equal(Value.Check(TicketSelectionSchema, { ...selection, extra: true }), false);
  await assert.rejects(newCommand({ stateRoot: w.stateRoot, project: w.options.project, taskId: "misbound", repository: w.repository,
    workflow: "build", tier: 1, request: "request", planRef: "another-plan", ticketSelection: selection }), /requires its registered --plan/);
  assert.equal(existsSync(join(w.stateRoot, "projects", w.options.project, "tasks", "misbound")), false);
});

test("light selection uses the non-default plans root, seals one exact file and journals plan=null", async t => {
  const w = world(t);
  const path = join(w.repository, "plans/tickets/T00.md");
  writeFileSync(path, flatSource(flatTicket));
  const result = await w.cli(["new", "light-build", "small work", "--workflow", "build-review", "--ticket", "T00"]);
  assert.equal(result.code, 0, result.err.join("\n"));
  const dir = join(w.stateRoot, "projects", w.options.project, "tasks/light-build/1");
  const status = await readAttempt(dir);
  assert.equal(status.planRef, null);
  assert.equal(status.ticketSelection!.plan, null);
  assert.deepEqual(status.ticketSelection!.tickets, [{ id: "T00", path: "plans/tickets/T00.md", digest: ticketFileDigest(readFileSync(path)), tier: 1, workflow: "build-review" }]);
  assert.match((await w.cli(["status", "light-build"])).out.join("\n"), /Tickets: light T00/);
  assert.deepEqual(JSON.parse((await w.cli(["status", "light-build", "--json"])).out.join("\n")).ticketSelection, status.ticketSelection);
  writeFileSync(path, flatSource({ ...flatTicket, title: "Changed title" }));
  assert.notEqual((await sealLightTicketSelection(w.repository, ["T00"])).selectionDigest, status.ticketSelection!.selectionDigest);
});

for (const [values, message] of [
  [["T00,T01"], /exactly one flat/], [["W01"], /exactly one flat/], [["T00,T00"], /duplicate/], [["T99"], /not a flat/],
] as const) test(`light selection refuses ${values.join(",")} before an attempt exists`, async t => {
  const w = world(t);
  writeFileSync(join(w.repository, "plans/tickets/T00.md"), flatSource(flatTicket));
  const result = await w.cli(["new", "refused-light", "work", "--ticket", ...values]);
  assert.equal(result.code, 1);
  assert.match(result.err.join("\n"), message);
  assert.equal(existsSync(join(w.stateRoot, "projects", w.options.project, "tasks/refused-light")), false);
});

test("light selection refuses vocabulary, filename identity and dependency-cycle defects", async t => {
  const w = world(t), path = join(w.repository, "plans/tickets/T00.md");
  writeFileSync(path, flatSource(flatTicket).replace("state: todo", "state: unknown"));
  await assert.rejects(sealLightTicketSelection(w.repository, ["T00"]), /light ticket agreement/);
  writeFileSync(path, flatSource({ ...flatTicket, id: "T01" }));
  await assert.rejects(sealLightTicketSelection(w.repository, ["T00"]), /not a valid flat/);
  writeFileSync(path, flatSource({ ...flatTicket, depends_on: ["T00"] }));
  await assert.rejects(sealLightTicketSelection(w.repository, ["T00"]), /dependency cycle/);
});

test("light selection cannot bind to a --plan and cannot seal several tickets", async t => {
  const w = world(t), path = join(w.repository, "plans/tickets/T00.md");
  writeFileSync(path, flatSource(flatTicket));
  const selection = await sealLightTicketSelection(w.repository, ["T00"]);
  await assert.rejects(newCommand({ stateRoot: w.stateRoot, project: w.options.project, taskId: "misbound-light", repository: w.repository,
    workflow: "build-review", tier: 2, request: "request", planRef: "selected-plan", ticketSelection: selection }), /requires its registered/);
  assert.throws(() => sealTicketSelection({ plan: null, tickets: [selection.tickets[0]!, { ...selection.tickets[0]!, id: "T01" }] }), /not a sealed/);
  assert.equal(existsSync(join(w.stateRoot, "projects", w.options.project, "tasks/misbound-light")), false);
});
