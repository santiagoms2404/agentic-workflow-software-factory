import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createApiRouter } from "../../../src/api/routes.ts";
import { processesForSession } from "../../../src/observability/queries.ts";
import { openDatabase, type OpenDatabaseOptions } from "../../../src/observability/sqlite.ts";
import { writeLandingSummary } from "../../../src/persistence/landing-summary.ts";
import type { SessionsResponse, SessionDetailResponse, PhaseDetailResponse, EventsResponse, TicketsResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

const headers = { host: "127.0.0.1:4600" };

function request(url: string, method = "GET") {
  return { method, url, headers };
}

test("tickets serves the shared backlog query with its ready set and an honest partial projection", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, ticketDirectory: fixture.ticketDirectory });
  try {
    const response = await router.dispatch(request("/api/v1/tickets"));
    assert.equal(response.status, 200);
    const backlog = response.body as TicketsResponse;
    assert.deepEqual(backlog.ready.map((ticket) => ticket.id), ["T02"]);
    assert.deepEqual(backlog.counts.state, { todo: 1, wip: 0, done: 1, failed: 0 });
    assert.equal(backlog.projectedCost.partial, true);
    assert.equal(backlog.projectedCost.usd, null);
  } finally { router.close(); fixture.close(); }
});

test("sessions embeds ordered phases and agents in one response", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const response = await router.dispatch(request("/api/v1/sessions"));
    assert.equal(response.status, 200);
    const body = response.body as SessionsResponse;
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0]?.phases[0]?.phaseId, "phase-1");
    assert.equal(body.sessions[0]?.agents[0]?.agent, "builder");
    assert.equal(body.sessions[0]?.agents[0]?.sandboxBadge, "tool-policy");
    assert.equal(body.sessions[0]?.agents[0]?.sandboxMechanism, "adapter-tool-policy");
    assert.ok((body.sessions[0]?.activity.length ?? 0) > 0);
    assert.ok((body.sessions[0]?.activity.length ?? 0) <= 96);
    assert.deepEqual(
      body.sessions[0]?.activity.map((point) => point.startedAt),
      body.sessions[0]?.activity.map((point) => point.startedAt).toSorted(),
    );
    const eventPoints = body.sessions[0]?.activity.filter((point) => point.source === "event") ?? [];
    assert.deepEqual(eventPoints.map((point) => point.startedAt), [
      "2026-08-08T12:00:01.000Z",
      "2026-08-08T12:05:00.000Z",
      "2026-08-08T12:10:00.000Z",
    ]);
    const start = Date.parse(body.sessions[0]!.startedAt);
    const end = Date.parse(body.sessions[0]!.updatedAt);
    const positions = eventPoints.map((point) => (Date.parse(point.startedAt) - start) / (end - start));
    assert.ok(positions[1]! > 0.4 && positions[2]! > 0.8, "later canonical events occupy later timeline positions");
    assert.equal(JSON.stringify(body).includes("continuity"), false);
  } finally {
    router.close();
    fixture.close();
  }
});

test("legacy null sandbox columns stay null at the API boundary", async () => {
  const fixture = apiFixture();
  fixture.writer.prepare("UPDATE agent_sessions SET sandbox_badge=NULL, sandbox_mechanism=NULL WHERE session_id='session-1'").run();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const response = await router.dispatch(request("/api/v1/sessions"));
    const agent = (response.body as SessionsResponse).sessions[0]?.agents[0];
    assert.equal(agent?.sandboxBadge, null);
    assert.equal(agent?.sandboxMechanism, null);
  } finally { router.close(); fixture.close(); }
});

test("session and phase detail expose summaries but no private file, process, or continuity references", async () => {
  const fixture = apiFixture();
  const summaryDir = join(dirname(fixture.path), "projects", "test-project", "tasks", "T23", "1");
  await mkdir(summaryDir, { recursive: true });
  await writeLandingSummary(summaryDir, {
    problem: "Build the API",
    changes: "feat: add the read surface\n2 files changed",
    verification: "- Deterministic gates: passed",
    risks: "- Risk tier: T1",
  });
  await mkdir(join(dirname(summaryDir), "run-reports"), { recursive: true });
  await writeFile(join(dirname(summaryDir), "run-reports", "attempt-1-owner-readable.md"), "# Run report\n");
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const sessionResponse = await router.dispatch(request("/api/v1/sessions/session-1"));
    const session = sessionResponse.body as SessionDetailResponse;
    assert.equal(session.transitions[0]?.edgeId, "L4");
    assert.equal(session.gates[0]?.passed, true);
    assert.equal(session.processes[0]?.adapterId, "pi-codex");
    assert.equal(session.runReportPath, "run-reports/attempt-1-owner-readable.md");
    assert.deepEqual(session.landingSummary, {
      problem: "Build the API",
      changes: "feat: add the read surface\n2 files changed",
      verification: "- Deterministic gates: passed",
      risks: "- Risk tier: T1",
    });

    const phaseResponse = await router.dispatch(request("/api/v1/sessions/session-1/phases/phase-1"));
    assert.equal(phaseResponse.status, 200);
    const keyResponse = await router.dispatch(request("/api/v1/sessions/session-1/phases/builder"));
    assert.equal(keyResponse.status, 200, "safe phase keys support direct dashboard URLs when durable IDs contain punctuation");
    const phase = phaseResponse.body as PhaseDetailResponse;
    assert.equal((keyResponse.body as PhaseDetailResponse).phase.phaseId, phase.phase.phaseId);
    assert.deepEqual(
      phase.envelopes.map((envelope) => ({ round: envelope.correctionRound, valid: envelope.valid })),
      [{ round: 0, valid: true }, { round: 1, valid: false }],
      "all rounds, including invalid retained output, stay inspectable",
    );
    const privateSystemPromptPath = "/home/operator/.local/state/awsf/private/system-prompt.md";
    const privateWorktreePath = "/home/operator/.local/state/awsf/worktrees/session-1";
    const queryRows = processesForSession(fixture.writer, "session-1");
    assert.equal(JSON.stringify(queryRows).includes(privateSystemPromptPath), false);
    assert.equal(JSON.stringify(queryRows).includes(privateWorktreePath), false);
    assert.equal(Object.hasOwn(queryRows[0] ?? {}, "command_json"), false);
    assert.equal(Object.hasOwn(queryRows[0] ?? {}, "cwd_display"), false);

    const serialized = JSON.stringify({ session, phase });
    assert.equal(serialized.includes("must-not-leak"), false);
    assert.equal(serialized.includes("private/envelope.json"), false);
    assert.equal(serialized.includes("private://continuity-1"), false);
    assert.equal(serialized.includes("command_json"), false);
    assert.equal(serialized.includes("cwd_display"), false);
    assert.equal(serialized.includes(privateSystemPromptPath), false);
    assert.equal(serialized.includes(privateWorktreePath), false);
  } finally {
    router.close();
    fixture.close();
  }
});

test("events use a bounded row cursor, insertion order, and private payload suppression", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const firstResponse = await router.dispatch(request("/api/v1/sessions/session-1/events?after=0&limit=2"));
    const first = firstResponse.body as EventsResponse;
    assert.deepEqual(first.events.map((event) => event.row), [1, 2]);
    assert.equal(first.cursor, 2);
    assert.equal(first.hasMore, true);
    assert.equal(JSON.stringify(first).includes("must-not-leak"), false);
    assert.equal(JSON.stringify(first).includes("private://ref"), false);

    const secondResponse = await router.dispatch(request(`/api/v1/sessions/session-1/events?after=${first.cursor}&limit=2`));
    const second = secondResponse.body as EventsResponse;
    assert.deepEqual(second.events.map((event) => event.row), [3]);
    assert.deepEqual(second.events[0]?.payload, {});
    assert.equal(second.cursor, 3);
    assert.equal(second.hasMore, false);
  } finally {
    router.close();
    fixture.close();
  }
});

test("malformed and out-of-range query values are wrapped and do not poison later requests", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    for (const url of [
      "/api/v1/sessions/session-1/events?after=1x",
      "/api/v1/sessions/session-1/events?limit=501",
      "/api/v1/sessions?archived=yes",
      "/api/v1/sessions?unexpected=true",
    ]) {
      assert.equal((await router.dispatch(request(url))).status, 400, url);
    }
    assert.equal((await router.dispatch(request("/api/v1/health"))).status, 200);
  } finally {
    router.close();
    fixture.close();
  }
});

test("invalid authority and unsafe dynamic segments are rejected before route lookup", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    assert.equal((await router.dispatch({ method: "GET", url: "/api/v1/health", headers: { host: "example.com" } })).status, 400);
    assert.equal((await router.dispatch(request("/api/v1/sessions/a%2Fb"))).status, 400);
    assert.equal((await router.dispatch(request("/api/v1/sessions/session-1", "POST"))).status, 405);
  } finally {
    router.close();
    fixture.close();
  }
});

test("the read connection is readonly and the archive connection opens lazily and separately", async () => {
  const fixture = apiFixture();
  const opens: Array<OpenDatabaseOptions | undefined> = [];
  const router = createApiRouter({
    dbPath: fixture.path,
    config: fixture.config,
    open: (path, options) => {
      opens.push(options);
      return openDatabase(path, options);
    },
  });
  try {
    assert.deepEqual(opens, [{ readonly: true }]);
    assert.equal((await router.dispatch(request("/api/v1/health"))).status, 200);
    assert.deepEqual(opens, [{ readonly: true }]);
    const archived = await router.dispatch(request("/api/v1/sessions/session-1/archive", "POST"));
    assert.deepEqual(archived.body, { archived: true });
    assert.equal(opens.length, 2);
    assert.equal(opens[1], undefined);
    await router.dispatch(request("/api/v1/sessions/session-1/archive", "POST"));
    assert.equal(opens.length, 2);
  } finally {
    router.close();
    fixture.close();
  }
});

test("archive changes only review-list visibility, never lifecycle, Git, or configuration evidence", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const before = fixture.writer.prepare(`SELECT lifecycle_state, state_revision, base_sha,
      head_sha, candidate_sha, config_snapshot_json, archived FROM sessions WHERE session_id='session-1'`).get() as Record<string, unknown>;
    const response = await router.dispatch(request("/api/v1/sessions/session-1/archive", "POST"));
    assert.equal(response.status, 200);
    const after = fixture.writer.prepare(`SELECT lifecycle_state, state_revision, base_sha,
      head_sha, candidate_sha, config_snapshot_json, archived FROM sessions WHERE session_id='session-1'`).get() as Record<string, unknown>;
    assert.deepEqual({ ...after }, { ...before, archived: 1 });
  } finally { router.close(); fixture.close(); }
});

test("settings are redacted and adapter health is a read-only configured view", async () => {
  const fixture = apiFixture();
  const claude = fixture.config.adapters.claude;
  assert.ok(claude, "the fixture configures a claude adapter");
  claude.executable = "/private/machine/claude";
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const settings = await router.dispatch(request("/api/v1/settings"));
    assert.equal(JSON.stringify(settings.body).includes("/private/machine/claude"), false);
    assert.equal(JSON.stringify(settings.body).includes("[REDACTED]"), true);
    const adapters = await router.dispatch(request("/api/v1/adapters"));
    assert.equal(adapters.status, 200);
    assert.match(JSON.stringify(adapters.body), /claude-code/);
  } finally {
    router.close();
    fixture.close();
  }
});
