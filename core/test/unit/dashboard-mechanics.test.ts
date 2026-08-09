import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

test("the phase drawer traps keyboard focus, closes on Escape, and restores its opener", () => {
  const drawer = source("dashboard/src/components/PhaseDetailDrawer.vue");
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(drawer, /event\.shiftKey.*last\.focus\(\)/s);
  assert.match(drawer, /document\.activeElement instanceof HTMLElement/);
  assert.match(drawer, /opener\?\.focus\(\)/);
  assert.match(drawer, /closeButton\.value\?\.focus\(\)/);
});

test("phase inspection retains every envelope round and labels evidence and authority in text", () => {
  const inspector = source("dashboard/src/components/PhaseInspector.vue");
  assert.match(inspector, /detail\.compiledPrompts/);
  assert.match(inspector, /prompt\.lineCount/);
  assert.match(inspector, /detail\.effectiveConfig/);
  assert.match(inspector, /checks:/);
  assert.match(inspector, /violations:/);
  assert.match(inspector, /v-for="envelope in detail\.envelopes"/);
  assert.match(inspector, /INVALID — retained/);
  assert.match(inspector, /costAuthorityLabel/);
  assert.match(inspector, /total is partial/);
});

test("event paging and settings expose the required read-only, text-labelled surfaces", () => {
  const events = source("dashboard/src/components/EventLog.vue");
  const settings = source("dashboard/src/components/SettingsRoute.vue");
  assert.match(events, /events\?after=\$\{cursor\.value\}/);
  assert.match(events, /cursor\.value = page\.cursor/);
  assert.match(events, /hasMore\.value = page\.hasMore/);
  assert.match(events, /event\.startedAt/);
  assert.match(events, /event\.type/);
  assert.match(events, /formatDuration/);
  for (const label of ["Effective config", "Adapter health", "Database health"]) {
    assert.match(settings, new RegExp(label));
  }
});

test("the complete animation inventory has a reduced-motion override and visible focus", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(css, /:root\{--bg:#0F1017/ , "the pre-T26 design system must remain present");
  for (const animation of ["drawer-up", "running-halo", "gate-arrive", "landed-pulse", "event-arrive"]) {
    assert.match(css, new RegExp(`@keyframes ${animation}`));
  }
  assert.match(css, /\.session-card\{[^}]*transition:/);
  assert.match(css, /\.phase-block\{[^}]*transition:width 500ms linear/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{/);
  assert.match(css, /transition-duration:0\.01ms!important/);
  assert.match(css, /\.state-chip\.running\{animation:none!important;box-shadow:/);
  assert.match(css, /button:focus-visible,a:focus-visible,\[tabindex\]:focus-visible/);
  assert.match(css, /\.event-tool_call strong\{color:var\(--agent-builder\)\}/);
  assert.match(css, /\.event-agent_start strong\{color:var\(--agent-documenter\)\}/);
});
