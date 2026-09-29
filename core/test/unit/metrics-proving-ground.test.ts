// W18 task 13: the proving-ground evidence source end to end. The projector
// writes a replay's record once, as a session-level event; role-rows carry
// their source and the replay's item, arm, repetition and order; production
// statistics leave replay rows out unless the Evidence source ladder selects
// them; and `awsf metrics --source proving-ground` prints the route-arm scores
// per item and arm, as the scorer computes them. One synthetic database;
// nothing here reads the owner's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { metricsCommand, metricsFilter, metricsReadout, routeArmReadout } from "../../src/cli/commands/metrics.ts";
import type { ProvingGroundItem, ReplayRecord } from "../../src/contracts/proving-ground.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import { buildMetricsPayload } from "../../src/metrics/payload.ts";
import { readRoleRows } from "../../src/metrics/role-rows.ts";
import { readReplayOutcomes, routeArmProtocol, routeArmReplays } from "../../src/metrics/route-arm-replays.ts";
import { scoreRouteArms, type RouteArmReplay, type RouteArmScore } from "../../src/metrics/route-arm-score.ts";
import { projectAttemptStatus } from "../../src/observability/projector.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { PROVING_GROUND_DIR } from "../../src/workflow/prove/corpus.ts";
import type { MetricsResponse } from "../../../dashboard/shared/types.ts";
import { listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { EVIDENCE_SOURCES, evidenceSource, stats, type Interval } from "../../../dashboard/shared/route-metrics.ts";
import { DEFAULT_METRICS_ROUTE, facetOptions, rowsInLens, summaryStats, withSelection } from "../../../dashboard/src/metrics-lens.ts";
import { MetricsResponseSchema } from "./_metrics-schemas.ts";
import { AT, SyntheticAttempt, phase, route, session, usage } from "./_metrics-journal.ts";

const EXTRACTED_AT = "2026-09-29T12:00:00.000Z";
const OPUS = "claude/anthropic/claude:opus@high";
const SOL = "codex/openai-codex/codex:gpt-6-sol@xhigh";
const ENDED = "2026-09-26T10:10:00.000Z";

/** Each arm as its adapter launched it: the effective route the phase columns hold. */
const ROUTES = {
  [OPUS]: { adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus", effort: "high", requested: "claude:opus", resolved: "claude-opus-5-5" },
  [SOL]: { adapterId: "codex", adapterKind: "pi-codex", provider: "openai-codex", model: "gpt-6-sol", effort: "xhigh", requested: "codex:gpt-6-sol", resolved: "gpt-6-sol" },
} as const;

const CORPUS: readonly ProvingGroundItem[] = [
  review("probe-01", { file: "README.md", lineStart: 20, lineEnd: 22 }),
  review("probe-02", { file: "src/a.ts", lineStart: 5, lineEnd: 5 }),
  {
    schema: "awsf.proving-ground-item/v1", id: "probe-03", kind: "build", taskClass: "bounded-build", role: "builder",
    baseSha: "a".repeat(40), request: "Make the probe pass.", gates: ["test"], acceptance: ["the probe passes"],
  },
];

function review(id: string, expected: { file: string; lineStart: number; lineEnd: number }): ProvingGroundItem {
  return {
    schema: "awsf.proving-ground-item/v1", id, kind: "review", taskClass: "evidence-heavy-defect-review", role: "reviewer",
    baseSha: "a".repeat(40), request: `Review ${id}.`,
    seed: { patch: `${PROVING_GROUND_DIR}/${id}.patch`, defectClass: "off-by-one", expected: [expected] },
  };
}

function record(itemId: string, arm: string, repetition: number, order: number): ReplayRecord {
  return { itemId, itemDigest: "0".repeat(64), arm, repetition, order, baseSha: "a".repeat(40) };
}

/** One replay attempt: its record on every status, and its one agent phase on the arm's route. */
function replayRun(sessionId: string, replay: ReplayRecord, role: "reviewer" | "builder"): { run: SyntheticAttempt; phaseId: string } {
  const arm = ROUTES[replay.arm as keyof typeof ROUTES];
  const run = new SyntheticAttempt({ ...session(sessionId), workflowId: "prove" });
  run.replay = replay;
  const phaseId = `${sessionId}:${role}`;
  run.phase(phase(role, role, { phaseId, ordinal: 4 }));
  run.start(phaseId, role, arm.adapterId, arm.provider, arm.requested, route(role, {
    adapterId: arm.adapterId, adapterKind: arm.adapterKind, provider: arm.provider, model: arm.model, effort: arm.effort,
  }, "attempt-override", arm.requested));
  run.call(phaseId, role, arm.adapterId, arm.provider, arm.requested, arm.resolved, usage(1_000, 200, 0, 0, null));
  return { run, phaseId };
}

interface ReviewShape {
  readonly valid?: boolean;
  readonly paused?: boolean;
}

/** A review replay: the reviewer's one envelope carries these findings, then the owner cancels it. */
function reviewReplay(sessionId: string, replay: ReplayRecord, findings: ReadonlyArray<readonly [string, number | null]>, shape: ReviewShape = {}): SyntheticAttempt {
  const { run, phaseId } = replayRun(sessionId, replay, "reviewer");
  const valid = shape.valid ?? true;
  const payload: ReviewOutput = {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "synthetic review", artifacts: [], notesForNextPhase: "",
    verdict: "accept", reviewedSha: "0".repeat(40), limitations: [],
    findings: findings.map(([file, line], index) => ({
      id: `f${String(index)}`, severity: "high", file, line, title: "finding", detail: "detail", consequence: "consequence", evidence: "evidence",
    })),
  };
  run.push({
    type: "envelope", phaseId,
    envelope: {
      envelopeId: `${phaseId}:0`, sessionId, phaseId, correctionRound: 0, agent: "reviewer", schemaId: "awsf.review-output/v1",
      valid, createdAt: AT, payload: valid ? payload : null, violations: [], rawOutputPath: `raw/${phaseId}-0.txt`,
    },
  });
  const failure = shape.paused === true ? "CallCeilingExceeded" : valid ? null : "EnvelopeValidationFailure";
  run.phase(phase("reviewer", "reviewer", {
    phaseId, ordinal: 4, status: failure === null ? "SUCCEEDED" : "FAILED", errorCode: failure, endedAt: ENDED,
  }));
  if (failure !== null) return run.transition("BLOCKED", failure);
  return run.transition("AWAITING_OWNER").transition("CANCELLED");
}

/** A build replay: one builder envelope, then the configured commands' round-0 aggregate. `null` never reaches the tests. */
function buildReplay(sessionId: string, replay: ReplayRecord, testPassed: boolean | null): SyntheticAttempt {
  const { run, phaseId } = replayRun(sessionId, replay, "builder");
  if (testPassed === null) return run;
  run.envelope(phaseId, "builder", 0, "success");
  run.phase(phase("builder", "builder", { phaseId, ordinal: 4, status: "SUCCEEDED", endedAt: ENDED }));
  const tests = `${sessionId}:tests`;
  run.phase(phase("tests", "host", { phaseId: tests, ordinal: 5, kind: "code", status: "SUCCEEDED", endedAt: ENDED }));
  run.push({
    type: "gate", id: `${tests}:0:commands_pass`, phaseId: tests, round: 0, gateId: "commands_pass", kind: "subprocess",
    candidateSha: null, passed: testPassed, exitCode: testPassed ? 0 : -1,
    checks: [{ item: "test:exit", ok: testPassed, note: "exit status" }, { item: "typecheck:exit", ok: true, note: "exit status" }],
    violations: [], outputPath: null, startedAt: AT, endedAt: AT,
  });
  return run.transition("AWAITING_OWNER").transition("CANCELLED");
}

/** A landed production run: one builder, so its row is the production evidence the replays must not join. */
function production(sessionId: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session(sessionId));
  const build = `${sessionId}:builder`;
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1 }));
  run.start(build, "builder", "codex", "openai-codex", "codex:gpt-6-sol");
  run.call(build, "builder", "codex", "openai-codex", "codex:gpt-6-sol", "gpt-6-sol", usage(50_000, 5_000, 0, 0, null));
  run.envelope(build, "builder", 0, "success");
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1, status: "SUCCEEDED", endedAt: ENDED }));
  return run.transition("AWAITING_OWNER").transition("LANDING").transition("LANDED");
}

/**
 * Two arms, three items and two repetitions. probe-01 has both pairs valid;
 * probe-02's first pair pauses one arm at its ceiling and leaves the other's
 * envelope invalid, and its second pair is missing; probe-03 is a build item
 * whose second pair is still running on one arm. probe-99 is outside the corpus.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awsf-proving-ground-"));
  const repository = join(root, "repo");
  mkdirSync(join(repository, PROVING_GROUND_DIR), { recursive: true });
  for (const item of CORPUS) writeFileSync(join(repository, PROVING_GROUND_DIR, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
  const runs = [
    production("p1"),
    reviewReplay("r01-1-opus", record("probe-01", OPUS, 1, 1), [["README.md", 21]]),
    reviewReplay("r01-1-sol", record("probe-01", SOL, 1, 2), [["src/other.ts", 3]]),
    reviewReplay("r01-2-sol", record("probe-01", SOL, 2, 1), [["README.md", null]]),
    reviewReplay("r01-2-opus", record("probe-01", OPUS, 2, 2), [["README.md", 25]]),
    reviewReplay("r02-1-opus", record("probe-02", OPUS, 1, 1), [], { paused: true }),
    reviewReplay("r02-1-sol", record("probe-02", SOL, 1, 2), [], { valid: false }),
    buildReplay("r03-1-sol", record("probe-03", SOL, 1, 1), false),
    buildReplay("r03-1-opus", record("probe-03", OPUS, 1, 2), true),
    buildReplay("r03-2-opus", record("probe-03", OPUS, 2, 1), null),
    reviewReplay("r99-1-opus", record("probe-99", OPUS, 1, 1), [["README.md", 1]]),
  ];
  const dbPath = join(root, "awsf.db");
  const writer = openDatabase(dbPath);
  try {
    for (const run of runs) run.project(writer);
  } finally {
    writer.close();
  }
  return { dbPath, repository, runs };
}

function payloadOf(dbPath: string): MetricsResponse {
  const reader = openDatabase(dbPath, { readonly: true });
  try {
    return JSON.parse(JSON.stringify(buildMetricsPayload(reader, { extractedAt: EXTRACTED_AT }))) as MetricsResponse;
  } finally {
    reader.close();
  }
}

const OBSERVED = {
  [OPUS]: { provider: "anthropic", model: "opus" },
  [SOL]: { provider: "openai-codex", model: "gpt-6-sol" },
} as const;

/** What the scorer should receive, written out by hand rather than derived. */
function expectedReplays(): RouteArmReplay[] {
  const base = (itemId: string, arm: typeof OPUS | typeof SOL, repetition: number, order: number) => ({
    itemId, arm, repetition, order, observed: OBSERVED[arm], usageAuthority: "provider" as const, envelopeValid: true, pausedAtCeiling: false,
  });
  const findings = (...list: ReadonlyArray<readonly [string, number | null]>) => ({ kind: "review" as const, findings: list.map(([file, line]) => ({ file, line })) });
  return [
    { ...base("probe-01", OPUS, 1, 1), outcome: findings(["README.md", 21]) },
    { ...base("probe-01", SOL, 1, 2), outcome: findings(["src/other.ts", 3]) },
    { ...base("probe-01", SOL, 2, 1), outcome: findings(["README.md", null]) },
    { ...base("probe-01", OPUS, 2, 2), outcome: findings(["README.md", 25]) },
    { ...base("probe-02", OPUS, 1, 1), pausedAtCeiling: true, outcome: findings() },
    { ...base("probe-02", SOL, 1, 2), envelopeValid: false, outcome: null },
    { ...base("probe-03", SOL, 1, 1), outcome: { kind: "build", firstRoundGates: { commands_pass: false, test: false, typecheck: true } } },
    { ...base("probe-03", OPUS, 1, 2), outcome: { kind: "build", firstRoundGates: { commands_pass: true, test: true, typecheck: true } } },
    // Still running: no envelope was ever invalid, and no gate has run.
    { ...base("probe-03", OPUS, 2, 1), outcome: { kind: "build", firstRoundGates: {} } },
    { ...base("probe-99", OPUS, 1, 1), outcome: null },
  ];
}

function sorted(replays: readonly RouteArmReplay[]): RouteArmReplay[] {
  return [...replays].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.repetition - b.repetition || a.order - b.order);
}

test("the projector writes a replay's record once, as a session-level event, and a production run has none", () => {
  const { dbPath, runs } = fixture();
  const replays = (): Array<{ session_id: string; phase_id: string | null; first_source_seq: number; payload_json: string }> => {
    const reader = openDatabase(dbPath, { readonly: true });
    try {
      return reader.prepare(`SELECT session_id, phase_id, first_source_seq, payload_json FROM events
        WHERE type = 'replay' ORDER BY session_id`).all() as Array<{ session_id: string; phase_id: string | null; first_source_seq: number; payload_json: string }>;
    } finally {
      reader.close();
    }
  };
  const before = replays();
  assert.equal(before.length, runs.length - 1, "one row per replay session, none for p1");
  const first = before.find((row) => row.session_id === "r01-1-opus")!;
  assert.equal(first.phase_id, null);
  assert.equal(first.first_source_seq, 1, "written by the attempt's first record");
  assert.deepEqual(JSON.parse(first.payload_json), record("probe-01", OPUS, 1, 1));
  assert.ok(runs[1]!.records.length > 5, "every later record carried the same replay");

  // Applying every record again is a no-op, as a rebuild's replay of the journal is.
  const writer = openDatabase(dbPath);
  try {
    for (const run of runs) run.records.forEach((status, index) => assert.equal(projectAttemptStatus(writer, status, index + 1).applied, false));
  } finally {
    writer.close();
  }
  assert.deepEqual(replays(), before);
});

test("role-rows carry their evidence source and the replay's item, arm, repetition and order", () => {
  const { dbPath } = fixture();
  const reader = openDatabase(dbPath, { readonly: true });
  try {
    const rows = readRoleRows(reader);
    for (const row of rows) assert.equal(row.source, evidenceSource(row), `${row.sessionId} ${row.role}`);
    const pick = (sessionId: string) => {
      const row = rows.find((candidate) => candidate.sessionId === sessionId)!;
      return [row.role, row.source, row.itemId, row.arm, row.repetition, row.order];
    };
    assert.deepEqual(pick("r01-2-sol"), ["reviewer", "proving-ground", "probe-01", SOL, 2, 1]);
    assert.deepEqual(pick("r03-1-opus"), ["builder", "proving-ground", "probe-03", OPUS, 1, 2]);
    assert.deepEqual(pick("p1"), ["builder", "production", null, null, null, null]);
  } finally {
    reader.close();
  }
  const payload = payloadOf(dbPath);
  assert.equal(Value.Check(MetricsResponseSchema, payload), true, JSON.stringify([...Value.Errors(MetricsResponseSchema, payload)].slice(0, 5)));
});

test("production statistics leave replay rows out unless the Evidence source ladder selects them", () => {
  const { dbPath } = fixture();
  const payload = payloadOf(dbPath);
  const productionRows = payload.roleRows.filter((row) => row.source === "production");
  const provingRows = payload.roleRows.filter((row) => row.source === "proving-ground");
  assert.equal(productionRows.length, 1);
  assert.equal(provingRows.length, 10);

  // The CLI's default scope.
  const text = metricsReadout(payload, metricsFilter({})).join("\n");
  const production = stats(productionRows, listPrice);
  assert.ok(text.includes(`1 runs (${production.runs} with role-rows) · ${production.n} role-rows`), text);
  assert.doesNotMatch(text, /Route arms/);

  // The tab's default lens, and the ladder selecting either source.
  assert.deepEqual(rowsInLens(payload.roleRows, DEFAULT_METRICS_ROUTE), productionRows);
  assert.deepEqual(summaryStats(rowsInLens(payload.roleRows, DEFAULT_METRICS_ROUTE), listPrice), summaryStats(productionRows, listPrice));
  const sources = [...EVIDENCE_SOURCES];
  assert.deepEqual(rowsInLens(payload.roleRows, withSelection(DEFAULT_METRICS_ROUTE, "source", sources, ["proving-ground"])), provingRows);
  assert.equal(rowsInLens(payload.roleRows, withSelection(DEFAULT_METRICS_ROUTE, "source", sources, sources)).length, payload.roleRows.length);

  // The rail's proving-ground pill is live and carries its count.
  const context = { rateCard: RATE_CARD.rows, roleColors: {} };
  assert.deepEqual(facetOptions(payload.roleRows, DEFAULT_METRICS_ROUTE, "source", context).map((option) => [option.value, option.count]),
    [["production", 1], ["proving-ground", 10]]);
  const tab = readFileSync(new URL("../../../dashboard/src/routes/metrics.vue", import.meta.url), "utf8");
  const start = tab.indexOf('v-for="pill in sourcePills"');
  const pill = tab.slice(start, tab.indexOf("</button>", start));
  assert.ok(start > 0 && /:aria-pressed="pill\.selected"/.test(pill), pill);
  assert.doesNotMatch(pill, /disabled/);
  assert.doesNotMatch(tab, /M4 adds controlled replays|live: value === "production"/);
});

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function cell(interval: Interval): string {
  return interval.p === null ? "–" : `${percent(interval.p)} [${percent(interval.lo)}–${percent(interval.hi)}]`;
}

/** The printed row for one arm under one heading, split into its cells. */
function printed(lines: readonly string[], heading: string, arm: string): string[] {
  const at = lines.indexOf(heading);
  assert.ok(at >= 0, `no heading ${heading}`);
  const row = lines.slice(at + 1).find((line) => line.startsWith(`  ${arm} `));
  assert.ok(row !== undefined, `no row for ${arm} under ${heading}`);
  return row.trim().split(/\s{2,}/u);
}

function reviewCells(score: RouteArmScore): string[] {
  const { review } = score;
  return [score.arm, String(review.replays), String(review.located), cell(review.recall), String(review.fileOnly),
    String(review.falseAlarms), String(score.invalidPairs)];
}

test("awsf metrics --source proving-ground prints the route-arm scores per item and arm, as the scorer computes them", () => {
  const { dbPath, repository } = fixture();
  const payload = payloadOf(dbPath);
  const reader = openDatabase(dbPath, { readonly: true });
  const outcomes = (() => {
    try {
      return readReplayOutcomes(reader);
    } finally {
      reader.close();
    }
  })();

  // The bridge hands the scorer exactly what each replay left behind.
  const proving = payload.roleRows.filter((row) => row.source === "proving-ground");
  const replays = routeArmReplays(proving, outcomes, CORPUS);
  assert.deepEqual(sorted(replays), sorted(expectedReplays()));
  const protocol = routeArmProtocol(replays, CORPUS);
  assert.deepEqual(protocol, { arms: [OPUS, SOL], repetitions: 2, items: CORPUS });
  const suite = scoreRouteArms(protocol!, expectedReplays());

  const lines = metricsCommand({ dbPath, extractedAt: EXTRACTED_AT, source: "proving-ground", repository }) as string[];
  const text = lines.join("\n");
  assert.ok(lines.includes("Route arms · 10 replay(s) in scope"), text);
  assert.ok(lines.includes("2 arms · 2 repetition(s) · 3 item(s) · 3 of 6 pairs valid"), text);
  for (const item of suite.byItem) {
    const heading = `${item.itemId} · ${item.kind} · ${item.role} · ${item.taskClass}`;
    for (const arm of item.arms) {
      assert.deepEqual(printed(lines, heading, arm.arm), item.kind === "review"
        ? reviewCells(arm)
        : [arm.arm, String(arm.build.replays), cell(arm.build.interval), String(arm.invalidPairs)], `${heading} ${arm.arm}`);
    }
  }
  // Read by hand from the fixture: opus located both planted defects, sol located neither.
  assert.deepEqual(printed(lines, "probe-01 · review · reviewer · evidence-heavy-defect-review", OPUS).slice(1, 3), ["2", "2"]);
  assert.deepEqual(printed(lines, "probe-01 · review · reviewer · evidence-heavy-defect-review", SOL).slice(1, 7),
    ["2", "0", "0% [0%–66%]", "1", "1", "0"]);
  const scope = suite.byScope.find((entry) => entry.role === "reviewer")!;
  const scopeHeading = `reviewer · evidence-heavy-defect-review · 2 item(s) · ${String(scope.invalidPairs)} invalid pair(s)`;
  for (const arm of scope.arms) assert.deepEqual(printed(lines, scopeHeading, arm.arm), reviewCells(arm));

  assert.ok(lines.includes(`  probe-02 repetition 1: paused-at-ceiling on ${OPUS} (the replay paused at its call ceiling); ` +
    `envelope-invalid on ${SOL} (the envelope stayed invalid)`), text);
  assert.ok(lines.some((line) => line.startsWith(`  probe-02 repetition 2: replay-missing on ${OPUS} (no replay on this arm)`)), text);
  assert.match(text, /probe-03 repetition 2: .*outcome-missing on claude\/anthropic\/claude:opus@high \(no round-0 result for gate\(s\) test\)/u);
  assert.ok(lines.includes(`  probe-99 on ${OPUS}, repetition 1`), text);
  for (const [index, char] of [...text].entries()) {
    if (char === "$") assert.equal(text.slice(index - 7, index), "≈ list ", "no bare $");
  }

  // --role narrows the replays with the rows: only the build item is scored.
  const builders = metricsCommand({ dbPath, extractedAt: EXTRACTED_AT, source: "proving-ground", role: "builder", repository });
  assert.ok(builders.includes("2 arms · 2 repetition(s) · 1 item(s) · 1 of 2 pairs valid"), builders.join("\n"));
  // One arm alone compares with nothing.
  const alone = routeArmReadout(proving.filter((row) => row.arm === OPUS), { outcomes, corpus: CORPUS });
  assert.ok(alone.includes("No comparison: the replays in scope name fewer than two arms."), alone.join("\n"));
});
