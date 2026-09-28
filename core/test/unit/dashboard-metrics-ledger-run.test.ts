// W18 task 9: the Ledger's grouping, sorting and flat detection, and the Run
// view's picker, facts, phase strip, per-role table and attribution command,
// over the synthetic payload (core/test/fixtures/metrics/payload.json) and
// hand-built rows. The static checks hold the tab to reading: one GET, no
// write, and a composed command that is only ever text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MetricsResponse, MetricsRoleRow, MetricsRun, MetricsRunPhase } from "../../../dashboard/shared/types.ts";
import { formatListEquivalent, listPrice, RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { STATE_GROUPS, stats } from "../../../dashboard/shared/route-metrics.ts";
import {
  DEFAULT_FAMILIES,
  DEFAULT_METRICS_ROUTE,
  LEDGER_GROUPS,
  metricsRouteHash,
  parseMetricsRoute,
  rowsInLens,
  toToken,
  withFamily,
  withRun,
  withSelection,
  withSort,
} from "../../../dashboard/src/metrics-lens.ts";
import {
  COUNT_COLUMN,
  FLAT_TITLE,
  LEDGER_COLUMNS,
  buildLedger,
  effectiveSort,
  flatColumns,
  groupRows,
  groupValue,
  sortRows,
  terminalStrip,
  visibleColumns,
} from "../../../dashboard/src/metrics-ledger.ts";
import {
  ATTRIBUTION_CAUSES,
  ATTRIBUTION_NOTE,
  MIN_PHASE_WIDTH,
  attributeCommand,
  attributionPanel,
  blockedAt,
  blockedLabel,
  commandReady,
  firstPassMark,
  listByKind,
  phaseStrip,
  quoteReason,
  roleLines,
  runFacts,
  runListTotal,
  runPicker,
} from "../../../dashboard/src/metrics-run.ts";
import { ATTRIBUTION_CAUSES as CORE_CAUSES } from "../../src/contracts/attribution-record.ts";
import { PAYLOAD_PATH } from "../fixtures/metrics/synthetic-payload.ts";

const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8")) as MetricsResponse;
const production = rowsInLens(payload.roleRows, DEFAULT_METRICS_ROUTE);
const context = { rateCard: RATE_CARD.rows, priorLabels: payload.priors.modelLabels, roleColors: { builder: "#112233" } };
const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const runOf = (id: string) => payload.runs.find((run) => run.sessionId === id)!;

// ---------------------------------------------------------------------------
// The Ledger.
// ---------------------------------------------------------------------------

test("every group is the module's stats over its rows, keyed as the lens keys it", () => {
  for (const group of LEDGER_GROUPS) {
    const groups = groupRows(production, group, listPrice, context);
    assert.equal(groups.reduce((sum, row) => sum + row.stats.n, 0), production.length, `${group} partitions the rows`);
    for (const row of groups) {
      const members = production.filter((candidate) => toToken(groupValue(candidate, group)) === row.key);
      assert.deepEqual(row.stats, stats(members, listPrice), `${group} ${row.key}`);
    }
  }
  const routes = groupRows(production, "route", listPrice, context);
  assert.deepEqual(routes.map((row) => row.key).sort(), ["claude/opus@high", "codex/gpt-6-sol@xhigh"]);
  const codex = routes.find((row) => row.key === "codex/gpt-6-sol@xhigh")!;
  assert.equal(codex.title, "GPT-6 Sol · xhigh", "named as the Matrix names it (T08 C10)");
  assert.equal(codex.provider, "openai");
  assert.equal(codex.run, null, "only a run row opens the Run view");

  const runs = groupRows(production, "run", listPrice, context);
  const f1 = runs.find((row) => row.key === "f1")!;
  assert.equal(f1.title, "task-f1");
  assert.equal(f1.detail, "f1 · attempt 1");
  assert.equal(f1.run, "f1");

  const roles = groupRows(production, "role", listPrice, context);
  assert.equal(roles.find((row) => row.key === "builder")!.dot, "#112233", "the config's role colour");
  assert.equal(roles.find((row) => row.key === "reviewer")!.dot, "var(--faint)");
});

test("a row with no single route groups as its own labelled row rather than vanishing", () => {
  const mixed = { ...production[0]!, route: { ...production[0]!.route, effort: null } } as MetricsRoleRow;
  const groups = groupRows([...production, mixed], "route", listPrice, context);
  const none = groups.find((row) => row.key === "~")!;
  assert.equal(none.title, "no single route");
  assert.equal(none.stats.n, 1);
});

test("sorting uses the column's value, puts a missing value last either way, and ties fall to the natural order", () => {
  const rows = groupRows(production, "route", listPrice, context);
  const columns = visibleColumns(DEFAULT_FAMILIES);
  const byRows = sortRows(rows, { column: COUNT_COLUMN, dir: "desc" }, columns, "route");
  const ns = byRows.map((row) => row.stats.n);
  assert.deepEqual(ns, ns.toSorted((a, b) => b - a));
  const asc = sortRows(rows, { column: COUNT_COLUMN, dir: "asc" }, columns, "route").map((row) => row.stats.n);
  assert.deepEqual(asc, asc.toSorted((a, b) => a - b));

  const make = (key: string, fp: number | null, n: number) => ({ ...rows[0]!, key, title: key, stats: { ...rows[0]!.stats, n, firstPass: { p: fp, lo: 0, hi: 1 } } });
  const three = [make("b", null, 1), make("a", 0.5, 2), make("c", 0.9, 3)];
  const fp = LEDGER_COLUMNS.filter((column) => column.id === "fp");
  assert.deepEqual(sortRows(three, { column: "fp", dir: "desc" }, fp, "route").map((row) => row.key), ["c", "a", "b"]);
  assert.deepEqual(sortRows(three, { column: "fp", dir: "asc" }, fp, "route").map((row) => row.key), ["a", "c", "b"], "null stays last");

  assert.deepEqual(effectiveSort({ column: "input", dir: "asc" }, visibleColumns(DEFAULT_FAMILIES)), { column: COUNT_COLUMN, dir: "asc" },
    "a column the Ledger hides falls back to the count column");
  assert.deepEqual(effectiveSort({ column: "input", dir: "asc" }, visibleColumns(["tokens"])), { column: "input", dir: "asc" });

  const roles = groupRows([...production].reverse(), "role", listPrice, context);
  const tied = sortRows(roles.map((row) => ({ ...row, stats: { ...row.stats, n: 1 } })), { column: COUNT_COLUMN, dir: "desc" }, [], "role");
  assert.deepEqual(tied.map((row) => row.key), ["builder", "reviewer"], "ties follow the design's role order");
});

test("a column the same in every group is flat; one group compares nothing", () => {
  const rows = groupRows(production, "route", listPrice, context);
  const columns = visibleColumns(["outcome", "provenance"]);
  const flat = flatColumns(rows, columns);
  for (const column of columns) {
    const values = rows.map((row) => column.value(row.stats));
    assert.equal(flat.has(column.id), values.every((value) => value === values[0]), column.id);
  }
  assert.ok(flat.has("state-CANCELLED"), "no cancelled runs anywhere is no signal");
  assert.deepEqual([...flatColumns(rows.slice(0, 1), columns)], []);
  assert.equal(FLAT_TITLE, "flat across every group: no signal in this lens");
});

test("the Ledger's headers: the group's count column first, aria-sort on the active one, family spans cover the columns", () => {
  const ledger = buildLedger(production, { group: "route", families: DEFAULT_FAMILIES, sort: { column: "fp", dir: "asc" } }, listPrice, context);
  assert.deepEqual(DEFAULT_FAMILIES, ["outcome", "verification", "work", "cost"]);
  assert.equal(ledger.headers[0]!.id, COUNT_COLUMN);
  assert.equal(ledger.headers[0]!.label, "Route · rows");
  assert.deepEqual(ledger.headers.filter((header) => header.ariaSort !== undefined).map((header) => [header.id, header.ariaSort]), [["fp", "ascending"]]);
  assert.deepEqual(ledger.families.map((head) => head.family), ["outcome", "verification", "work", "cost"]);
  assert.equal(ledger.families.reduce((sum, head) => sum + head.span, 0), ledger.columns.length);
  assert.equal(ledger.headers.length, ledger.columns.length + 1);
  for (const header of ledger.headers.slice(1)) assert.equal(header.flat, ledger.flat.has(header.id), header.id);

  const outcome = LEDGER_COLUMNS.filter((column) => column.family === "outcome").map((column) => column.id);
  for (const group of STATE_GROUPS) assert.ok(outcome.includes(`state-${group}`), `one column per terminal state: ${group}`);
  assert.ok(outcome.includes("strip"));
  assert.deepEqual([...new Set(LEDGER_COLUMNS.map((column) => column.family))], ["outcome", "verification", "work", "tokens", "cost", "provenance"]);
  assert.equal(new Set(LEDGER_COLUMNS.map((column) => column.id)).size, LEDGER_COLUMNS.length, "column ids are unique");
});

test("the strip is one segment per state with runs, in state order, in the state tokens", () => {
  const s = stats(production, listPrice);
  const strip = terminalStrip(s);
  assert.deepEqual(strip.map((segment) => segment.state), STATE_GROUPS.filter((group) => s.states[group] > 0));
  assert.deepEqual(strip.map((segment) => segment.tone), strip.map((segment) =>
    ({ LANDED: "var(--green)", AWAITING_OWNER: "var(--amber)", OPEN: "var(--blue)", CANCELLED: "var(--faint)", BLOCKED: "var(--red)" })[segment.state]));
  assert.equal(strip.reduce((sum, segment) => sum + segment.runs, 0), s.runs);
});

test("every cost cell is a formatListEquivalent figure and no header carries a dollar sign", () => {
  const rows = groupRows(production, "route", listPrice, context);
  for (const column of LEDGER_COLUMNS.filter((candidate) => candidate.family === "cost")) {
    assert.equal(column.label.includes("$"), false, column.label);
    for (const row of rows) {
      const value = column.value(row.stats);
      assert.equal(column.cell(row.stats).text, formatListEquivalent(value), `${column.id} ${row.key}`);
    }
  }
  for (const column of LEDGER_COLUMNS) assert.equal(column.label.includes("$"), false, column.label);
});

test("column families and the sort live in the hash and flip as the pills and headers do", () => {
  const off = withFamily(DEFAULT_METRICS_ROUTE, "work");
  assert.deepEqual(off.families, ["outcome", "verification", "cost"]);
  const on = withFamily(off, "tokens");
  assert.deepEqual(on.families, ["outcome", "verification", "tokens", "cost"], "kept in the pills' order");
  assert.equal(metricsRouteHash({ ...on, view: "ledger" }), "#/metrics?view=ledger&cols=outcome,verification,tokens,cost");
  assert.deepEqual(withFamily(withFamily(DEFAULT_METRICS_ROUTE, "tokens"), "tokens").families, DEFAULT_FAMILIES);

  const first = withSort(DEFAULT_METRICS_ROUTE, "fp");
  assert.deepEqual(first.sort, { column: "fp", dir: "desc" }, "a new column starts largest first");
  assert.deepEqual(withSort(first, "fp").sort, { column: "fp", dir: "asc" });
  assert.deepEqual(withSort(withSort(first, "fp"), "fp").sort, { column: "fp", dir: "desc" });
  assert.equal(metricsRouteHash(withSort(DEFAULT_METRICS_ROUTE, COUNT_COLUMN)), "#/metrics?dir=asc");

  assert.deepEqual(parseMetricsRoute("#/metrics?cols=cost,pie,outcome").families, ["outcome", "cost"], "unknown families drop, order is the pills'");
  assert.deepEqual(parseMetricsRoute("#/metrics?cols=").families, []);
  assert.equal(metricsRouteHash(parseMetricsRoute("#/metrics?cols=")), "#/metrics?cols=");
  assert.deepEqual(parseMetricsRoute("#/metrics?dir=sideways").sort, { column: COUNT_COLUMN, dir: "desc" });
});

test("grouped by run, a row opens the Run view with the lens kept", () => {
  const lensed = withSelection({ ...DEFAULT_METRICS_ROUTE, view: "ledger", group: "run" }, "role", ["builder", "reviewer"], ["builder"]);
  const opened = withRun(lensed, "f1");
  assert.equal(opened.view, "run");
  assert.equal(metricsRouteHash(opened), "#/metrics/run/f1?x.role=reviewer&group=run");
});

// ---------------------------------------------------------------------------
// The Run view.
// ---------------------------------------------------------------------------

test("the picker lists the lens's runs newest first and keeps a shown run the lens leaves out", () => {
  const all = runPicker(payload, DEFAULT_METRICS_ROUTE);
  assert.equal(all.selected, all.runs[0] ?? null, "no run named: the newest in the lens");
  assert.equal(all.missing, null);
  assert.ok(all.runs.every((run) => run.workflow !== "prove"), "the lens applies: production only");

  const proving = runPicker(payload, withRun(DEFAULT_METRICS_ROUTE, "f5"));
  assert.equal(proving.selected?.sessionId, "f5");
  assert.equal(proving.runs[0]?.sessionId, "f5", "shown first when the lens leaves it out");

  const gone = runPicker(payload, withRun(DEFAULT_METRICS_ROUTE, "nope"));
  assert.equal(gone.selected, null);
  assert.equal(gone.missing, "nope");
});

test("the fact grid reads the run in the design's order", () => {
  const run = runOf("f1");
  const rows = payload.roleRows.filter((row) => row.sessionId === "f1");
  const facts = runFacts(run, rows, listPrice);
  assert.deepEqual(facts.map((fact) => fact.label),
    ["Task", "Project", "Workflow · tier", "Terminal state", "Review verdict", "Wall time", "Owner rework", "List equivalent"]);
  const value = (label: string) => facts.find((fact) => fact.label === label)!.value;
  assert.equal(value("Task"), "task-f1 · attempt 1");
  assert.equal(value("Workflow · tier"), `shift · T${run.tier}`);
  assert.equal(value("Terminal state"), "LANDED");
  assert.equal(facts.find((fact) => fact.label === "Terminal state")!.chip, true);
  assert.equal(value("Review verdict"), run.reviewVerdict ?? "none");
  assert.equal(value("List equivalent"), formatListEquivalent(runListTotal(rows, listPrice)));
  assert.equal(value("Owner rework"), `${rows[0]!.reworkPhases} phases · ${run.ownerReentries} re-entries`);
  assert.equal(runListTotal([], listPrice), null);
});

function phase(ordinal: number, kind: MetricsRunPhase["kind"], status: MetricsRunPhase["status"], minutes: number | null): MetricsRunPhase {
  return {
    phaseId: `p${ordinal}`, key: `k${ordinal}`, ordinal, kind, owner: kind === "agent" ? "builder" : "host", status,
    correctionCount: 0, maxCorrections: 1, errorCode: status === "FAILED" ? "GateFailed" : null,
    startedAt: null, endedAt: null, minutes, agent: null,
  };
}

test("the phase strip: width by minutes with a floor, host blips left off, colour by status", () => {
  const strip = phaseStrip([
    phase(3, "agent", "FAILED", 0.1),
    phase(1, "agent", "SUCCEEDED", 20),
    phase(2, "code", "SUCCEEDED", 0.01),
    phase(4, "code", "SKIPPED", 2),
    phase(5, "agent", "QUEUED", null),
  ]);
  assert.deepEqual(strip.segments.map((segment) => segment.phaseId), ["p1", "p3", "p4", "p5"], "ordinal order; the 0.01-minute host phase is dropped");
  assert.deepEqual(strip.segments.map((segment) => segment.weight), [20, MIN_PHASE_WIDTH, 2, MIN_PHASE_WIDTH]);
  assert.deepEqual(strip.segments.map((segment) => segment.tone), ["succeeded", "failed", "cancelled", "running"]);
  assert.equal(strip.minutes, 22.1, "the floor widens a segment, never the total");
  assert.ok(Math.abs(strip.segments.reduce((sum, segment) => sum + segment.share, 0) - 1) < 1e-9);
  assert.match(strip.segments[1]!.title, /k3 · builder · failed · 0\.1 min · GateFailed/);
  assert.deepEqual(phaseStrip([]).segments, []);
});

test("the per-role table: design role order, tool counts, first-pass marks and list by token kind", () => {
  const rows = payload.roleRows.filter((row) => row.sessionId === "f1");
  const lines = roleLines([...rows].reverse(), listPrice, { ...context, allRows: payload.roleRows });
  assert.deepEqual(lines.map((line) => line.role), ["builder", "reviewer"]);
  const builder = lines[0]!;
  const row = rows.find((candidate) => candidate.role === "builder")!;
  assert.equal(builder.route, "GPT-6 Sol · xhigh");
  assert.equal(builder.provider, "openai");
  assert.equal(builder.provenance, "stream-authoritative");
  assert.equal(builder.toolMix, `R${row.tools.read} S${row.tools.search} E${row.tools.edit} X${row.tools.exec} O${row.tools.other}`);
  assert.equal(builder.gates, `${row.gates.pass}/${row.gates.total}`);
  assert.equal(builder.list, formatListEquivalent(listPrice(row)));
  const kinds = listByKind(row)!;
  assert.deepEqual(kinds.map((kind) => kind.kind), ["input", "cache read", "cache write", "output"]);
  assert.ok(Math.abs(kinds.reduce((sum, kind) => sum + kind.usd, 0) - listPrice(row)!) < 1e-9, "the kinds add up to the row's list equivalent");
  assert.ok(Math.abs(kinds.reduce((sum, kind) => sum + kind.share, 0) - 1) < 1e-9);
  const additive = { ...row, tokens: { ...row.tokens, reasoningRelation: "additive" as const, reasoningTokens: 1_000_000 } };
  assert.ok(Math.abs(listByKind(additive)!.reduce((sum, kind) => sum + kind.usd, 0) - listPrice(additive)!) < 1e-9, "additive reasoning joins output");
  assert.equal(listByKind({ ...row, resolvedModel: "not-a-card-id" }), null, "an unpriced row has no bars");

  assert.equal(firstPassMark({ settled: false, firstPass: false, blockedHere: false }), "open");
  assert.equal(firstPassMark({ settled: true, firstPass: true, blockedHere: false }), "yes");
  assert.equal(firstPassMark({ settled: true, firstPass: false, blockedHere: true }), "blocked here");
  assert.equal(firstPassMark({ settled: true, firstPass: false, blockedHere: false }), "no");
});

test("the attribution panel shows only for a BLOCKED run, with the heuristic and the owner's record in force", () => {
  assert.equal(attributionPanel(runOf("f1")), null, "a landed run has no block to attribute");
  const blocked = attributionPanel(runOf("f3"))!;
  assert.deepEqual(blocked.blocked, { owner: "builder", phase: runOf("f3").phases[0]!.key, errorCode: "PermissionBreach" });
  assert.equal(blocked.heuristic, "model");
  assert.equal(blocked.override, null);
  assert.equal(blockedLabel(blocked.blocked), "builder");
  assert.equal(blockedLabel(blockedAt(runOf("f4"))), "context (host)");
  assert.equal(blockedLabel({ owner: "host", phase: "t01-tests", errorCode: "CommandPhaseFailure" }), "t01-tests (host)");
  assert.equal(blockedLabel({ owner: "documenter", phase: "documenter", errorCode: null }), "documenter");
  assert.equal(blockedLabel({ owner: null, phase: null, errorCode: null }), "no failed phase");
  assert.equal(blockedAt(runOf("f4")).owner, runOf("f4").phases.find((candidate) => candidate.status === "FAILED")!.owner, "a host phase can block");

  const overridden: MetricsRun = {
    ...runOf("f3"),
    ownerAttribution: { cause: "factory", reason: "the ticket's own wording", at: "2026-09-28T14:00:00.000Z" },
    attribution: "factory",
    attributionSource: "owner",
  };
  const panel = attributionPanel(overridden)!;
  assert.deepEqual(panel.override, { cause: "factory", reason: "the ticket's own wording", at: "2026-09-28T14:00:00.000Z", date: "2026-09-28" });
  assert.equal(panel.inForce, "factory");
  assert.equal(panel.source, "owner");
  assert.equal(panel.heuristic, "model", "the heuristic stays beside the override");
});

test("the composed command is the CLI's exact form, quoted so a shell passes the reason through untouched", () => {
  assert.deepEqual([...ATTRIBUTION_CAUSES], [...CORE_CAUSES], "the pills are the contract's causes");
  const run = runOf("f3");
  assert.equal(attributeCommand(run, "factory", "the ticket's own wording"),
    `awsf attribute task-f3 --project ${run.project} --attempt 1 --cause factory --reason "the ticket's own wording"`);
  assert.equal(attributeCommand(run, null, "  "), `awsf attribute task-f3 --project ${run.project} --attempt 1 --cause <cause> --reason "<why>"`);
  assert.equal(quoteReason("said \"done\" at $HOME"), `'said "done" at $HOME'`);
  assert.equal(quoteReason("it's `rm` and \\n!"), `'it'\\''s \`rm\` and \\n!'`);
  assert.equal(quoteReason("two\nlines\t here "), `"two lines here"`);
  assert.equal(commandReady(null, "why"), false);
  assert.equal(commandReady("model", " "), false, "the CLI refuses an empty reason, so the copy waits for one");
  assert.equal(commandReady("model", "why"), true);
  assert.equal(ATTRIBUTION_NOTE, "Run this in a terminal. The dashboard records nothing itself.");
});

// ---------------------------------------------------------------------------
// Static: the tab reads, and the command is only text.
// ---------------------------------------------------------------------------

// The view files are also in `VIEW_FILES` in dashboard-metrics-views.test.ts,
// which scans them for fetches, stored state, literal colours and imports.

test("the Ledger and Run views send nothing: no request channel, the route's one GET, the command only text", () => {
  for (const path of ["dashboard/src/metrics-ledger.ts", "dashboard/src/metrics-run.ts", "dashboard/src/components/MetricsLedger.vue", "dashboard/src/components/MetricsRun.vue"]) {
    assert.equal(/\b(?:XMLHttpRequest|sendBeacon|WebSocket|EventSource|indexedDB)\b/.test(source(path)), false, `${path} opens a channel`);
  }
  const route = source("dashboard/src/routes/metrics.vue");
  assert.deepEqual(route.match(/\bfetch\s*\(([^)]*)\)/g), ['fetch("/api/v1/metrics")'], "the tab's one read");
  assert.equal(/method\s*:|localStorage|sessionStorage/.test(route), false);

  const run = source("dashboard/src/components/MetricsRun.vue");
  assert.match(run, /navigator\.clipboard\.writeText\(command\.value\)/);
  assert.match(run, /\.select\(\)/, "the select-all fallback");
  assert.match(run, /<textarea[\s\S]*?readonly[\s\S]*?>/, "the command is a read-only field");
  assert.match(run, /class="archive-control"\s+disabled/, "the mini card's archive control cannot write from here");
});
