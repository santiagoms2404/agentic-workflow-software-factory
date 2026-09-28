// W18 task 6: one statistics implementation. On one synthetic database the
// module's stats, the stats of the payload `GET /api/v1/metrics` serves, and
// the stats of `awsf metrics --json` agree to the digit, and the readout's
// table prints the module's numbers and nothing of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/api/routes.ts";
import { main } from "../../src/cli/main.ts";
import { metricsCommand, metricsReadout, metricsFilter } from "../../src/cli/commands/metrics.ts";
import { buildMetricsPayload } from "../../src/metrics/payload.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import type { MetricsResponse } from "../../../dashboard/shared/types.ts";
import { formatListEquivalent, listPrice } from "../../../dashboard/shared/rate-card.ts";
import { coverage, frontier, heuristicSplit, routeCells, stats, verdicts } from "../../../dashboard/shared/route-metrics.ts";
import { validConfig } from "./config/fixture.ts";
import { OPUS_HIGH, SyntheticAttempt, phase, session, usage } from "./_metrics-journal.ts";

const headers = { host: "127.0.0.1:4600" };
const CODEX = ["codex", "openai-codex", "codex:gpt-6-sol"] as const;
const LATER = "2026-09-27T10:00:00.000Z";

/** A landed shift: a codex builder observed as gpt-6-sol, and a claude reviewer that never reported a model. */
function landed(sessionId: string, workflowId = "shift", startedAt?: string): SyntheticAttempt {
  const run = new SyntheticAttempt({ ...session(sessionId), workflowId, ...(startedAt === undefined ? {} : { startedAt }) });
  // Phase and run ids are global keys; real ones are session-prefixed too.
  const build = `${sessionId}:builder`, review = `${sessionId}:reviewer`;
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1 }));
  run.start(build, "builder", ...CODEX);
  run.event(build, `${sessionId}-run-1`, { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event(build, `${sessionId}-run-1`, {
    kind: "model.resolved", adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-6-sol",
    resolvedModel: "gpt-6-sol", provenance: "stream-authoritative",
  });
  run.event(build, `${sessionId}-run-1`, { kind: "usage", usage: usage(100_000, 10_000, 400_000, 0, 2_000) });
  run.call(build, "builder", ...CODEX, "gpt-6-sol", usage(100_000, 10_000, 400_000, 0, 2_000));
  run.envelope(build, "builder", 0, "success");
  run.gate(build, 0, "writes_within_globs", true);
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1, status: "SUCCEEDED", endedAt: "2026-09-26T10:10:00.000Z" }));
  run.phase(phase("reviewer", "reviewer", { phaseId: review, ordinal: 2 }));
  run.start(review, "reviewer", "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: "reviewer" });
  run.event(review, `${sessionId}-run-2`, { kind: "usage", usage: usage(20_000, 3_000, 50_000, 10_000, null) });
  run.envelope(review, "reviewer", 0, "success");
  run.review(review, "accept");
  run.phase(phase("reviewer", "reviewer", { phaseId: review, ordinal: 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:12:00.000Z" }));
  run.transition("AWAITING_OWNER");
  run.transition("LANDING");
  run.transition("LANDED");
  return run;
}

/** A blocked run: the builder breaches its write boundary, a model attribution. */
function blocked(sessionId: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session(sessionId));
  const build = `${sessionId}:builder`;
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1, maxCorrections: 0 }));
  run.start(build, "builder", ...CODEX);
  run.event(build, `${sessionId}-run-1`, { kind: "usage", usage: usage(40_000, 4_000, 0, 0, null) });
  run.envelope(build, "builder", 0, "success");
  run.gate(build, 0, "writes_within_globs", false);
  run.phase(phase("builder", "builder", {
    phaseId: build, ordinal: 1, maxCorrections: 0, status: "FAILED", errorCode: "PermissionBreach", endedAt: "2026-09-26T10:05:00.000Z",
  }));
  run.transition("BLOCKED", "PermissionBreach");
  return run;
}

/** A run blocked in a host phase before any agent phase ran: it has an attribution and no role-row. */
function hostBlocked(sessionId: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session(sessionId));
  run.phase(phase("context", "host", {
    phaseId: `${sessionId}:context`, ordinal: 1, kind: "code", status: "FAILED", errorCode: "Error", endedAt: "2026-09-26T10:01:00.000Z",
  }));
  run.phase(phase("builder", "builder", { phaseId: `${sessionId}:builder`, ordinal: 2, status: "QUEUED", startedAt: null }));
  run.transition("BLOCKED", "Error");
  return run;
}

interface Fixture {
  readonly stateRoot: string;
  readonly dbPath: string;
}

/** Five runs: two landed production shifts (one started a day later), one blocked in its builder, one blocked in a host phase, one proving-ground replay. */
function fixture(): Fixture {
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-metrics-parity-"));
  const dbPath = join(stateRoot, "awsf.db");
  const writer = openDatabase(dbPath);
  try {
    landed("p1").project(writer);
    landed("p2", "shift", LATER).project(writer);
    blocked("p3").project(writer);
    hostBlocked("p5").project(writer);
    landed("p4", "prove").project(writer);
  } finally {
    writer.close();
  }
  return { stateRoot, dbPath };
}

/** Numbers only: JSON drops nothing a statistic carries, and makes -0, undefined and key order irrelevant. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Everything the module derives from a set of rows, per role and per cell as well as over all of them. */
function derived({ runs, roleRows: rows }: Pick<MetricsResponse, "runs" | "roleRows">): unknown {
  const roles = [...new Set(rows.map((row) => row.role))].sort();
  return plain({
    stats: stats(rows, listPrice),
    coverage: coverage(rows),
    heuristic: heuristicSplit(runs),
    cells: routeCells(rows).map((cell) => ({ role: cell.role, key: cell.key, stats: stats(cell.rows, listPrice) })),
    verdicts: roles.map((role) => verdicts(frontier(rows, role, "first-pass", "list-per-row", listPrice))),
  });
}

async function cliLines(argv: readonly string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await main({ argv, writeOut: (line) => lines.push(line), writeError: (line) => lines.push(line) });
  return { code, lines };
}

test("module stats, API payload stats and awsf metrics --json stats agree to the digit", async () => {
  const db = fixture();
  const reader = openDatabase(db.dbPath, { readonly: true });
  const router = createApiRouter({ dbPath: db.dbPath, config: validConfig(), planSources: [] });
  try {
    const built = buildMetricsPayload(reader, { extractedAt: "2026-09-28T00:00:00.000Z" });
    const served = plain((await router.dispatch({ method: "GET", url: "/api/v1/metrics", headers })).body) as MetricsResponse;
    const cli = await cliLines(["metrics", "--json", "--state-root", db.stateRoot]);
    assert.equal(cli.code, 0);
    assert.equal(cli.lines.length, 1, "--json prints one line: the payload");
    const printed = JSON.parse(cli.lines[0]!) as MetricsResponse;

    assert.equal(built.runs.length, 5);
    assert.equal(built.roleRows.length, 7, "two roles in each landed run, one in the builder-blocked run, none in the host-blocked run");
    const expected = derived(built);
    assert.deepEqual(derived(served), expected, "API payload");
    assert.deepEqual(derived(printed), expected, "awsf metrics --json");

    // Beyond the statistics: the three payloads are one payload, but for the read instant.
    const unstamped = (payload: MetricsResponse): unknown => plain({ ...payload, extractedAt: null });
    assert.deepEqual(unstamped(served), unstamped(built));
    assert.deepEqual(unstamped(printed), unstamped(built));
  } finally {
    router.close();
    reader.close();
  }
});

test("--json prints the route's body byte for byte for the same read instant", async () => {
  const db = fixture();
  const router = createApiRouter({ dbPath: db.dbPath, config: validConfig(), planSources: [] });
  try {
    const body = (await router.dispatch({ method: "GET", url: "/api/v1/metrics", headers })).body as MetricsResponse;
    const [line] = metricsCommand({ dbPath: db.dbPath, extractedAt: body.extractedAt, json: true });
    // sendResponse writes JSON.stringify(body); the CLI prints the same string.
    assert.equal(line, JSON.stringify(body));
  } finally {
    router.close();
  }
});

test("the table prints the module's numbers, scoped by the flags, with every price labelled", () => {
  const db = fixture();
  const reader = openDatabase(db.dbPath, { readonly: true });
  let payload: MetricsResponse;
  try {
    payload = plain(buildMetricsPayload(reader, { extractedAt: "2026-09-28T00:00:00.000Z" }));
  } finally {
    reader.close();
  }
  const production = payload.roleRows.filter((row) => row.workflow !== "prove");
  const productionRuns = payload.runs.filter((run) => run.workflow !== "prove");
  const lines = metricsReadout(payload, metricsFilter({}));
  const text = lines.join("\n");
  const all = stats(production, listPrice);
  const cover = coverage(production);
  assert.ok(text.includes(`${productionRuns.length} runs (${all.runs} with role-rows) · ${all.n} role-rows · ${cover.routes} routes · ` +
    `${cover.cells} cells · ${all.refuted} refuted of ${all.claims} claims`), text);
  assert.equal(productionRuns.length, 4, "the proving-ground replay is out of production statistics");
  assert.deepEqual(heuristicSplit(productionRuns), { model: 1, factory: 1 }, "the host-blocked run is counted though it has no row");
  assert.ok(text.includes("Blocked runs by heuristic attribution: factory 1 · model 1"), text);
  for (const cell of routeCells(production)) {
    const s = stats(cell.rows, listPrice);
    const row = lines.slice(lines.indexOf(cell.role) + 1).find((line) => line.startsWith(`  ${cell.key} `));
    assert.ok(row, `a row for ${cell.role} on ${cell.key}`);
    assert.deepEqual(row.slice(2 + cell.key.length).trim().split(/\s+/).slice(0, 2), [String(s.n), String(s.settled)], row);
    assert.ok(row.includes(formatListEquivalent(s.listPerRow)), row);
  }
  for (const [index, char] of [...text].entries()) {
    if (char === "$") assert.equal(text.slice(index - 7, index), "≈ list ", "no bare $");
  }

  const builderOnly = metricsReadout(payload, metricsFilter({ role: "builder" })).join("\n");
  assert.ok(builderOnly.includes("4 runs (3 with role-rows) · 3 role-rows"), builderOnly);
  assert.ok(!builderOnly.includes("\nreviewer\n"), builderOnly);
  const earlier = metricsReadout(payload, metricsFilter({ startedBefore: "2026-09-27T00:00:00Z" })).join("\n");
  assert.ok(earlier.includes("3 runs (2 with role-rows) · 3 role-rows"), earlier);
  const proving = metricsReadout(payload, metricsFilter({ source: "proving-ground" })).join("\n");
  assert.ok(proving.includes("1 runs (1 with role-rows) · 2 role-rows"), proving);
});

test("awsf metrics refuses a filtered --json, an unknown source and a malformed instant", async () => {
  const db = fixture();
  for (const argv of [
    ["metrics", "--json", "--role", "builder"],
    ["metrics", "--source", "staging"],
    ["metrics", "--started-before", "yesterday"],
    ["metrics", "builder"],
    ["metrics", "--limit", "3"],
  ]) {
    const result = await cliLines([...argv, "--state-root", db.stateRoot]);
    assert.notEqual(result.code, 0, argv.join(" "));
  }
  const missing = await cliLines(["metrics", "--state-root", join(db.stateRoot, "absent")]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.lines.join("\n"), /no projection at/);
});

test("awsf metrics writes nothing to the state root", async () => {
  const db = fixture();
  const digest = (name: string): string => createHash("sha256").update(readFileSync(join(db.stateRoot, name))).digest("hex");
  const before = digest("awsf.db");
  assert.equal((await cliLines(["metrics", "--state-root", db.stateRoot])).code, 0);
  assert.equal((await cliLines(["metrics", "--json", "--state-root", db.stateRoot])).code, 0);
  assert.equal(digest("awsf.db"), before, "the database bytes are unchanged");
  // A read-only reader of a WAL database gets SQLite's shared-memory index, as the API's reader does. Its log holds no frame.
  assert.deepEqual(readdirSync(db.stateRoot).filter((name) => !["awsf.db", "awsf.db-shm", "awsf.db-wal"].includes(name)), []);
  if (readdirSync(db.stateRoot).includes("awsf.db-wal")) assert.equal(readFileSync(join(db.stateRoot, "awsf.db-wal")).length, 0);
});
