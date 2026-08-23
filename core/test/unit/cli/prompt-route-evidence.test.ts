import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  assertPromptCompositionCurrent,
  PromptCompositionMismatch,
  recordedRoutes,
  type RecordedRoute,
} from "../../../src/cli/commands/review-record.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import {
  PROMPT_COMPOSITION_VERSION,
  promptSha256,
  type PromptBundle,
} from "../../../src/workflow/prompt-composition.ts";

const PHASE = "fixture-session:builder";
const AT = "2026-08-23T00:00:00.000Z";

function bundle(role: string, shared: string): PromptBundle {
  const systemPrompt = shared.length === 0 ? role : `${role}\n\n${shared}`;
  return {
    userPrompt: "user bytes\n",
    systemPrompt,
    evidence: {
      roleSystemDigest: promptSha256(role),
      sharedBlockDigest: promptSha256(shared),
      composedSystemDigest: promptSha256(systemPrompt),
      compositionVersion: PROMPT_COMPOSITION_VERSION,
    },
  };
}

function governingRoute(recorded: PromptBundle): RecordedRoute {
  const evidence: AttemptEvidence[] = [
    {
      type: "compiled-prompt", phaseId: PHASE, name: "system", text: recorded.systemPrompt,
      ...recorded.evidence, lineCount: recorded.systemPrompt.split(/\r?\n/).length, at: AT,
    },
    {
      type: "agent", phaseId: PHASE, agent: "builder", adapterId: "codex", provider: "openai-codex",
      color: null, requestedModel: "codex:gpt-5.6-sol", resolvedModel: "codex:gpt-5.6-sol",
      modelProvenance: "route-attributed", contextWindow: null, usageAuthority: "provider",
      usage: {
        inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        reasoningTokens: 0, reasoningRelation: "unknown",
      },
      contextTokens: 2, costUsd: null, costAuthority: "unavailable", at: AT,
    },
  ];
  return recordedRoutes(evidence, new Set()).worker!;
}

test("exact current composition matches the governing immutable route evidence", () => {
  const current = bundle("role bytes\n", "shared bytes\n");
  assert.doesNotThrow(() => assertPromptCompositionCurrent(current, governingRoute(current), "builder"));
});

test("role and shared drift produce exact digest mismatches before reservation or GO", () => {
  const recorded = bundle("role bytes\n", "shared bytes\n");
  const governing = governingRoute(recorded);
  const cases = [
    { component: "role-system", current: bundle("changed role bytes\n", "shared bytes\n") },
    { component: "shared-block", current: bundle("role bytes\n", "changed shared bytes\n") },
  ] as const;

  for (const scenario of cases) {
    let reservations = 0;
    let goInstructions = 0;
    const laterRoute = (): void => {
      assertPromptCompositionCurrent(scenario.current, governing, "builder");
      reservations += 1;
      goInstructions += 1;
    };
    assert.throws(laterRoute, (error: unknown) => {
      assert.ok(error instanceof PromptCompositionMismatch);
      assert.equal(error.currentDigest, scenario.current.evidence.composedSystemDigest);
      assert.equal(error.recordedDigest, recorded.evidence.composedSystemDigest);
      assert.equal(error.message,
        `current composed system digest ${scenario.current.evidence.composedSystemDigest} does not match governing recorded builder digest ${recorded.evidence.composedSystemDigest}; ` +
        `changed component(s): ${scenario.component}; config snapshot equality covers prompt paths only and cannot override digest inequality; ` +
        "start under a new configuration snapshot");
      return true;
    });
    assert.equal(reservations, 0, `${scenario.component}: no call was reserved`);
    assert.equal(goInstructions, 0, `${scenario.component}: no GO instruction was sent`);
  }
});

test("all three launch implementations persist compiled evidence before their adapter execution site", () => {
  const cases = [
    { path: "core/src/cli/commands/production-run.ts", marker: "...(name === \"system\" ? route.evidence : {})" },
    { path: "core/src/cli/commands/review-phase.ts", marker: "...route.evidence" },
    { path: "core/src/cli/commands/rework.ts", marker: "...route.evidence" },
  ] as const;
  for (const fixture of cases) {
    const source = readFileSync(resolve(fixture.path), "utf8");
    const evidenceAt = source.indexOf(fixture.marker);
    const launchAt = source.indexOf("route.adapter.execute", evidenceAt);
    assert.ok(evidenceAt >= 0, `${fixture.path}: composition evidence persistence is present`);
    assert.ok(launchAt > evidenceAt, `${fixture.path}: composition evidence is persisted before adapter execution`);
  }
});
