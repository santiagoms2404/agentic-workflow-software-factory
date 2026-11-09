import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { readAttemptEvidence, recordedReviews } from "../../../src/cli/commands/review-record.ts";
import { renderRunReport } from "../../../src/observability/run-report.ts";

const SESSION = "session-read-validation";
const PHASE = `${SESSION}:reviewer`;
const CANDIDATE = "a".repeat(40);

function envelopeEvidence(schemaId: string, valid: boolean, payload: unknown): object {
  return {
    type: "envelope",
    phaseId: PHASE,
    envelope: {
      envelopeId: `${SESSION}:reviewer:0`,
      sessionId: SESSION,
      phaseId: PHASE,
      correctionRound: 0,
      agent: "reviewer",
      schemaId,
      valid,
      createdAt: "2026-08-14T00:00:00.000Z",
      payload,
      violations: valid ? [] : [{ kind: "unknown-schema-id", path: "", message: "unknown schema", received: schemaId }],
      rawOutputPath: "raw/reviewer.txt",
    },
  };
}

function reportStatus(): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1",
    sessionId: SESSION,
    taskId: "legacy-review",
    attempt: 1,
    revision: 7,
    request: "Inspect a retained candidate.",
    lifecycleState: "AWAITING_OWNER",
    candidateSha: CANDIDATE,
    blocker: null,
    nextAction: "land",
    budget: { callsSpent: 2, callsReserved: 0, ceiling: 5 },
  } as unknown as AttemptStatus;
}

test("known legacy review payloads become explicit invalid evidence without changing journal bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-envelope-read-validation-"));
  try {
    const legacyReview = {
      schema: "awsf.review-output/v1",
      producerStatus: "success",
      summary: "legacy review",
      artifacts: [],
      notesForNextPhase: "owner decides",
      verdict: "concern",
      reviewedSha: CANDIDATE,
      findings: [{
        id: "f1",
        severity: "high",
        file: "core/src/example.ts",
        line: 1,
        title: "legacy finding",
        detail: "A concrete defect.",
        evidence: "Observed in the candidate.",
      }],
      limitations: [],
    };
    const unknownInvalid = envelopeEvidence("awsf.future-output/v9", false, null);
    const unknownValid = envelopeEvidence("awsf.future-output/v9", true, { schema: "awsf.future-output/v9", summary: "retained" });
    const journal = [
      JSON.stringify({ event: { evidence: envelopeEvidence("awsf.review-output/v1", true, legacyReview) } }),
      JSON.stringify({ event: { evidence: unknownInvalid } }),
      JSON.stringify({ event: { evidence: unknownValid } }),
      "",
    ].join("\n");
    const journalPath = join(root, "journal.jsonl");
    await writeFile(journalPath, journal);

    const evidence = await readAttemptEvidence(root);
    const invalid = evidence.find((record) => record.type === "envelope" && record.envelope.schemaId === "awsf.review-output/v1");
    assert.ok(invalid?.type === "envelope");
    assert.equal(invalid.envelope.valid, false);
    assert.equal(invalid.envelope.payload, null);
    assert.ok(invalid.envelope.violations.some((violation) => violation.path.includes("consequence")));
    assert.equal(recordedReviews(evidence, SESSION).length, 0);
    const unknownRecords = evidence.filter((record) => record.type === "envelope" && record.envelope.schemaId === "awsf.future-output/v9");
    assert.equal(unknownRecords.length, 2, "valid and invalid unknown-schema envelopes remain retained");
    assert.equal(unknownRecords[0]?.type === "envelope" ? unknownRecords[0].envelope.valid : null, false);
    assert.equal(unknownRecords[1]?.type === "envelope" ? unknownRecords[1].envelope.valid : null, true);

    const report = renderRunReport(reportStatus(), evidence);
    assert.match(report.markdown, /No review envelope completed\./u);
    assert.doesNotMatch(report.markdown, /Consequence: undefined/u);
    assert.equal(await readFile(journalPath, "utf8"), journal, "read-side validation never rewrites canonical journal bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
