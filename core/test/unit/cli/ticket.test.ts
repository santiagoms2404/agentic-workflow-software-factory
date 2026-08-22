import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { main } from "../../../src/cli/main.ts";
import { intakeRequest, listTickets, showTicket, ticketStoreForPlan } from "../../../src/cli/commands/ticket.ts";
import { TicketStore } from "../../../src/persistence/ticket-store.ts";

const V1_LIST_BASELINE = `T01\tdone\tT1\tWorkspace bootstrap and meta-tests
T02\tdone\tT1\tConfiguration schema and loader
T03\tdone\tT1\tEnvelope and event contracts
T04\tdone\tT1\tTask-machine contract tests, written RED
T05\tdone\tT1\tTask machine and phase machine to green
T06\tdone\tT1\tPlatform paths, journal, status, attempt locks
T07\tdone\tT1\tSQLite driver, migrations, projector
T08\tdone\tT1\tReplay, rebuild, crash injection
T09\tdone\tT2\tCall-budget reservations
T10\tdone\tT2\tTransportBroker, launcher barrier, stub adapter
T11\tdone\tT2\tProcess controller and the three platform ports
T12\tdone\tT2\tStream layer: LineFramer, EventSequencer, output budget
T13\tdone\tT1\tClaude Code adapter
T14\tdone\tT1\tPi/Codex adapter
T15\tdone\tT1\tCatalog, model identity, Antigravity probe
T16\tdone\tT1\tWorktrees and host-owned Git
T17\tdone\tT2\tPermission profiles, path policy, sandbox broker
T18\tdone\tT1\tThe eleven gates
T19\tdone\tT1\tPhase engine, corrections, schema injection
T20\tdone\tT1\tThe six recipes and the stub journeys
T21\tdone\tT2\tCLI and TTY-only landing through persisted LANDING
T22\tdone\tT1\tDoctor, rebuild, gc — deterministic and read-only
T23\tdone\tT1\tRead-only API server
T24\tdone\tT1\tDashboard shell, sessions grid, polling
T25\tdone\tT1\tSession route: StateRibbon, swimlanes, OwnerGateCard
T26\tdone\tT1\tDrawer, event log, settings, accessibility
T27\tdone\tT1\tPortability matrix, per machine
T28\tdone\tT1\tPackaging, docs, and script reconciliation
T29\tdone\tT2\tPilot 1: a real T1 task
T30\tdone\tT2\tPilot 2: the live T2 binding, then a real T2 task with opposite-provider review
T31\tdone\tT1\tTicket contract and file-backed store
T32\tdone\tT1\tThe intake recipe and awsf ticket
T33\tdone\tT1\tawsf backlog and the board route
T34\tdone\tT2\tPull-request-shaped landing summary
T35\tdone\tT2\tThe owner-adjustable call ceiling
T36\tdone\tT2\tOwner rework at tier 2
T37\tdone\tT2\tRepository-wide typecheck, and the D2 amendment it needs
T38\tdone\tT2\tThe seven deferred WSL2 portability rows`.split("\n");

const V1_BACKLOG_BASELINE = [
  "state: todo=0 wip=0 done=38 failed=0",
  "milestone: M1=5 M2=3 M3=4 M4=3 M5=5 M6=2 M7=4 M8=4 M9=4 M10=2 M11=2",
  "tier: T0=0 T1=25 T2=13",
  "ready (0): —",
  "projected cost: — · partial",
];

test("ticket list and show read the file-backed store", async () => {
  const store = new TicketStore("specs/tickets/awsf-plan");
  const listed = await listTickets(store);
  assert.ok(listed.some((line) => line.startsWith("T32\t")));
  const shown = await showTicket(store, "T32");
  assert.match(shown.join("\n"), /The intake recipe and awsf ticket/);
});

test("showTicket keeps its path-suffix fallback one level below the ticket root", async () => {
  const record = (await new TicketStore("specs/tickets/awsf-plan").load()).find((candidate) => candidate.ticket?.id === "T17");
  assert.ok(record);
  const store = { load: async () => [{ ...record, ticket: null }] } as unknown as TicketStore;
  const shown = await showTicket(store, "T17");
  assert.match(shown[0] ?? "", /specs[/\\]tickets[/\\]awsf-plan[/\\]T17\.md — invalid:/);
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

test("catalog default preserves the captured v1 list and backlog baselines after the move", async () => {
  const cwd = resolve(".");
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-ticket-default-"));
  try {
    const listed: string[] = [];
    const backlogged: string[] = [];
    const shown: string[] = [];
    const errors: string[] = [];

    assert.equal(await main({
      argv: ["ticket", "list", "--state-root", stateRoot], cwd,
      writeOut: (line) => { listed.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.equal(await main({
      argv: ["backlog", "--state-root", stateRoot], cwd,
      writeOut: (line) => { backlogged.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.equal(await main({
      argv: ["ticket", "show", "T17", "--state-root", stateRoot], cwd,
      writeOut: (line) => { shown.push(line); }, writeError: (line) => { errors.push(line); },
    }), 0, errors.join("\n"));
    assert.deepEqual(listed, V1_LIST_BASELINE);
    assert.deepEqual(backlogged, V1_BACKLOG_BASELINE);
    assert.match(shown[0] ?? "", /^T17\tdone\tT2\tPermission profiles, path policy, sandbox broker$/);
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
  const existing = (await new TicketStore("specs/tickets/awsf-plan").load()).find((record) => record.ticket?.id === "T32");
  assert.ok(existing);
  const request = intakeRequest("refine", "T32", "make acceptance observable", existing);
  assert.match(request, /Refine ticket T32 without changing its id/);
  assert.match(request, /"acceptance"/);
  assert.throws(() => intakeRequest("new", "T1", "bad id"), /zero-padded/);
});
