import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queryBacklog } from "../../src/backlog.ts";
import { renderBacklog } from "../../src/cli/commands/backlog.ts";
import { TicketStore } from "../../src/persistence/ticket-store.ts";

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
