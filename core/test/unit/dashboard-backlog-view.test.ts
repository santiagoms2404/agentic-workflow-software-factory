import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PlanTicketReader } from "../../src/persistence/plan-tickets.ts";
import { loadCatalog } from "../../src/registry/catalog.ts";
import { resolvePlanSources } from "../../src/registry/plan-source.ts";
import {
  BUILD_PROMPT_HEADING,
  buildPromptBlock,
  ticketSourceView,
} from "../../../dashboard/src/backlog-view.ts";
import { togglePlan } from "../../../dashboard/src/backlog-selection.ts";
import { repoRoot } from "./meta/_walk.ts";

function source(path: string): string {
  return readFileSync(join(repoRoot(), path), "utf8");
}

test("ticket source display is byte-faithful and its overlay closes by control or backdrop", async () => {
  const catalogPath = join(repoRoot(), "awsf.project.yaml");
  const planSources = resolvePlanSources(catalogPath, loadCatalog(await readFile(catalogPath, "utf8")));
  const ticketReader = new PlanTicketReader(planSources);
  const deliveredSource = await ticketReader.source("awsf-v2-w08-publish", "T01");
  assert.ok(deliveredSource !== null);
  const overlayText = ticketSourceView(deliveredSource).source;
  const onDisk = await readFile(join(repoRoot(), "specs/tickets/awsf-v2-w08-publish/T01.md"), "utf8");
  assert.equal(overlayText, onDisk);

  const byteSensitiveSource = `${onDisk.replaceAll("\n", "\r\n")}\r\n`;
  const byteSensitiveOverlayText = ticketSourceView(byteSensitiveSource).source;
  assert.equal(byteSensitiveOverlayText, byteSensitiveSource);
  assert.notEqual(byteSensitiveOverlayText.trim(), byteSensitiveSource);
  assert.notEqual(byteSensitiveOverlayText.replaceAll("\r\n", "\n"), byteSensitiveSource);

  const overlay = source("dashboard/src/components/TicketSourceOverlay.vue");
  const card = source("dashboard/src/components/TicketCard.vue");
  assert.match(overlay, /role="dialog"/u);
  assert.match(overlay, /aria-modal="true"/u);
  assert.match(overlay, /@click\.self="emit\('close'\)"/u);
  assert.match(overlay, /aria-label="Close ticket source"[^>]*@click="emit\('close'\)"/u);
  assert.match(overlay, /const sourceText = computed\(\(\) => view\.value\?\.source\)/u);
  assert.match(overlay, /class="ticket-source">\{\{ sourceText \}\}<\/pre>/u);
  assert.doesNotMatch(card, /ticket-expansion|ticket-source/u);
});

test("copying resolves the build prompt from its heading even without a provider line", () => {
  const ticket = source("specs/tickets/awsf-v2-w08-publish/T01.md");
  const location = buildPromptBlock(ticket);
  const headingOffset = ticket.indexOf(BUILD_PROMPT_HEADING);
  assert.ok(location);
  assert.equal(headingOffset >= 0, true);
  assert.equal(location.headingOffset, headingOffset);
  assert.equal(location.text, ticket.slice(headingOffset + `${BUILD_PROMPT_HEADING}\n\n`.length));

  const overlay = source("dashboard/src/components/TicketSourceOverlay.vue");
  assert.match(overlay, /ticketSourceView\(props\.source\)/u);
  assert.match(overlay, /navigator\.clipboard\.writeText\(prompt\.value\.text\)/u);
  assert.doesNotMatch(overlay, /CHOOSE YOUR PROVIDER/u);
});

test("plan controls use accessible dashboard toggle buttons", () => {
  const picker = source("dashboard/src/components/PlanCardRow.vue");
  const css = source("dashboard/src/styles/dashboard.css");
  assert.doesNotMatch(picker, /type="(?:checkbox|radio)"|<fieldset|<legend/u);
  assert.match(picker, /class="plan-control-button select-all-control"[^>]*:aria-pressed=/u);
  assert.match(picker, /role="radiogroup"[^>]*aria-label="Plan type"/u);
  assert.match(picker, /role="radio"[\s\S]*:aria-checked=/u);
  assert.match(picker, /@keydown="moveFilter\(\$event, option\.value\)"/u);
  assert.match(css, /\.plan-control-button\s*\{[^}]*background:\s*var\(--surface\)/su);
  assert.match(css, /\.plan-control-button:hover\s*\{[^}]*border-color:\s*var\(--faint\)/su);
  const selected = css.match(/\.plan-control-button\.selected\s*\{[^}]*\}/su)?.[0] ?? "";
  assert.match(selected, /border-color:\s*color-mix\([^}]*var\(--faint\)[^}]*var\(--text\)/su);
  assert.doesNotMatch(selected, /background\s*:|--accent/su);
});

test("backlog selection seeds once from the first non-empty response", () => {
  const route = source("dashboard/src/routes/backlog.vue");
  assert.match(route, /let hasSeededSelection = false;/u);
  // The rule itself moved into `initialPlanSelection` when the sessions view
  // gained plan cards that navigate here carrying a plan; the route keeps the
  // seed-once guard and delegates the choice. `dashboard-session-plans.test.ts`
  // holds the behaviour, and this keeps the guard from being lost with it.
  assert.match(
    route,
    /if \(hasSeededSelection \|\| plans\.length === 0\) return;[^]*selectedPlans\.value = initialPlanSelection\(plans, requested\);[^]*hasSeededSelection = true;/u,
  );
  assert.equal(route.match(/selectedPlans\.value = initialPlanSelection/gu)?.length, 1);
});

test("backlog metrics render ready, blocked, done, and projected cost in four columns", () => {
  const metrics = source("dashboard/src/components/BacklogMetricsRow.vue");
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(metrics, /<dt>ready<\/dt>[^]*<dt>blocked<\/dt>[^]*<dt>done<\/dt>[^]*<dt>projected cost<\/dt>/u);
  assert.match(metrics, /ticket\.state === "done"/u);
  assert.match(css, /\.backlog-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/su);
});

test("plan headings toggle persistent per-plan collapsed bars without changing selection", () => {
  const route = source("dashboard/src/routes/backlog.vue");
  const board = source("dashboard/src/components/BacklogBoard.vue");
  const css = source("dashboard/src/styles/dashboard.css");

  assert.match(route, /const collapsedPlans = ref<readonly string\[\]>\(\[\]\);/u);
  assert.match(route, /collapsedPlans\.value = togglePlan\(collapsedPlans\.value, planId\);/u);
  assert.equal(route.match(/collapsedPlans\.value\s*=/gu)?.length, 1);
  assert.match(route, /:collapsed="collapsedPlans"/u);
  assert.match(route, /@toggle-plan="toggleCollapsedPlan"/u);

  assert.match(board, /<button[^>]*class="backlog-plan-toggle"[^>]*:aria-expanded="!isPlanCollapsed\(group\.plan\.id\)"[^>]*@click="emit\('toggle-plan', group\.plan\.id\)"/su);
  assert.match(board, /<span v-else class="collapsed-plan-counts"[^>]*>[^]*v-for="state in states"[^]*group\.plan\.counts\[state\]/u);
  assert.match(board, /const states:[^=]*= \["todo", "wip", "done", "failed"\];/u);
  assert.match(board, /<div v-if="!isPlanCollapsed\(group\.plan\.id\)" class="backlog-board">/u);
  assert.doesNotMatch(board, /update:selected/u);
  assert.match(css, /\.backlog-plan-group\.collapsed \.backlog-plan-heading\s*\{[^}]*min-height:\s*38px[^}]*\}/su);
});

test("backlog columns default collapsed and toggle with plan-qualified keys", () => {
  const route = source("dashboard/src/routes/backlog.vue");
  const board = source("dashboard/src/components/BacklogBoard.vue");
  const css = source("dashboard/src/styles/dashboard.css");

  assert.match(route, /const expandedColumns = ref<readonly string\[\]>\(\[\]\);/u);
  assert.match(route, /expandedColumns\.value = togglePlan\(expandedColumns\.value, columnId\);/u);
  assert.equal(route.match(/expandedColumns\.value\s*=/gu)?.length, 1);
  assert.match(route, /:expanded-columns="expandedColumns"/u);
  assert.match(route, /@toggle-column="toggleExpandedColumn"/u);
  const selectionWatch = route.slice(route.indexOf("watch("), route.indexOf("const groups"));
  assert.doesNotMatch(selectionWatch, /expandedColumns/u);

  assert.match(board, /expandedColumns: readonly string\[\];/u);
  assert.match(board, /return `\$\{planId\}:\$\{state\}`;/u);
  assert.match(board, /:key="columnId\(group\.plan\.id, state\)"/u);
  assert.match(board, /:class="\{ collapsed: !isColumnExpanded\(group\.plan\.id, state\) \}"/u);
  assert.match(board, /<button[^>]*class="backlog-column-toggle"[^>]*:aria-expanded="isColumnExpanded\(group\.plan\.id, state\)"[^>]*@click="emit\('toggle-column', columnId\(group\.plan\.id, state\)\)"/su);
  assert.match(board, /<template v-if="isColumnExpanded\(group\.plan\.id, state\)">[^]*<TicketCard/u);

  const oneExpanded = togglePlan([], "plan-a:todo");
  assert.deepEqual(oneExpanded, ["plan-a:todo"]);
  assert.equal(oneExpanded.includes("plan-b:todo"), false);
  assert.deepEqual(togglePlan(oneExpanded, "plan-a:todo"), []);

  assert.match(css, /\.backlog-board\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(220px, 1fr\)\)[^}]*align-items:\s*start/su);
  assert.match(css, /\.backlog-column\.collapsed\s*\{[^}]*min-height:\s*0[^}]*\}/su);
  assert.match(css, /\.backlog-column\.collapsed h3\s*\{[^}]*margin-bottom:\s*0[^}]*\}/su);
});

/** Every selector whose rule makes the element scroll in some axis. */
function scrollingSelectors(source: string): readonly string[] {
  // Comments first: this stylesheet explains itself, and a paragraph sitting
  // above a rule otherwise parses as part of its selector.
  const css = source.replace(/\/\*[\s\S]*?\*\//gu, "");
  const found: string[] = [];
  for (const rule of css.matchAll(/(?:^|\n)([^{}@\n][^{}]*?)\{([^}]*)\}/gu)) {
    const selector = (rule[1] ?? "").trim();
    if (selector.includes("::-webkit-scrollbar")) continue;
    if (!/overflow(?:-x|-y)?:\s*(?:auto|scroll)/u.test(rule[2] ?? "")) continue;
    for (const part of selector.split(",")) found.push(part.trim());
  }
  return [...new Set(found)];
}

test("every scrolling surface takes the one shared scrollbar treatment", () => {
  // One selector list, stated once in the shell. Three ad-hoc sets had already
  // drifted — two heights, two track colours, one surface styling only Firefox
  // — and a scrollbar nobody styled falls back to the browser's grey, which
  // belongs to no palette.
  const shell = source("dashboard/src/styles/morphism.css");
  const base = source("dashboard/src/styles/dashboard.css");
  // Index arithmetic, not a regex: a pattern that scans backwards over a
  // selector list this long backtracks catastrophically, and this file is read
  // on every unit run.
  const anchor = shell.indexOf("::-webkit-scrollbar { width: 10px");
  assert.ok(anchor > 0, "the shared treatment must be findable");
  const block = shell.slice(shell.lastIndexOf("}", anchor) + 1, anchor).replace(/\/\*[\s\S]*?\*\//gu, "");
  const covered = new Set(
    block.split(",").map((part) => part.replace(/::-webkit-scrollbar.*$/u, "").trim()).filter((part) => part.length > 0),
  );
  const uncovered = [...scrollingSelectors(base), ...scrollingSelectors(shell)]
    .filter((selector) => !covered.has(selector))
    .sort();
  assert.deepEqual(uncovered, [], "a scrolling surface outside the treatment renders a browser-grey scrollbar");

  // Track and thumb are tokens, so all seven palettes and both modes inherit
  // them; a hardcoded colour here works in exactly one.
  assert.match(shell, /background:\s*var\(--neu-scroll-track\)/u);
  assert.match(shell, /background-color:\s*var\(--neu-scroll-thumb\)/u);
  assert.match(shell, /background-color:\s*var\(--neu-scroll-thumb-hover\)/u);
  assert.match(shell, /scrollbar-color:\s*var\(--neu-scroll-thumb\) var\(--neu-scroll-track\)/u);
  assert.match(base, /--neu-scroll-thumb:\s*color-mix\(/u);
  // A light palette's text is dark, so it needs its own mix or the thumb reads
  // as a bar of ink.
  assert.match(base, /:root\[data-mode="light"\]\s*\{[^}]*--neu-scroll-thumb:/su);
  // The page's own scrollbar is a surface like any other.
  assert.ok(covered.has("html"), "the document scrollbar is styled too");
});
