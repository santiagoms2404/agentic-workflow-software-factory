import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApiRouter } from "../../src/api/routes.ts";
import { loadConfig } from "../../src/config/load.ts";
import { sealShiftManifest, type ShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { groupSessionStacks, orderSessionStack } from "../../../dashboard/src/session-stacks.ts";
import type { SessionsResponse } from "../../../dashboard/shared/types.ts";

// W17 M6 task 17: three milestones run as three chained shifts, and the owner
// sees them as one session stack. Nothing new is built for it. `awsf new
// --continues <task>` records `continuesTask` on the attempt (the CLI passes
// the flag straight into newCommand, called here), the projection carries it
// to the sessions API, and groupSessionStacks joins over that recorded edge.
// Task ids are compared literally, so the chain must form whatever the ids
// look like, and ids that merely look alike must not join.

const PLAN = "fixture-shift-chain";
const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
const PROJECT = config.project.slug;

/** One milestone's sealed selection. newCommand checks the seal, not the ticket files. */
function manifest(milestone: string, tickets: readonly string[]): ShiftManifest {
  return sealShiftManifest({
    plan: PLAN,
    milestones: [milestone],
    tickets: tickets.map((id) => ({
      id,
      path: `specs/tickets/${PLAN}/${id}.md`,
      digest: ticketFileDigest(new TextEncoder().encode(`${milestone} ${id}`)),
    })),
  });
}

const MILESTONES = [
  { milestone: "M4", tickets: ["T11", "T12", "T13", "T14", "T15"], at: "2026-09-26T01:00:00.000Z" },
  { milestone: "M5", tickets: ["T16", "T17"], at: "2026-09-26T02:00:00.000Z" },
  { milestone: "M6", tickets: ["T18", "T19", "T20", "T21"], at: "2026-09-26T03:00:00.000Z" },
] as const;

/**
 * Mints one shift per milestone, each continuing the one before, plus any
 * unchained shifts, then reads them back through the sessions route.
 */
async function chain(taskIds: readonly [string, string, string], unchained: readonly string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "awsf-shift-chain-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "canonical");
  mkdirSync(repository, { recursive: true });
  const projection = createDashboardProjection(stateRoot);
  try {
    const create = async (taskId: string, selected: (typeof MILESTONES)[number], at: string, continuesTask?: string) =>
      newCommand({
        stateRoot, project: PROJECT, taskId, repository, workflow: "shift", tier: 2,
        request: `run milestone ${selected.milestone} of ${PLAN}`,
        shift: manifest(selected.milestone, selected.tickets),
        ...(continuesTask === undefined ? {} : { continuesTask }),
        projectRecord: projection.project,
        now: () => at,
      });
    const created = [];
    for (const [index, taskId] of taskIds.entries()) {
      const selected = MILESTONES[index]!;
      created.push(await create(taskId, selected, selected.at, index === 0 ? undefined : taskIds[index - 1]));
    }
    for (const taskId of unchained) await create(taskId, MILESTONES[2], "2026-09-26T04:00:00.000Z");
    for (const [index, entry] of created.entries()) {
      assert.equal(entry.status.workflow, "shift");
      assert.equal(entry.status.continuesTask, index === 0 ? null : taskIds[index - 1], "--continues is recorded on the attempt");
    }
  } finally {
    projection.close();
  }
  const router = createApiRouter({ dbPath: join(stateRoot, "awsf.db"), config, planSources: [] });
  try {
    const response = await router.dispatch({ method: "GET", url: "/api/v1/sessions", headers: { host: "127.0.0.1:4600" } });
    assert.equal(response.status, 200);
    return { sessions: (response.body as SessionsResponse).sessions, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } finally {
    router.close();
  }
}

function assertOneChronologicalStack(
  stacks: ReturnType<typeof groupSessionStacks<SessionsResponse["sessions"][number]>>,
  taskIds: readonly string[],
): void {
  const chained = stacks.filter((stack) => stack.sessions.some((session) => taskIds.includes(session.taskId)));
  assert.equal(chained.length, 1, "the three chained shifts form exactly one stack");
  const stack = chained[0]!;
  assert.deepEqual(stack.sessions.map((session) => session.taskId).toSorted(), [...taskIds].toSorted(), "the stack holds all three and nothing else");
  assert.ok(stack.sessions.every((session) => session.workflowId === "shift"));
  // The deck's own order: the earlier shifts peek oldest first, and the latest
  // is the front, so the stack reads as the milestones ran.
  assert.deepEqual(orderSessionStack(stack.sessions).map((session) => session.taskId), [...taskIds]);
  assert.deepEqual(orderSessionStack(stack.sessions).map((session) => session.startedAt),
    MILESTONES.map((entry) => entry.at), "chronological by the recorded start, not by id");
}

test("three shifts chained with --continues form one session stack, in the order they ran", async () => {
  const taskIds = ["shift-m4", "shift-m5", "shift-m6"] as const;
  // An unchained shift whose id shares the prefix: if the stack were derived
  // from names it would join, and it must not.
  const { sessions, cleanup } = await chain(taskIds, ["shift-m7"]);
  try {
    assert.equal(sessions.length, 4);
    assert.deepEqual(sessions.map((session) => [session.taskId, session.continuesTask]).toSorted(), [
      ["shift-m4", null], ["shift-m5", "shift-m4"], ["shift-m6", "shift-m5"], ["shift-m7", null],
    ]);
    const stacks = groupSessionStacks(sessions);
    assertOneChronologicalStack(stacks, taskIds);
    assert.equal(stacks.length, 2, "the look-alike shift stands alone");
    assert.deepEqual(stacks.find((stack) => stack.sessions.some((session) => session.taskId === "shift-m7"))!.sessions.map((session) => session.taskId), ["shift-m7"]);
  } finally {
    cleanup();
  }
});

test("the stack still forms when the three shifts' task ids share no prefix", async () => {
  const taskIds = ["willow", "ember-2", "quartz-final"] as const;
  assert.equal(new Set(taskIds.map((id) => id[0])).size, 3, "no two ids share even a first character");
  const { sessions, cleanup } = await chain(taskIds);
  try {
    assert.equal(sessions.length, 3);
    const stacks = groupSessionStacks(sessions);
    assert.equal(stacks.length, 1);
    assertOneChronologicalStack(stacks, taskIds);
  } finally {
    cleanup();
  }
});
