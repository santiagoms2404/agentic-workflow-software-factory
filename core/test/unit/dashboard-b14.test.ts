import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "./meta/_walk.ts";

function source(relPath: string): string {
  return readFileSync(join(repoRoot(), relPath), "utf8");
}

describe("Batch 14 dashboard behaviors (core/test/unit/dashboard-b14.test.ts)", () => {
  it("StateRibbon states include BLOCKED and CANCELLED terminal states (B14-12)", () => {
    const code = source("dashboard/src/components/StateRibbon.vue");

    // states array definition contains BLOCKED and CANCELLED
    assert.match(code, /"BLOCKED"/u, "StateRibbon must contain BLOCKED");
    assert.match(code, /"CANCELLED"/u, "StateRibbon must contain CANCELLED");

    const statesMatch = code.match(/const states:\s*LifecycleState\[\]\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(statesMatch, "states array declared");
    const statesList = statesMatch[1] ?? "";
    assert.ok(statesList.includes('"BLOCKED"'), "states list includes BLOCKED");
    assert.ok(statesList.includes('"CANCELLED"'), "states list includes CANCELLED");
  });

  it("LiveIndicator uses reactive timer clock for staleness and cleans up on unmount (B14-07)", () => {
    const code = source("dashboard/src/components/LiveIndicator.vue");

    // Must use ref for now, setInterval on mount, clearInterval on unmount
    assert.match(code, /const now = ref\(Date\.now\(\)\)/, "now initialized as reactive ref");
    assert.match(code, /setInterval\(/, "starts interval timer on mount");
    assert.match(code, /clearInterval\(/, "clears interval timer on unmount");
    assert.match(code, /onMounted/, "uses onMounted lifecycle hook");
    assert.match(code, /onUnmounted/, "uses onUnmounted lifecycle hook");

    // Staleness threshold is 2 * pollMs
    assert.match(
      code,
      /now\.value - props\.lastPollAt < 2 \* props\.pollMs/,
      "live computed checks reactive now against 2 * pollMs threshold",
    );
  });

  it("usePolling onFocus clears pending timer before invoking voidPoll to prevent duplicate poll chains (B14-15)", () => {
    const code = source("dashboard/src/composables/usePolling.ts");

    const onFocusMatch = code.match(/const onFocus = \(\) => \{([\s\S]*?)\};/);
    assert.ok(onFocusMatch, "onFocus handler defined");
    const onFocusBody = onFocusMatch[1] ?? "";

    assert.match(onFocusBody, /clearTimeout\(timer\)/, "onFocus must call clearTimeout");
    assert.match(onFocusBody, /timer\s*=\s*undefined/, "onFocus must reset timer to undefined");
    assert.match(onFocusBody, /void\s+voidPoll\(\)/, "onFocus invokes voidPoll");
  });

  it("CanvasWheel allows natural page scroll at sequence boundaries without preventDefault (B14-05)", () => {
    const code = source("dashboard/src/components/CanvasWheel.vue");

    const onWheelMatch = code.match(/function onWheel\(event: WheelEvent\): void \{([\s\S]*?)\n\}/);
    assert.ok(onWheelMatch, "onWheel handler defined");
    const onWheelBody = onWheelMatch[1] ?? "";

    // Checks boundary conditions before event.preventDefault()
    assert.match(onWheelBody, /const delta = event\.deltaY > 0 \|\| event\.deltaX > 0 \? 1 : -1;/, "delta calculation");
    assert.match(
      onWheelBody,
      /if \(\(delta < 0 && atStart\.value\) \|\| \(delta > 0 && atEnd\.value\)\) return;/,
      "early return at start/end boundaries without calling preventDefault",
    );
    assert.match(
      onWheelBody,
      /event\.preventDefault\(\);[\s\S]*?go\(delta\);/,
      "preventDefault called after boundary check",
    );
  });

  it("CanvasMap supports Space/Enter dot selection and open fallback (B14-04)", () => {
    const code = source("dashboard/src/components/CanvasMap.vue");

    assert.match(code, /function onDotKeydown\(event: KeyboardEvent, node: CanvasNode\): void/);
    assert.match(code, /event\.key === " " \|\| event\.key === "Spacebar"/);
    assert.match(code, /emit\("update:selected", props\.selected === node\.id \? null : node\.id\)/);
  });

  it("TicketSourceOverlay tracks mousedown/mouseup on backdrop and traps focus (B14-13, B14-14)", () => {
    const code = source("dashboard/src/components/TicketSourceOverlay.vue");

    assert.match(code, /onBackdropMousedown/);
    assert.match(code, /onBackdropMouseup/);
    assert.match(code, /event\.key === "Tab"/);
    assert.match(code, /event\.shiftKey/);
  });
});
