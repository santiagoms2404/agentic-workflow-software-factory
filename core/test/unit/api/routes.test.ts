import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiRouter } from "../../../src/api/routes.ts";
import { processesForSession } from "../../../src/observability/queries.ts";
import { openDatabase, type OpenDatabaseOptions } from "../../../src/observability/sqlite.ts";
import type { SessionsResponse, SessionDetailResponse, PhaseDetailResponse, EventsResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

const headers = { host: "127.0.0.1:4600" };

function request(url: string, method = "GET") {
  return { method, url, headers };
}

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
    assert.equal(JSON.stringify(body).includes("continuity"), false);
  } finally {
    router.close();
    fixture.close();
  }
});

test("session and phase detail expose summaries but no private file, process, or continuity references", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config });
  try {
    const sessionResponse = await router.dispatch(request("/api/v1/sessions/session-1"));
    const session = sessionResponse.body as SessionDetailResponse;
    assert.equal(session.transitions[0]?.edgeId, "L4");
    assert.equal(session.gates[0]?.passed, true);
    assert.equal(session.processes[0]?.adapterId, "pi-codex");

    const phaseResponse = await router.dispatch(request("/api/v1/sessions/session-1/phases/phase-1"));
    assert.equal(phaseResponse.status, 200);
    const phase = phaseResponse.body as PhaseDetailResponse;
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

test("settings are redacted and adapter health is a read-only configured view", async () => {
  const fixture = apiFixture();
  fixture.config.adapters.claude.executable = "/private/machine/claude";
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
