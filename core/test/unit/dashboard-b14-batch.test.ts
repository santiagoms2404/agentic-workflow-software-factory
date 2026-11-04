import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relPath: string): string {
  return readFileSync(new URL(`../../../${relPath}`, import.meta.url), "utf8");
}

describe("Batch 14 findings in composables and routes", () => {
  it("B14-15: usePolling onFocus clears pending timer before polling", () => {
    const code = source("dashboard/src/composables/usePolling.ts");
    // onFocus must clear timer if pending before invoking voidPoll
    const onFocusMatch = code.match(/const onFocus = \(\) => \{([\s\S]*?)\};/);
    assert.ok(onFocusMatch, "onFocus defined");
    const onFocusBody = onFocusMatch[1] ?? "";
    assert.match(onFocusBody, /clearTimeout\(timer\)/, "onFocus must call clearTimeout(timer)");
    assert.match(onFocusBody, /timer\s*=\s*undefined/, "onFocus must reset timer to undefined");
  });

  it("B14-09, B14-10, B14-11: SessionRoute resets loadingPhase and clears detail when phase changes or completes", () => {
    const code = source("dashboard/src/components/SessionRoute.vue");
    const loadPhaseMatch = code.match(/async function loadPhase\(\): Promise<void> \{([\s\S]*?)\n\}/);
    assert.ok(loadPhaseMatch, "loadPhase defined");
    const loadPhaseBody = loadPhaseMatch[1] ?? "";

    // B14-09: when phaseId is null, loadingPhase must be reset to false
    const nullPhaseBranch = loadPhaseBody.match(/if\s*\(phaseId === null\)\s*\{([\s\S]*?)\}/);
    assert.ok(nullPhaseBranch, "if (phaseId === null) branch found");
    assert.match(nullPhaseBranch[1] ?? "", /loadingPhase\.value\s*=\s*false/, "loadingPhase.value reset to false when null");
    assert.match(nullPhaseBranch[1] ?? "", /phaseError\.value\s*=\s*null/, "phaseError.value reset to null when null");
    assert.match(nullPhaseBranch[1] ?? "", /detail\.value\s*=\s*null/, "detail.value reset to null when null");

    // B14-10: when switching between phases, clear previous detail while new phase is loading
    assert.match(
      loadPhaseBody,
      /loadingPhase\.value\s*=\s*true;[\s\S]*?detail\.value\s*=\s*null;/,
      "detail.value cleared while new phase loads",
    );

    // B14-11: loadingPhase reset to false in finally
    assert.match(
      loadPhaseBody,
      /finally\s*\{[\s\S]*?loadingPhase\.value\s*=\s*false;[\s\S]*?\}/,
      "loadingPhase reset to false in finally block",
    );
  });

  it("B14-16: backlog.vue admits newly registered plans into selection", () => {
    const code = source("dashboard/src/routes/backlog.vue");
    assert.match(
      code,
      /admitNewFilterValues/,
      "backlog.vue must use admitNewFilterValues to admit newly registered plans",
    );
  });

  it("B14-17: backlog.vue loadSource supports refreshing and invalidates cached source text", () => {
    const code = source("dashboard/src/routes/backlog.vue");
    const loadSourceMatch = code.match(/async function loadSource\(([\s\S]*?)\): Promise<void> \{([\s\S]*?)\n\}/);
    assert.ok(loadSourceMatch, "loadSource defined");
    const [params, body] = [loadSourceMatch[1] ?? "", loadSourceMatch[2] ?? ""];

    // Must accept a refresh option or parameter
    assert.match(params, /refresh/, "loadSource accepts refresh parameter");

    // When refreshing, should bypass cached check or invalidate
    assert.match(body, /!refresh\s*&&/, "loadSource checks cached sources only when not refreshing");

    // openTicket should trigger refresh when opening ticket
    const openTicketMatch = code.match(/function openTicket\(ticket: BacklogTicket\): void \{([\s\S]*?)\}/);
    assert.ok(openTicketMatch, "openTicket defined");
    assert.match(openTicketMatch[1] ?? "", /loadSource\(\s*ticket,\s*true\s*\)/, "openTicket calls loadSource with refresh");
  });

  it("B14-24: groups.vue uses request sequence counter to discard stale async responses", () => {
    const code = source("dashboard/src/routes/groups.vue");
    // Must declare a requestSequence counter
    assert.match(code, /let\s+requestSequence\s*=\s*0;/, "requestSequence declared");

    // watch(selected) must increment sequence and check it before setting tree, error, or loading
    const watchMatch = code.match(/watch\(\s*\(\)\s*=>\s*props\.selected,[\s\S]*?async\s*\(group\)\s*=>\s*\{([\s\S]*?)\n\s*\},/);
    assert.ok(watchMatch, "watch(props.selected) found");
    const watchBody = watchMatch[1] ?? "";

    assert.match(watchBody, /\+\+requestSequence/, "increments requestSequence");
    assert.match(watchBody, /sequence\s*!==\s*requestSequence/, "checks sequence against requestSequence before setting tree");
    assert.match(watchBody, /if\s*\(sequence\s*===\s*requestSequence\)\s*\{?\s*(?:error\.value|loading\.value)/, "guards error/loading with sequence");
  });

  it("B14-25: metrics.vue maintains run selection stability across polls when route has no explicit run", () => {
    const code = source("dashboard/src/routes/metrics.vue");
    // Must track or preserve selectedRunId across polls
    assert.match(code, /selectedRunId/, "metrics.vue declares or tracks selectedRunId");
    // When route.run is null, picker must preserve currently selected run if still valid in lens
    assert.match(code, /candidate\.runs\.find|runs\.some|candidate\.runs\.some/, "checks whether previously selected run remains valid in lens");
  });

  it("B14-26: metrics.vue exposes staleness indicator when poll fails after initial load", () => {
    const code = source("dashboard/src/routes/metrics.vue");
    // Must destructure usePolling or expose staleness indicator
    assert.match(code, /lastPollAt/, "reads lastPollAt from usePolling");
    // Template or computed must check for stale condition when payload is present
    assert.match(code, /(?:payload(?:\.value)?\s*&&\s*failed(?:\.value)?)|isStale/, "checks for stale condition when payload is present and poll failed");
    assert.match(code, /stale/, "renders or provides stale warning/indicator");
  });

  it("B14-28: metrics.vue fetch in load() uses AbortSignal timeout", () => {
    const code = source("dashboard/src/routes/metrics.vue");
    const loadMatch = code.match(/async function load\(\): Promise<void> \{([\s\S]*?)\n\}/);
    assert.ok(loadMatch, "load defined");
    const loadBody = loadMatch[1] ?? "";
    assert.match(loadBody, /AbortSignal\.timeout\(\s*10_?000\s*\)/, "fetch passes AbortSignal.timeout(10000)");
  });
});
