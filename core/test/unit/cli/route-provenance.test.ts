import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRouteProvenance } from "../../../src/cli/commands/status.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

const AT = "2026-09-04T00:00:00.000Z";

function evidence(mode: "invert-provider" | "same-provider-degraded"): readonly AttemptEvidence[] {
  const route = {
    phaseId: "reviewer",
    requested: {
      phaseId: "reviewer", adapterId: "claude", provider: "anthropic", model: "claude:opus", effort: "high",
      sources: { adapter: "phase-override", provider: "phase-override", model: "phase-override", effort: "agent-default" },
      evaluation: null,
    },
    effective: { adapterId: "claude", adapterKind: "claude-code", provider: "anthropic", model: "opus", effort: "high" },
    observed: null,
    review: {
      mode,
      degraded: mode === "same-provider-degraded",
      detail: mode === "same-provider-degraded"
        ? "explicit same-provider review has reduced independence; it was not selected as fallback"
        : null,
    },
  } as const;
  return [
    {
      type: "agent-start", phaseId: "session:reviewer", agent: "reviewer", adapterId: "claude",
      provider: "anthropic", color: null, requestedModel: "claude:opus",
      sandboxBadge: "tool-policy", sandboxMechanism: "adapter-tool-policy", route, at: AT,
    } as AttemptEvidence,
    {
      type: "agent", phaseId: "session:reviewer", agent: "reviewer", adapterId: "claude",
      provider: "anthropic", color: null, requestedModel: "claude:opus", resolvedModel: "claude-opus-5",
      modelProvenance: "stream-authoritative", contextWindow: null, usageAuthority: "provider",
      usage: {
        inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null,
        reasoningTokens: null, reasoningRelation: "unknown",
      },
      contextTokens: 2, costUsd: null, costAuthority: "unavailable", purpose: "review", at: AT,
    },
  ];
}

test("status keeps requested, effective, and observed route identities distinct", () => {
  const lines = formatRouteProvenance(evidence("invert-provider"));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /requested claude\/anthropic\/claude:opus effort=high/);
  assert.match(lines[0]!, /effective claude\/anthropic\/opus effort=high/);
  assert.match(lines[0]!, /observed claude-code\/anthropic\/opus -> claude-opus-5 \(stream-authoritative\)/);
});

test("status makes explicit same-provider degradation impossible to overlook", () => {
  const lines = formatRouteProvenance(evidence("same-provider-degraded"));
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /^Review independence: DEGRADED/);
  assert.match(lines[1]!, /reduced independence/);
  assert.match(lines[1]!, /not selected as fallback/);
});
