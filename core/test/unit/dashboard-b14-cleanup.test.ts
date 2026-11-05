import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ref } from "vue";
import {
  agentFallbackColor,
  askLine,
  phaseStatusGlyph,
  sessionExtent,
} from "../../../dashboard/src/presentation.ts";
import { usePolling } from "../../../dashboard/src/composables/usePolling.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("session timeline uses one live-state and end-time rule", () => {
  const session = {
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    endedAt: null,
    state: "RUNNING" as const,
    activity: [{
      id: "phase-point",
      phaseId: "phase",
      source: "event" as const,
      type: "phase_end",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:01:00.000Z",
      endedAt: "2026-01-01T00:02:00.000Z",
    }],
  };
  assert.deepEqual(sessionExtent(session, Date.parse("2026-01-01T00:05:00.000Z")), {
    start: Date.parse("2026-01-01T00:00:00.000Z"),
    end: Date.parse("2026-01-01T00:05:00.000Z"),
    span: 5 * 60_000,
    runtimeEnd: null,
  });
  assert.equal(sessionExtent({ ...session, state: "BLOCKED" }, 0).end, Date.parse("2026-01-01T00:02:00.000Z"));
});

test("shared ask lines keep their bound without splitting Unicode characters", () => {
  const line = askLine("x".repeat(150), 120);
  assert.equal(line?.length, 120);
  assert.ok(line?.endsWith("…"));
  assert.equal(askLine("😀".repeat(121), 120)?.endsWith("😀…"), true);
  assert.equal(askLine("  \n next line ", 120), "next line");
});

test("missing agent colors and phase glyphs are stable across dashboard views", () => {
  assert.equal(agentFallbackColor("planner"), agentFallbackColor("planner"));
  assert.notEqual(agentFallbackColor("planner"), agentFallbackColor("engineer"));
  assert.equal(phaseStatusGlyph("SUCCEEDED"), "●");
  assert.equal(phaseStatusGlyph("RUNNING"), "◐");
  assert.equal(phaseStatusGlyph("FAILED"), "×");
  assert.equal(phaseStatusGlyph("QUEUED"), "○");
});

test("runtime and display helpers are shared by the screens that show the same session", () => {
  for (const path of [
    "dashboard/src/components/SessionCard.vue",
    "dashboard/src/components/SessionHeader.vue",
    "dashboard/src/components/SwimlaneChart.vue",
    "dashboard/src/components/CanvasRunCard.vue",
  ]) {
    assert.match(source(path), /sessionExtent\(/u, path);
  }
  assert.match(source("dashboard/src/components/AgentCard.vue"), /agentFallbackColor\(/u);
  assert.match(source("dashboard/src/components/SessionCard.vue"), /agentFallbackColor\(/u);
  assert.match(source("dashboard/src/components/SwimlaneChart.vue"), /agentFallbackColor\(/u);
  assert.match(source("dashboard/src/components/SessionCard.vue"), /phaseStatusGlyph\(phase\.status\)/u);
  assert.match(source("dashboard/src/components/SwimlaneChart.vue"), /phaseStatusGlyph\(phase\.status\)/u);
  assert.match(source("dashboard/src/components/CanvasRunCard.vue"), /phaseStatusGlyph\(phase\.status\)/u);
});

test("plan cost and session breadcrumb use the shared display rules", () => {
  const planRow = source("dashboard/src/components/SessionPlanRow.vue");
  const nav = source("dashboard/src/components/TopNav.vue");
  assert.match(planRow, /formatCost\(cost\.authority, cost\.usd\)/u);
  assert.doesNotMatch(planRow, /toFixed\(2\)/u);
  assert.match(nav, /shortSessionId\(sessionId\)/u);
  assert.match(nav, /encodeURIComponent\(sessionId\)/u);
});

test("canvas camera updates replace the URL entry and parked links retain the canvas route", () => {
  const canvas = source("dashboard/src/routes/canvas.vue");
  assert.match(canvas, /function updateCamera\(camera: Camera\): void/u);
  assert.match(canvas, /history\.replaceState\(history\.state, "", canvasRouteHash\(updated\)\)/u);
  assert.match(canvas, /@update:camera="updateCamera\(\$event\)"/u);
  assert.match(canvas, /:href="openHref\(node, currentRoute\) \?\? '#'"/u);
});

test("the poller runs once for terminal evidence, resumes when active, and stops again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  const repeat = ref(false);
  let calls = 0;
  const poller = usePolling(async () => { calls++; }, () => "grid", () => repeat.value);
  await poller.refresh();
  assert.equal(calls, 1);
  t.mock.timers.tick(10_000);
  assert.equal(calls, 1, "terminal evidence is not polled again");
  repeat.value = true;
  await flush();
  assert.equal(calls, 2, "a phase that becomes active is refreshed");
  repeat.value = false;
  await flush();
  t.mock.timers.tick(10_000);
  assert.equal(calls, 2, "terminal transition cancels the pending retry");
});

test("event polling follows shared cadence and stops repeating for terminal phases", () => {
  const eventLog = source("dashboard/src/components/EventLog.vue");
  const polling = source("dashboard/src/composables/usePolling.ts");
  assert.match(eventLog, /usePolling\(load, \(\) => "grid", \(\) => !terminalStatuses\.has\(props\.phaseStatus\)\)/u);
  assert.doesNotMatch(eventLog, /setInterval/u);
  assert.match(polling, /shouldRepeat: \(\) => boolean = \(\) => true/u);
  assert.match(polling, /stopped \|\| !shouldRepeat\(\)/u);
});

test("the group reading is shared and lazy-mounted, without re-parsing narratives per field", () => {
  const tree = source("dashboard/src/components/GroupDecisionTree.vue");
  const groups = source("dashboard/src/routes/groups.vue");
  assert.match(tree, /askLine as formatAskLine/u);
  assert.match(tree, /fieldRows\(decision, 'changed'\)/u);
  assert.match(tree, /fieldRows\(proposal, 'its reason'\)/u);
  assert.match(groups, /<GroupTreeGraph v-show="view === 'graph'"/u);
  assert.match(groups, /<GroupDecisionTree v-if="view === 'reading'"/u);
});

test("unused roster presentation and notification state have no consumers", () => {
  const notify = source("dashboard/src/composables/useNotifySound.ts");
  assert.equal(existsSync(new URL("../../../dashboard/src/components/AgentRoster.vue", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../../dashboard/src/components/AgentCard.vue", import.meta.url)), true);
  assert.doesNotMatch(notify, /\blast\b/u);
  assert.match(notify, /return \{ enabled, setEnabled \}/u);
});

test("settings remains available from every screen and provenance uses its shared label", () => {
  const nav = source("dashboard/src/components/TopNav.vue");
  const inspector = source("dashboard/src/components/PhaseInspector.vue");
  const waterfall = source("dashboard/src/components/SwimlaneChart.vue");
  assert.match(nav, /v-if="!settings" class="settings-link" href="#\/settings"/u);
  assert.match(inspector, /modelProvenanceLabel\(agent\.modelProvenance\)/u);
  assert.match(waterfall, /modelProvenanceLabel\(lane\.agent\.modelProvenance\)/u);
});
