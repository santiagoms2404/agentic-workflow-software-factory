import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./meta/_walk.ts";

function source(path: string): string {
  return readFileSync(join(repoRoot(), path), "utf8");
}

test("B14-04: CanvasMap supports Enter/Space selection and navigation fallback", () => {
  const map = source("dashboard/src/components/CanvasMap.vue");
  assert.match(map, /function onDotKeydown\(event: KeyboardEvent, node: CanvasNode\): void/u);
  assert.match(map, /if \(event\.key === " " \|\| event\.key === "Spacebar"\)/u);
  assert.match(map, /emit\("update:selected", props\.selected === node\.id \? null : node\.id\)/u);
  assert.match(map, /@keydown="onDotKeydown\(\$event, node\)"/u);
  // open fallback when no href
  assert.match(map, /function open\(node: CanvasNode\): void \{\s*const href = openHref\(node, props\.route\);\s*if \(href !== null\) \{\s*location\.hash = href;\s*\} else \{\s*emit\("update:selected", props\.selected === node\.id \? null : node\.id\);\s*\}/u);
});

test("B14-05: CanvasWheel does not preventDefault when at sequence boundaries", () => {
  const wheel = source("dashboard/src/components/CanvasWheel.vue");
  assert.match(wheel, /const delta = event\.deltaY > 0 \|\| event\.deltaX > 0 \? 1 : -1;/u);
  assert.match(wheel, /if \(\(delta < 0 && atStart\.value\) \|\| \(delta > 0 && atEnd\.value\)\) return;/u);
});

test("B14-07: LiveIndicator uses reactive timer clock for staleness", () => {
  const live = source("dashboard/src/components/LiveIndicator.vue");
  assert.match(live, /setInterval/u);
  assert.match(live, /clearInterval/u);
  assert.match(live, /now\.value - props\.lastPollAt < 2 \* props\.pollMs/u);
});

test("B14-08: MetricsRun uses formatDate for run.startedAt", () => {
  const run = source("dashboard/src/components/MetricsRun.vue");
  assert.match(run, /formatDate\(run\.startedAt\)/u);
  assert.doesNotMatch(run, /run\.startedAt\.slice\(0, 10\)/u);
});

test("B14-12: StateRibbon includes BLOCKED and CANCELLED terminal states", () => {
  const ribbon = source("dashboard/src/components/StateRibbon.vue");
  assert.match(ribbon, /"BLOCKED"/u);
  assert.match(ribbon, /"CANCELLED"/u);
});

test("B14-13 & B14-14: TicketSourceOverlay handles backdrop mouse tracking and focus trap", () => {
  const overlay = source("dashboard/src/components/TicketSourceOverlay.vue");
  // B14-13: backdrop mousedown and mouseup
  assert.match(overlay, /@mousedown="onBackdropMousedown"/u);
  assert.match(overlay, /@mouseup="onBackdropMouseup"/u);
  assert.match(overlay, /mousedownOnOverlay = event\.target === event\.currentTarget/u);
  assert.match(overlay, /if \(mousedownOnOverlay && event\.target === event\.currentTarget\) \{\s*emit\("close"\);\s*\}/u);

  // B14-14: focus trap on Tab / Shift+Tab inside dialog
  assert.match(overlay, /event\.key === "Tab"/u);
  assert.match(overlay, /event\.shiftKey/u);
  assert.match(overlay, /ref="dialog"/u);
});
