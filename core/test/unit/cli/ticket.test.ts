import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { main } from "../../../src/cli/main.ts";
import { intakeRequest, listTickets, showTicket, ticketStoreFor, ticketStoreForPlan } from "../../../src/cli/commands/ticket.ts";
import { backlogCommand } from "../../../src/cli/commands/backlog.ts";
import { TicketStore } from "../../../src/persistence/ticket-store.ts";

test("ticket list and show read the file-backed store", async () => {
  const store = new TicketStore("specs/tickets");
  const listed = await listTickets(store);
  assert.ok(listed.some((line) => line.startsWith("T32\t")));
  const shown = await showTicket(store, "T32");
  assert.match(shown.join("\n"), /The intake recipe and awsf ticket/);
});

test("ticketStoreForPlan uses the resolved plan repository ticket root", () => {
  const store = ticketStoreForPlan([{
    project: "foreign-project",
    repositoryId: "plans",
    planPath: "/foreign/plans/specs/alpha.html",
    promptsPath: "/foreign/plans/specs/alpha-build-prompts.md",
    ticketsPath: "/foreign/plans/specs/tickets/alpha",
    format: "awsf-plan-html/v1",
  }], "alpha");
  assert.equal(store.directory, "/foreign/plans/specs/tickets/alpha");
});

test("catalog default keeps ticket list and backlog on the v1 set before its move", async () => {
  const cwd = resolve(".");
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-ticket-default-"));
  try {
    const expectedList = await listTickets(ticketStoreFor(cwd));
    const expectedBacklog = await backlogCommand(ticketStoreFor(cwd), join(stateRoot, "awsf.db"));
    const listed: string[] = [];
    const backlogged: string[] = [];
    const errors: string[] = [];

    assert.equal(await main({
      argv: ["ticket", "list", "--state-root", stateRoot], cwd,
      writeOut: (line) => { listed.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.equal(await main({
      argv: ["backlog", "--state-root", stateRoot], cwd,
      writeOut: (line) => { backlogged.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.deepEqual(listed, expectedList);
    assert.deepEqual(backlogged, expectedBacklog);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a catalog with multiple plans and no default lists candidates instead of guessing", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-candidates-"));
  const cwd = process.cwd();
  try {
    mkdirSync(join(root, "specs", "tickets"), { recursive: true });
    writeFileSync(join(root, "awsf.project.yaml"), `
version: awsf.project/v1
project:
  slug: candidates
repositories:
  plans:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
`);
    writeFileSync(join(root, "specs", "alpha.html"), "<html></html>");
    writeFileSync(join(root, "specs", "beta.html"), "<html></html>");
    const output: string[] = [];
    const errors: string[] = [];
    process.chdir(root);
    assert.equal(await main({
      argv: ["ticket", "list"], cwd: root,
      writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); },
    }), 1, errors.join("\n"));
    assert.deepEqual(output, ["plan candidates: alpha, beta"]);
    output.length = 0;
    assert.equal(await main({
      argv: ["backlog"], cwd: root,
      writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); },
    }), 1, errors.join("\n"));
    assert.deepEqual(output, ["plan candidates: alpha, beta"]);
    output.length = 0;
    assert.equal(await main({
      argv: ["ticket", "list", "--plan", "beta"], cwd: root,
      writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.deepEqual(output, []);
    assert.deepEqual(errors, []);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ticket new and refine requests pin the id and refinement includes the validated prior ticket", async () => {
  assert.match(intakeRequest("new", "T37", "add bounded work intake"), /^Create ticket T37\./);
  const existing = (await new TicketStore("specs/tickets").load()).find((record) => record.ticket?.id === "T32");
  assert.ok(existing);
  const request = intakeRequest("refine", "T32", "make acceptance observable", existing);
  assert.match(request, /Refine ticket T32 without changing its id/);
  assert.match(request, /"acceptance"/);
  assert.throws(() => intakeRequest("new", "T1", "bad id"), /zero-padded/);
});
