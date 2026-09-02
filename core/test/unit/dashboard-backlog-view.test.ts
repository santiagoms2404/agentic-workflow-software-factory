import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUILD_PROMPT_HEADING,
  buildPromptBlock,
  ticketSourceView,
} from "../../../dashboard/src/backlog-view.ts";
import { repoRoot } from "./meta/_walk.ts";

function source(path: string): string {
  return readFileSync(join(repoRoot(), path), "utf8");
}

test("ticket source display is byte-faithful and its overlay closes by control or backdrop", () => {
  const ticket = source("specs/tickets/awsf-v2-w08-publish/T01.md");
  const overlay = source("dashboard/src/components/TicketSourceOverlay.vue");
  const card = source("dashboard/src/components/TicketCard.vue");
  assert.equal(ticketSourceView(ticket).source, readFileSync(join(repoRoot(), "specs/tickets/awsf-v2-w08-publish/T01.md"), "utf8"));
  assert.match(overlay, /role="dialog"/u);
  assert.match(overlay, /aria-modal="true"/u);
  assert.match(overlay, /@click\.self="emit\('close'\)"/u);
  assert.match(overlay, /aria-label="Close ticket source"[^>]*@click="emit\('close'\)"/u);
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

test("plan-card Chrome scrollbar rules use dashboard palette variables", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(css, /\.plan-card-row::-webkit-scrollbar\s*\{[^}]*height:/su);
  assert.match(css, /\.plan-card-row::-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--panel-3\)/su);
  assert.match(css, /\.plan-card-row::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--faint\)/su);
});
