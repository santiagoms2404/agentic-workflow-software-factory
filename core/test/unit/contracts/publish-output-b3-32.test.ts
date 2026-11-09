// B3-32 — a published status's recovery checkpoint must hold its cross-field rules.
//
// The publish output validates structure only. The checkpoint's own rules (a
// completed phase has a saved prefix, a ticket block names its ticket, and so
// on) live in assertPhaseRecovery, which the publish path never called. An
// inconsistent checkpoint was therefore accepted and sealed. The parser now
// applies the checkpoint rules to a published status after the structural pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { PUBLISH_OUTPUT_SCHEMA_ID, publishedRecoveryRefusal } from "../../../src/contracts/publish-output.ts";
import { PhaseRecoverySchema } from "../../../src/contracts/phase-recovery.ts";
import { repoRoot } from "../meta/_walk.ts";

const hash = "a".repeat(64);

/** A completed-phase checkpoint that is well-formed but saved nothing: its prefix is empty. */
function completedWithEmptyPrefix(): Record<string, unknown> {
  return {
    schema: "awsf.phase-recovery/v1", id: "checkpoint", sessionId: "sess-1", kind: "completed-phase",
    workflowId: "build", bindingDigest: hash, budgetDigest: hash,
    repository: "/repo", worktree: "/repo", commonGitDir: "/repo/.git",
    integrationBaseSha: "b".repeat(40), worktreeHeadSha: "b".repeat(40), createdAt: "2026-08-08T12:00:00.000Z",
    prefix: [], quota: null,
  };
}

function capturedOutput(): Record<string, unknown> {
  const capture = JSON.parse(readFileSync(join(repoRoot(), "core", "test", "fixtures", "stages", "S5.json"), "utf8")) as { output: Record<string, unknown> };
  const output = capture.output;
  const status = (output.result as { status: { lastActivity: string } }).status;
  return {
    schema: PUBLISH_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: status.lastActivity,
    artifacts: [],
    notesForNextPhase: "",
    ...output,
  };
}

function withRecovery(output: Record<string, unknown>, recovery: unknown): Record<string, unknown> {
  const result = output.result as { status: Record<string, unknown> };
  return { ...output, result: { ...result, status: { ...result.status, recovery } } };
}

test("the checkpoint under test is structurally valid, so only the cross-field rule can refuse it (B3-32)", () => {
  assert.equal(Value.Check(PhaseRecoverySchema, completedWithEmptyPrefix()), true);
});

test("a published status carrying an inconsistent checkpoint is refused by the parser (B3-32)", () => {
  const output = withRecovery(capturedOutput(), completedWithEmptyPrefix());
  assert.equal(publishedRecoveryRefusal(output) !== null, true);
  const parsed = parseEnvelope(JSON.stringify(output), PUBLISH_OUTPUT_SCHEMA_ID);
  assert.equal(parsed.valid, false);
  if (parsed.valid) return;
  assert.equal(parsed.violations[0]?.path, "/result/status/recovery");
});

test("the captured publish output and an absent checkpoint still validate (B3-32)", () => {
  assert.equal(parseEnvelope(JSON.stringify(capturedOutput()), PUBLISH_OUTPUT_SCHEMA_ID).valid, true);
  assert.equal(publishedRecoveryRefusal(withRecovery(capturedOutput(), null)), null);
});
