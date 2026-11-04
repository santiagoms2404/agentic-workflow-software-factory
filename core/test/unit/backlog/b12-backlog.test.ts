import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  planNameForStore,
  projectedCost,
  queryBacklog,
  queryPlanBacklog,
  ticketBareId,
  type BacklogSessionCost,
} from "../../../src/backlog.ts";
import { renderBacklog } from "../../../src/cli/commands/backlog.ts";
import type { PlanTicketGroup } from "../../../src/persistence/plan-tickets.ts";
import { TicketStore } from "../../../src/persistence/ticket-store.ts";

const validTicket = (id: string, state = "todo", depends = "[]") => `---
id: ${id}
title: ${id} title
milestone: M1
tier: 1
state: ${state}
depends_on: ${depends}
workflow: build
outcome: outcome
context: [context]
acceptance: [acceptance]
non_goals: [non-goal]
---
body
`;

const invalidTicketMissingFrontmatter = (_id?: string) => `
This is a ticket file without YAML frontmatter.
`;

const invalidTicketBadWorkflow = (id: string) => `---
id: ${id}
title: ${id} title
milestone: M1
tier: 1
state: todo
depends_on: []
workflow: unknown-bogus-workflow
outcome: outcome
context: [context]
acceptance: [acceptance]
non_goals: [non-goal]
---
body
`;

test("B12-02: projectedCost joins bare session task ids against plan-qualified tickets in plan-aware path", async () => {
  const planGroup: PlanTicketGroup = {
    plan: { id: "p1", name: "p1", kind: "spine", parentSpine: null, parentSpineName: null },
    records: [
      {
        uid: "p1/T01",
        plan: "p1",
        path: "/specs/tickets/p1/T01.md",
        ticket: { id: "T01", title: "T01", milestone: "M1", state: "done", depends_on: [] },
      },
      {
        uid: "p1/T02",
        plan: "p1",
        path: "/specs/tickets/p1/T02.md",
        ticket: { id: "T02", title: "T02", milestone: "M1", state: "todo", depends_on: ["T01"] },
      },
    ],
  };

  // Sessions have bare task ids (T01, T02) as produced by production session queries
  const sessions: readonly BacklogSessionCost[] = [
    { taskId: "T01", estimatedCostUsd: 1.5, costAuthority: "provider" },
    { taskId: "T02", estimatedCostUsd: 2.5, costAuthority: "provider" },
  ];

  const backlog = await queryPlanBacklog({ load: async () => [planGroup] }, sessions);
  assert.deepEqual(backlog.projectedCost, {
    usd: 4.0,
    authority: "provider",
    partial: false,
  });
});

test("B12-02: projectedCost joins bare session task ids in legacy queryBacklog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b12-backlog-"));
  try {
    writeFileSync(join(dir, "T01.md"), validTicket("T01", "done"));
    writeFileSync(join(dir, "T02.md"), validTicket("T02", "todo", "[T01]"));

    const sessions: readonly BacklogSessionCost[] = [
      { taskId: "T01", estimatedCostUsd: 3.0, costAuthority: "provider" },
      { taskId: "T02", estimatedCostUsd: 4.0, costAuthority: "provider" },
    ];

    const backlog = await queryBacklog(new TicketStore(dir), sessions);
    assert.deepEqual(backlog.projectedCost, {
      usd: 7.0,
      authority: "provider",
      partial: false,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B12-02: projectedCost refuses colliding bare ids across multiple plans", async () => {
  const multiPlanGroups: PlanTicketGroup[] = [
    {
      plan: { id: "alpha", name: "alpha", kind: "spine", parentSpine: null, parentSpineName: null },
      records: [
        {
          uid: "alpha/T01",
          plan: "alpha",
          path: "/specs/tickets/alpha/T01.md",
          ticket: { id: "T01", title: "T01", milestone: "M1", state: "done", depends_on: [] },
        },
      ],
    },
    {
      plan: { id: "beta", name: "beta", kind: "spine", parentSpine: null, parentSpineName: null },
      records: [
        {
          uid: "beta/T01",
          plan: "beta",
          path: "/specs/tickets/beta/T01.md",
          ticket: { id: "T01", title: "T01", milestone: "M1", state: "todo", depends_on: [] },
        },
      ],
    },
  ];

  // Bare session T01 collides because T01 exists in both alpha and beta
  const bareSessions: readonly BacklogSessionCost[] = [
    { taskId: "T01", estimatedCostUsd: 1.0, costAuthority: "provider" },
  ];
  const bareBacklog = await queryPlanBacklog({ load: async () => multiPlanGroups }, bareSessions);
  assert.deepEqual(bareBacklog.projectedCost, {
    usd: null,
    authority: "unavailable",
    partial: true,
  });

  // Qualified UIDs still join unambiguously
  const qualifiedSessions: readonly BacklogSessionCost[] = [
    { taskId: "alpha/T01", estimatedCostUsd: 1.0, costAuthority: "provider" },
    { taskId: "beta/T01", estimatedCostUsd: 2.0, costAuthority: "provider" },
  ];
  const qualifiedBacklog = await queryPlanBacklog({ load: async () => multiPlanGroups }, qualifiedSessions);
  assert.deepEqual(qualifiedBacklog.projectedCost, {
    usd: 3.0,
    authority: "provider",
    partial: false,
  });
});

test("B12-02: projectedCost helper accommodates bare id, suffix after slash, and qualified uid", () => {
  // ticketBareId extracts bare id from id or uid suffix
  assert.equal(ticketBareId({ uid: "plan/T01", id: "T01" }), "T01");
  assert.equal(ticketBareId({ uid: "plan/T01" }), "T01");
  assert.equal(ticketBareId({ uid: "T01" }), "T01");

  // Suffix matching in projectedCost
  const tickets = [{ uid: "custom-plan/T05", id: "T05" }];
  const bareMatch = projectedCost(tickets, [{ taskId: "T05", estimatedCostUsd: 10, costAuthority: "provider" }]);
  assert.deepEqual(bareMatch, { usd: 10, authority: "provider", partial: false });

  const qualifiedMatch = projectedCost(tickets, [{ taskId: "custom-plan/T05", estimatedCostUsd: 10, costAuthority: "provider" }]);
  assert.deepEqual(qualifiedMatch, { usd: 10, authority: "provider", partial: false });
});

test("B12-03: queryBacklog discloses invalid stored tickets rather than silently dropping them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b12-invalid-"));
  try {
    writeFileSync(join(dir, "T01.md"), validTicket("T01", "done"));
    writeFileSync(join(dir, "T02.md"), invalidTicketBadWorkflow("T02"));
    writeFileSync(join(dir, "T03.md"), invalidTicketMissingFrontmatter("T03"));

    const backlog = await queryBacklog(new TicketStore(dir), []);

    // Valid ticket is kept in tickets and counts
    assert.deepEqual(backlog.tickets.map((t) => t.id), ["T01"]);
    assert.equal(backlog.counts.state.done, 1);
    assert.equal(backlog.counts.state.todo, 0);

    // Invalid tickets are disclosed in counts.invalid, counts.state.invalid, and backlog.invalid
    assert.equal(backlog.counts.invalid, 2);
    assert.equal(backlog.counts.state.invalid, 2);
    assert.equal(backlog.invalidCount, 2);
    assert.equal(backlog.invalid?.length, 2);
    assert.ok(backlog.invalid?.some((r) => r.path.endsWith("T02.md") && r.ticket === null && r.violations.length > 0));
    assert.ok(backlog.invalid?.some((r) => r.path.endsWith("T03.md") && r.ticket === null && r.violations.length > 0));

    // CLI renderBacklog discloses invalid ticket count in state output
    const rendered = renderBacklog(backlog);
    assert.match(rendered[0]!, /invalid=2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B12-03: queryBacklog with zero invalid tickets leaves counts.state clean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b12-valid-"));
  try {
    writeFileSync(join(dir, "T01.md"), validTicket("T01", "done"));
    const backlog = await queryBacklog(new TicketStore(dir), []);
    assert.equal(backlog.counts.invalid, 0);
    assert.equal(backlog.counts.state.invalid, undefined);
    assert.deepEqual(backlog.counts.state, { todo: 0, wip: 0, done: 1, failed: 0 });
    assert.equal(backlog.invalid, undefined);
    assert.equal(backlog.invalidCount, undefined);

    const rendered = renderBacklog(backlog);
    assert.doesNotMatch(rendered[0]!, /invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B12-04: planNameForStore does not misattribute non-plan directories as plan names", () => {
  // Flat intake store belongs to no plan (AGENTS.md invariant 12)
  assert.equal(planNameForStore("specs/tickets"), null);
  assert.equal(planNameForStore("/repo/specs/tickets"), null);
  assert.equal(planNameForStore("specs/tickets/"), null);

  // Arbitrary directory belongs to no plan
  assert.equal(planNameForStore("/tmp/awsf-backlog-12345"), null);
  assert.equal(planNameForStore("custom-store"), null);

  // Known plan ticket structure tickets/<planStem> resolves to plan stem
  assert.equal(planNameForStore("specs/tickets/awsf-plan"), "awsf-plan");
  assert.equal(planNameForStore("/repo/specs/tickets/awsf-v3-w01"), "awsf-v3-w01");
  assert.equal(planNameForStore("specs/tickets/awsf-plan/"), "awsf-plan");
});

test("B12-04: queryBacklog on flat store sets no fake plan name and projects costs with bare ids", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "awsf-b12-flat-"));
  try {
    // Structure as specs/tickets
    const ticketsDir = join(rootDir, "specs", "tickets");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(ticketsDir, { recursive: true });
    writeFileSync(join(ticketsDir, "T01.md"), validTicket("T01", "done"));

    const sessions: readonly BacklogSessionCost[] = [
      { taskId: "T01", estimatedCostUsd: 5.5, costAuthority: "provider" },
    ];

    const backlog = await queryBacklog(new TicketStore(ticketsDir), sessions);
    // plan is not set to "tickets"
    assert.equal(backlog.plan, undefined);
    // bare session cost matches ticket T01 without requiring "tickets/T01"
    assert.deepEqual(backlog.projectedCost, {
      usd: 5.5,
      authority: "provider",
      partial: false,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
