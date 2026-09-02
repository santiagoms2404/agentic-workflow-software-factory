import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queryBacklog, queryPlanBacklog } from "../../src/backlog.ts";
import { renderBacklog } from "../../src/cli/commands/backlog.ts";
import { PlanTicketReader, type PlanTicketData, type PlanTicketGroup } from "../../src/persistence/plan-tickets.ts";
import { TicketStore } from "../../src/persistence/ticket-store.ts";
import { loadCatalog } from "../../src/registry/catalog.ts";
import { resolvePlanSources } from "../../src/registry/plan-source.ts";
import { countBlockedTickets, isBlockedTicket, projectedCostText } from "../../../dashboard/src/backlog-view.ts";
import { repoRoot } from "./meta/_walk.ts";

const ticket = (id: string, state: string, depends = "[]") => `---
id: ${id}
title: ${id} title
milestone: M9
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

test("one backlog query supplies counts, ready tickets, and an honest mixed projection to every renderer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "awsf-backlog-"));
  try {
    writeFileSync(join(directory, "T01.md"), ticket("T01", "done"));
    writeFileSync(join(directory, "T02.md"), ticket("T02", "todo", "[T01]"));
    const backlog = await queryBacklog(new TicketStore(directory), [
      { taskId: "T01", estimatedCostUsd: 1, costAuthority: "provider" },
      { taskId: "T02", estimatedCostUsd: 2, costAuthority: "catalog-estimate" },
    ]);
    assert.deepEqual(backlog.ready.map((item) => item.id), ["T02"]);
    assert.deepEqual(backlog.counts.state, { todo: 1, wip: 0, done: 1, failed: 0 });
    assert.deepEqual(backlog.counts.milestone, { M9: 2 });
    assert.deepEqual(backlog.counts.tier, { T0: 0, T1: 2, T2: 0 });
    assert.deepEqual(backlog.projectedCost, { usd: null, authority: "unavailable", partial: true });
    assert.match(renderBacklog(backlog).at(-1)!, /— · partial/);
    assert.doesNotMatch(renderBacklog(backlog).at(-1)!, /\$0\.00/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function historicalTicket(id: string, state: "todo" | "done", depends_on: readonly string[] = []): PlanTicketData {
  return { id, title: `${id} historical`, milestone: "M1", state, depends_on: [...depends_on] };
}

const plan = (id: string) => ({ id, name: id, kind: "spine" as const, parentSpine: null, parentSpineName: null });

function duplicateIdGroups(): readonly PlanTicketGroup[] {
  return [
    {
      plan: plan("alpha-plan"),
      records: [
        { uid: "alpha-plan/T01", plan: "alpha-plan", path: "/alpha/T01.md", ticket: historicalTicket("T01", "done") },
        { uid: "alpha-plan/T02", plan: "alpha-plan", path: "/alpha/T02.md", ticket: historicalTicket("T02", "todo", ["T01"]) },
      ],
    },
    {
      plan: plan("beta-plan"),
      records: [
        { uid: "beta-plan/T01", plan: "beta-plan", path: "/beta/T01.md", ticket: historicalTicket("T01", "todo") },
        { uid: "beta-plan/T02", plan: "beta-plan", path: "/beta/T02.md", ticket: historicalTicket("T02", "todo", ["T01"]) },
      ],
    },
  ];
}

async function repositoryBacklog() {
  const root = repoRoot();
  const catalogPath = join(root, "awsf.project.yaml");
  const sources = resolvePlanSources(catalogPath, loadCatalog(readFileSync(catalogPath, "utf8")));
  return queryPlanBacklog(new PlanTicketReader(sources), []);
}

test("plan backlog keeps duplicate ids separately addressable and resolves dependencies within each plan", async () => {
  const backlog = await queryPlanBacklog({ load: async () => duplicateIdGroups() }, []);
  assert.deepEqual(backlog.tickets.filter((item) => item.id === "T01").map((item) => item.uid), [
    "alpha-plan/T01",
    "beta-plan/T01",
  ]);
  assert.equal(backlog.tickets.find((item) => item.uid === "alpha-plan/T02")?.ready, true);
  assert.equal(backlog.tickets.find((item) => item.uid === "beta-plan/T02")?.ready, false);
  assert.deepEqual(backlog.plans.map((item) => item.ticketCount), [2, 2]);
});

test("projected cost joins plan-qualified uids and never colliding bare ids", async () => {
  const bareIds = await queryPlanBacklog({ load: async () => duplicateIdGroups() }, [
    { taskId: "T01", estimatedCostUsd: 1, costAuthority: "provider" },
    { taskId: "T02", estimatedCostUsd: 2, costAuthority: "provider" },
  ]);
  assert.deepEqual(bareIds.projectedCost, { usd: null, authority: "unavailable", partial: true });

  const qualified = await queryPlanBacklog({ load: async () => duplicateIdGroups() }, [
    { taskId: "alpha-plan/T01", estimatedCostUsd: 1, costAuthority: "provider" },
    { taskId: "alpha-plan/T02", estimatedCostUsd: 2, costAuthority: "provider" },
    { taskId: "beta-plan/T01", estimatedCostUsd: 3, costAuthority: "provider" },
    { taskId: "beta-plan/T02", estimatedCostUsd: 4, costAuthority: "provider" },
  ]);
  assert.deepEqual(qualified.projectedCost, { usd: 10, authority: "provider", partial: false });
});

test("the blocked aggregate is five on the current corpus and uses the ticket-card rule", async () => {
  const backlog = await repositoryBacklog();
  const blocked = countBlockedTickets(backlog.tickets);
  assert.equal(blocked, 5);
  assert.notEqual(blocked, 221);
  assert.equal(blocked, backlog.tickets.filter((item) => isBlockedTicket(item)).length);
  assert.equal(blocked, backlog.tickets.filter((item) => !item.ready && item.state === "todo").length);
});

test("a corpus with no joinable cost states that cost data is unavailable", async () => {
  const backlog = await repositoryBacklog();
  const label = projectedCostText(backlog.projectedCost);
  assert.equal(label, "Cost data unavailable");
  assert.notEqual(label?.toLowerCase(), "partial");
});
