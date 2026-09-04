import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nextReworkPhaseOrdinal } from "../../../src/cli/commands/rework.ts";
import type { AttemptEvidence, PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";

const AT = "2026-08-18T00:00:00.000Z";

function phase(key: string, ordinal: number): AttemptEvidence {
  const record: PhaseEvidenceRecord = {
    phaseId: `second-rework-history:${key}`,
    ordinal,
    key,
    name: key,
    kind: key === "request" || key === "owner-journey" ? "engineer" : key.includes("tests") || key.includes("context") ? "code" : "agent",
    owner: key === "request" || key === "owner-journey" ? "owner" : key.includes("tests") || key.includes("context") ? "host" : "builder",
    description: `recorded ${key}`,
    status: "SUCCEEDED",
    correctionCount: 0,
    maxCorrections: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: AT,
    endedAt: AT,
    createdAt: AT,
  };
  return { type: "phase", phase: record };
}

test("a second rework starts above recipe, first-rework, and later journey phases", () => {
  const keys = [
    "request", "builder", "tests", "review-context", "reviewer",
    "owner-rework-1", "owner-rework-1-tests", "owner-rework-1-review-context", "owner-rework-1-reviewer",
    "owner-journey",
  ];
  const history = keys.map((key, index) => phase(key, index + 1));
  const firstSecondReworkOrdinal = nextReworkPhaseOrdinal(history);
  const secondReworkOrdinals = Array.from({ length: 4 }, (_item, index) => firstSecondReworkOrdinal + index);
  const recordedOrdinals = history.map((evidence) => evidence.type === "phase" ? evidence.phase.ordinal : 0);

  assert.equal(firstSecondReworkOrdinal, 11);
  assert.ok(secondReworkOrdinals.every((ordinal) => recordedOrdinals.every((recorded) => ordinal > recorded)));
});

test("a phase recorded while confirmation is open is included in the rework ordinal", () => {
  const evidenceBeforePrompt = [phase("builder", 9), phase("reviewer", 10)];
  const journeyRecordedBeforeConfirmation = phase("owner-journey", 11);
  assert.equal(nextReworkPhaseOrdinal(evidenceBeforePrompt), 11, "the stale pre-prompt derivation would collide with the journey");
  assert.equal(nextReworkPhaseOrdinal([...evidenceBeforePrompt, journeyRecordedBeforeConfirmation]), 12,
    "the post-confirmation derivation advances beyond the phase recorded during the prompt");

  const source = readFileSync(new URL("../../../src/cli/commands/rework.ts", import.meta.url), "utf8");
  const confirmation = source.indexOf("if (!confirmed)");
  const launchEvidence = source.indexOf("const launchEvidence = await readAttemptEvidence(options.attemptDir)");
  const derivation = source.indexOf("const builderOrdinal = nextReworkPhaseOrdinal(launchEvidence)");
  assert.ok(confirmation >= 0 && launchEvidence > confirmation && derivation > launchEvidence,
    "the launch ordinal must be derived from evidence re-read after confirmation");
  assert.doesNotMatch(source, /const builderOrdinal = nextReworkPhaseOrdinal\(governingEvidence\)/u);
  assert.doesNotMatch(source, /recipe\.phases\.length\s*\+/u);
});
