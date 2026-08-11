import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

test("phase inspection is routed inline, closes on Escape, and restores its opener", () => {
  const detail = source("dashboard/src/components/PhaseDetailDrawer.vue");
  const route = source("dashboard/src/components/SessionRoute.vue");
  assert.match(detail, /inline-phase-detail/);
  assert.doesNotMatch(detail, /role="dialog"|aria-modal|drawer-backdrop/);
  assert.match(detail, /event\.key === "Escape"/);
  assert.match(detail, /document\.activeElement instanceof HTMLElement/);
  assert.match(detail, /opener\?\.focus\(\)/);
  assert.match(route, /\/phases\/\$\{encodeURIComponent\(phaseId\)\}/);
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
  assert.match(inspector, /partial total/);
  assert.match(inspector, /rendered-safe/);
  assert.match(inspector, />raw</);
});

test("event paging and settings expose required read-only, text-labelled surfaces", () => {
  const events = source("dashboard/src/components/EventLog.vue");
  const settings = source("dashboard/src/components/SettingsRoute.vue");
  assert.match(events, /events\?after=\$\{cursor\.value\}/);
  assert.match(events, /cursor\.value = page\.cursor/);
  assert.match(events, /hasMore\.value = page\.hasMore/);
  assert.match(events, /event\.startedAt/);
  assert.match(events, /event\.type/);
  assert.match(events, /formatDuration/);
  assert.match(events, /aria-expanded/);
  for (const label of ["Effective config", "Adapter health", "Database health"]) {
    assert.match(settings, new RegExp(label));
  }
});

test("motion, live growth, focus, responsive containment, and typed event labels remain accessible", () => {
  const css = source("dashboard/src/styles/dashboard.css");
  assert.match(css, /radial-gradient\(1100px 700px/);
  assert.match(css, /@keyframes live-pulse/);
  assert.match(css, /@keyframes running-glow/);
  assert.match(css, /\.session-card[^{]*\{[^}]*transition:/s);
  assert.match(css, /\.phase-block[^{]*\{[^}]*transition: width 500ms linear/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition-duration: \.01ms !important/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.event-tool_call strong/);
  assert.match(css, /\.event-agent_start strong/);
  assert.match(css, /\.waterfall-scroll \{ overflow-x: auto/);
});
