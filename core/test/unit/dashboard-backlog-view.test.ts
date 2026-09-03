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
  assert.match(picker, /class="plan-control-button select-all-control"[\s\S]*:aria-pressed=/u);
  assert.match(picker, /role="radiogroup"[^>]*aria-label="Plan type"/u);
  assert.match(picker, /role="radio"[\s\S]*:aria-checked=/u);
  assert.match(picker, /@keydown="moveFilter\(\$event, option\.value\)"/u);
  assert.match(css, /\.plan-control-button\s*\{[^}]*background:\s*var\(--surface\)/su);
  assert.match(css, /\.plan-control-button:hover\s*\{[^}]*border-color:\s*var\(--faint\)/su);
  assert.match(css, /\.plan-control-button\.selected\s*\{[^}]*background:\s*color-mix\([^}]*var\(--accent\)[^}]*var\(--panel-3\)/su);
});

test("plan-card and waterfall Chrome scrollbars share one effective dashboard style", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  const planRowRule = /(?:^|\n)\.plan-card-row\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
  assert.doesNotMatch(planRowRule, /scrollbar-color/u);
  assert.match(css, /\.waterfall-scroll::-webkit-scrollbar,\s*\.plan-card-row::-webkit-scrollbar\s*\{[^}]*height:\s*11px/su);
  assert.match(css, /\.waterfall-scroll::-webkit-scrollbar-track,\s*\.plan-card-row::-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--panel-3\)/su);
  assert.match(css, /\.waterfall-scroll::-webkit-scrollbar-thumb,\s*\.plan-card-row::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--faint\)/su);
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\)\s*\{[^}]*scrollbar-color:\s*var\(--faint\) var\(--panel-3\)/su);
});
