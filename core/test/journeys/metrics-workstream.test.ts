// One synthetic state root across W18: journal -> projection -> attribution ->
// API -> scoped readout/advisory -> raw JSON Lines -> rebuild parity. No agents.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiRouter } from "../../src/api/routes.ts";
import { main } from "../../src/cli/main.ts";
import { attributeCommand } from "../../src/cli/commands/attribute.ts";
import { createDashboardProjection, type DashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { rebuildCommand } from "../../src/cli/commands/operator.ts";
import { readMetricsPayload, metricsFilter, metricsReadout } from "../../src/cli/commands/metrics.ts";
import { ADVISORY_END, metricsAdvisoryReadout } from "../../src/cli/commands/metrics-advisory.ts";
import type { MetricsExportHeader } from "../../src/cli/commands/metrics-export.ts";
import type { TaskState } from "../../src/state/task-machine.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import type { MetricsResponse } from "../../../dashboard/shared/types.ts";
import { frontier, routeKey, stats } from "../../../dashboard/shared/route-metrics.ts";
import { listPrice } from "../../../dashboard/shared/rate-card.ts";
import { validConfig } from "../unit/config/fixture.ts";
import { AT, OPUS_HIGH, SNAPSHOT, phase, session, SyntheticAttempt, usage } from "../unit/_metrics-journal.ts";

const TASK_CLASS = "bounded-source-change";
const REPLAY = { itemId: "review-01", itemDigest: "a".repeat(64), arm: "claude:opus@high", repetition: 1, order: 1, baseSha: "b".repeat(40) };

function agent(run: SyntheticAttempt, key: string, role: "builder" | "reviewer", ordinal: number,
  options: { blocked?: boolean; unconfirmed?: boolean; unpriced?: boolean; partial?: boolean } = {}): void {
  const id = `${run.init.sessionId}:${key}`;
  const model = options.unpriced ? "future-model" : "claude-opus-5-5";
  const record = { phaseId: id, ordinal };
  run.phase(phase(key, role, record));
  run.start(id, role, "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: key });
  run.event(id, id, { kind: "run.started", adapter: "claude-code", requestedModel: "opus" });
  run.event(id, id, { kind: "model.resolved", adapter: "claude-code", provider: "anthropic",
    requestedModel: "opus", resolvedModel: model, provenance: options.unconfirmed ? "route-attributed" : "stream-authoritative" });
  run.event(id, id, { kind: "usage", usage: { ...usage(1000, 100, 2000, 0, 20), outputTokens: options.partial ? null : 100 } });
  if (options.partial) run.push({ type: "agent", phaseId: id, agent: role, adapterId: "claude", provider: "anthropic",
    color: null, requestedModel: "claude:opus", resolvedModel: model, modelProvenance: "stream-authoritative",
    contextWindow: 200_000, usageAuthority: "partial", usage: { ...usage(1000, 100, 2000, 0, 20), outputTokens: null },
    contextTokens: null, costUsd: null, costAuthority: "unavailable", purpose: role === "builder" ? "build" : "review", at: AT });
  run.envelope(id, role, 0, "success");
  run.gate(id, 0, "writes_within_globs", !options.blocked);
  if (role === "reviewer") run.review(id, "accept");
  run.phase(phase(key, role, { ...record, status: options.blocked ? "FAILED" : "SUCCEEDED",
    errorCode: options.blocked ? "PermissionBreach" : null, endedAt: "2026-09-26T10:10:00.000Z" }));
}

async function drive(stateRoot: string, repository: string, projection: DashboardProjection, run: SyntheticAttempt, ticket: string): Promise<void> {
  const shift = run.init.workflowId === "shift" ? sealShiftManifest({ plan: "fixture", milestones: ["M1"],
    tickets: [{ id: "T01", path: "T01.md", digest: ticketFileDigest(Buffer.from(ticket)) }] }) : undefined;
  const created = await newCommand({ stateRoot, project: "awsf", taskId: run.init.taskId, repository,
    request: "synthetic workstream", workflow: run.init.workflowId, tier: 2, configSnapshotJson: JSON.stringify(SNAPSHOT),
    ...(shift === undefined ? {} : { shift }), ...(run.replay === null ? {} : { replay: run.replay }),
    now: () => AT, sessionId: () => run.init.sessionId, projectRecord: projection.project });
  let status = created.status;
  for (const record of run.records) {
    if (record.evidence === undefined) continue;
    status = await persistAttempt(created.attemptDir, status.revision, { kind: "attempt.updated",
      next: nextRevision(status, { lifecycleState: record.lifecycleState as TaskState, lastActivity: "synthetic workstream" }),
      evidence: record.evidence }, projection.project);
  }
}

test("shift, build-review, blocked run and replay agree across API, advisory, export and rebuild", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "awsf-workstream-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state"), repository = join(root, "repository");
  mkdirSync(repository);
  const ticket = `---\nid: T01\ntitle: Fixture\nmilestone: M1\nstate: todo\ndepends_on: []\ntask_class: ${TASK_CLASS}\n---\n## Build prompt\n\n\`\`\`\nBuild.\n\`\`\`\n`;
  writeFileSync(join(repository, "T01.md"), ticket);
  const shift = new SyntheticAttempt(session("shift"));
  agent(shift, "t01-build", "builder", 1, { unconfirmed: true });
  shift.phase(phase("t01-tests", "host", { kind: "code", ordinal: 2, status: "SUCCEEDED", endedAt: AT }));
  agent(shift, "shift-review", "reviewer", 3, { unconfirmed: true });
  shift.transition("AWAITING_OWNER").transition("LANDING").transition("LANDED");
  const build = new SyntheticAttempt({ ...session("build-review"), workflowId: "build-review" });
  agent(build, "build", "builder", 1, { partial: true });
  agent(build, "review", "reviewer", 2);
  build.transition("AWAITING_OWNER").transition("LANDING").transition("LANDED");
  const blocked = new SyntheticAttempt({ ...session("blocked"), workflowId: "build-review" });
  agent(blocked, "build", "builder", 1, { blocked: true });
  blocked.transition("BLOCKED", "PermissionBreach");
  const replay = new SyntheticAttempt({ ...session("replay"), workflowId: "prove" });
  replay.replay = REPLAY;
  agent(replay, "review", "reviewer", 1, { unconfirmed: true, unpriced: true });
  replay.transition("AWAITING_OWNER").transition("CANCELLED");
  const projection = createDashboardProjection(stateRoot);
  try {
    for (const run of [shift, build, blocked, replay]) await drive(stateRoot, repository, projection, run, ticket);
    const before = readMetricsPayload(join(stateRoot, "awsf.db"), AT);
    assert.equal(before.roleRows.find((row) => row.sessionId === "blocked")!.blockedHere, true);
    const attributed = await attributeCommand({ stateRoot, project: "awsf", taskId: blocked.init.taskId, attempt: 1,
      cause: "owner", reason: "synthetic owner-requested protected path", now: () => AT,
      terminal: { interactive: true, write: () => {}, confirm: async () => true }, projectAttribution: projection.projectAttribution });
    assert.equal(attributed.confirmed, true);
  } finally { projection.close(); }

  const config = validConfig();
  const router = createApiRouter({ dbPath: join(stateRoot, "awsf.db"), config, planSources: [] });
  let payload: MetricsResponse;
  try {
    const response = await router.dispatch({ method: "GET", url: "/api/v1/metrics", headers: { host: "127.0.0.1:4600" } });
    assert.equal(response.status, 200);
    payload = JSON.parse(JSON.stringify(response.body)) as MetricsResponse;
  } finally { router.close(); }
  assert.equal(payload.runs.length, 4);
  assert.equal(payload.roleRows.length, 6);
  const attributed = payload.roleRows.find((row) => row.sessionId === "blocked")!;
  assert.deepEqual([attributed.attribution, attributed.attributionSource, attributed.heuristicAttribution, attributed.blockedHere],
    ["owner", "owner", "model", false]);
  const shiftRow = payload.roleRows.find((row) => row.sessionId === "shift" && row.role === "builder")!;
  assert.equal(shiftRow.taskClass, TASK_CLASS);
  assert.equal(shiftRow.identityProvenance, "route-attributed");
  const replayRow = payload.roleRows.find((row) => row.sessionId === "replay")!;
  assert.deepEqual([replayRow.source, replayRow.itemId, replayRow.arm, replayRow.repetition, replayRow.order],
    ["proving-ground", REPLAY.itemId, REPLAY.arm, 1, 1]);
  assert.equal(routeKey(replayRow.route), routeKey(shiftRow.route));
  assert.equal(listPrice(replayRow), null, "unpriced replay is retained raw");
  const partial = payload.roleRows.find((row) => row.sessionId === "build-review" && row.role === "builder")!;
  assert.equal(partial.tokens.outputTokens, null);
  assert.equal(stats([partial], listPrice).unrankable, 1);
  assert.equal(frontier(payload.roleRows.filter((row) => row.taskClass === "unclassified" && row.source === "production"), "builder", "first-pass", "list-per-row", listPrice).excluded, 1);
  const advice = await metricsAdvisoryReadout(payload, { config });
  assert.ok(advice.some((line) => line.includes("identity unconfirmed")));
  assert.equal(advice.filter((line) => line === ADVISORY_END).length, 3);
  assert.ok(advice.includes(`Route advisory · builder · ${TASK_CLASS} · production evidence`));
  assert.ok(metricsReadout(payload, metricsFilter({ taskClass: TASK_CLASS })).includes(`Task class: ${TASK_CLASS}`));

  const out: string[] = [], err: string[] = [];
  assert.equal(await main({ cwd: repository, argv: ["metrics", "export", "--state-root", stateRoot],
    writeOut: (line) => out.push(line), writeError: (line) => err.push(line) }), 0, err.join("\n"));
  const path = out[0]!.slice("Export: ".length);
  assert.ok(path.startsWith(join(stateRoot, "exports/route-metrics/")));
  const content = readFileSync(path, "utf8"), boundary = content.indexOf("\n");
  const header = JSON.parse(content.slice(0, boundary)) as MetricsExportHeader;
  const rowsText = content.slice(boundary + 1);
  const rows = rowsText.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(rows, payload.roleRows, "every raw API role-row survives exactly, including identityProvenance");
  assert.equal(header.schema, payload.schema);
  assert.equal(header.checkedAt, payload.rateCard.checkedAt);
  assert.equal(header.rowCount, rows.length);
  assert.ok(!Number.isNaN(Date.parse(header.extractedAt)));
  assert.equal(header.rowsSha256, createHash("sha256").update(rowsText).digest("hex"));
  assert.equal(out[1], `SHA-256 (rows): ${header.rowsSha256}`);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(join(stateRoot, `awsf.db${suffix}`), { force: true });
  const rebuilt = await rebuildCommand(stateRoot);
  assert.equal(rebuilt.ok, true);
  assert.deepEqual(readMetricsPayload(join(stateRoot, "awsf.db"), payload.extractedAt), payload);
  assert.equal(readFileSync(path, "utf8"), content, "rebuild never changes the export");
});
