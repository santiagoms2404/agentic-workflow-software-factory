import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import { UNREPORTED_TOKEN_USAGE } from "../../../src/contracts/normalized-events.ts";
import type { StoredEnvelope } from "../../../src/contracts/stored-envelope.ts";
import { GateReport } from "../../../src/gates/interface.ts";
import {
  type AgentTurn,
  createCorrectionRequest,
  MAX_GATE_OUTPUT_TAIL_CHARS,
  renderCorrectionRequest,
  UsageAccumulator,
} from "../../../src/workflow/corrections.ts";

function previousEnvelope(): StoredEnvelope<EnvelopeBase> {
  return { envelopeId: "env-1", violations: [] } as unknown as StoredEnvelope<EnvelopeBase>;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

// B6-17: the gate-note tail was a UTF-16 unit slice, so a cut inside an astral
// character left a lone low surrogate at the front of the retained evidence.
test("B6-17: a clipped gate note never begins with a lone low surrogate", () => {
  const note = `${"\u{1F600}".repeat(2000)}y`; // 4001 UTF-16 units; the 4000-unit tail cuts a pair
  const request = createCorrectionRequest({
    phase: "builder",
    round: 1,
    previousEnvelope: previousEnvelope(),
    gateReports: [new GateReport("envelope_valid").check("envelope_valid", false, note)],
    remainingCallBudget: 1,
  });
  const kept = request.gateReports[0]!.checks[0]!.note;
  assert.ok(kept.length <= MAX_GATE_OUTPUT_TAIL_CHARS, `kept ${String(kept.length)} units`);
  assert.equal(isLowSurrogate(kept.charCodeAt(0)), false, `tail starts with ${kept.charCodeAt(0).toString(16)}`);
  assert.ok(kept.endsWith("y"), "the tail keeps the end of the output");
});

test("B6-17: a note inside the limit is kept whole, and a plain ASCII overflow still cuts to the limit", () => {
  const short = "\u{1F600}".repeat(10);
  const longAscii = "a".repeat(MAX_GATE_OUTPUT_TAIL_CHARS + 1);
  const request = createCorrectionRequest({
    phase: "builder",
    round: 1,
    previousEnvelope: previousEnvelope(),
    gateReports: [
      new GateReport("artifacts_exist").check("artifacts_exist", false, short),
      new GateReport("files_non_empty").check("files_non_empty", false, longAscii),
    ],
    remainingCallBudget: 1,
  });
  assert.equal(request.gateReports[0]!.checks[0]!.note, short);
  assert.equal(request.gateReports[1]!.checks[0]!.note.length, MAX_GATE_OUTPUT_TAIL_CHARS);
});

// B6-18: a failed command's evidence was rendered in the prose and again inside
// the JSON request, so one correction prompt carried it twice.
test("B6-18: a failed command's evidence appears once in a candidate correction prompt", () => {
  const marker = "EVIDENCE-MARKER-7f3a";
  const request = createCorrectionRequest({
    phase: "builder",
    round: 1,
    previousEnvelope: previousEnvelope(),
    gateReports: [],
    remainingCallBudget: 1,
    candidate: {
      candidateSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      commands: [{ gateId: "unit", argv: ["npm", "test"], exitCode: 1, evidence: `failing case ${marker} at the head` }],
    },
  });
  const prompt = renderCorrectionRequest(request);
  assert.equal(prompt.split(marker).length - 1, 1, "the evidence is rendered exactly once");
  assert.match(prompt, /Command `unit`/, "the prose still names the failed command");
  assert.match(prompt, /"exitCode": 1/, "the JSON still carries the command's exit code");
});

function turn(costUsd: number | null): Pick<AgentTurn, "usage" | "costUsd"> {
  return { usage: { ...UNREPORTED_TOKEN_USAGE, inputTokens: 1 }, costUsd };
}

// B6-19: a null (unknown) cost turn was skipped, so the phase total read as a
// complete figure while a send was unpriced.
test("B6-19: a phase cost with any unpriced send is unknown, not the partial sum", () => {
  const usage = new UsageAccumulator();
  usage.add(turn(0.5));
  usage.add(turn(null));
  usage.add(turn(0.25));
  const snapshot = usage.snapshot();
  assert.equal(snapshot.sends, 3);
  assert.equal(snapshot.costUsd, null);
});

test("B6-19: an unpriced send is unknown wherever it falls in the sequence", () => {
  const usage = new UsageAccumulator();
  usage.add(turn(null));
  usage.add(turn(0.5));
  assert.equal(usage.snapshot().costUsd, null);
});

test("B6-19: a phase cost is the exact sum when every send is priced, and unknown when none is", () => {
  const priced = new UsageAccumulator();
  priced.add(turn(0.5));
  priced.add(turn(0.25));
  assert.equal(priced.snapshot().costUsd, 0.75);

  const unpriced = new UsageAccumulator();
  unpriced.add(turn(null));
  assert.equal(unpriced.snapshot().costUsd, null);
});
