// The synthetic payload behind `payload.json`, built the way `GET
// /api/v1/metrics` builds it: synthetic journals projected into a fresh
// database, read by `buildMetricsPayload`, serialized through `publicApiValue`.
// Nothing here reads or copies the owner's database.
//
// Regenerate after a payload change:
//   node --experimental-strip-types core/test/fixtures/metrics/synthetic-payload.ts
// `dashboard-metrics-lens.test.ts` fails while the committed file differs.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicApiValue } from "../../../src/api/responses.ts";
import { buildMetricsPayload } from "../../../src/metrics/payload.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import type { MetricsResponse } from "../../../../dashboard/shared/types.ts";
import type { ReplayRecord } from "../../../src/contracts/proving-ground.ts";
import { OPUS_HIGH, SyntheticAttempt, phase, session, usage } from "../../unit/_metrics-journal.ts";

export const PAYLOAD_PATH = fileURLToPath(new URL("./payload.json", import.meta.url));
export const EXTRACTED_AT = "2026-09-27T12:00:00.000Z";

const CODEX = ["codex", "openai-codex", "codex:gpt-6-sol"] as const;

interface RunShape {
  readonly workflowId?: string;
  readonly projectSlug?: string;
  readonly startedAt?: string;
}

/** The record `awsf prove` gives a replay: its rows carry the item, arm, repetition and order. */
const REPLAY: ReplayRecord = {
  itemId: "review-01", itemDigest: "0".repeat(64), arm: "claude/anthropic/claude:opus@high", repetition: 1, order: 2,
  baseSha: "69711fd879706a8a8da48de2c407285b9ef440c4",
};

/** A landed run: a codex builder observed as gpt-6-sol, and a claude reviewer that never reported a model. */
function landed(sessionId: string, shape: RunShape = {}): SyntheticAttempt {
  const run = new SyntheticAttempt({ ...session(sessionId), ...shape });
  if (shape.workflowId === "prove") run.replay = REPLAY;
  // Phase and run ids are global keys; real ones are session-prefixed too.
  const build = `${sessionId}:builder`, review = `${sessionId}:reviewer`;
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1 }));
  run.start(build, "builder", ...CODEX);
  run.event(build, `${sessionId}-run-1`, { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event(build, `${sessionId}-run-1`, {
    kind: "model.resolved", adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-6-sol",
    resolvedModel: "gpt-6-sol", provenance: "stream-authoritative",
  });
  run.event(build, `${sessionId}-run-1`, { kind: "usage", usage: usage(100_000, 10_000, 400_000, 0, 2_000) });
  run.call(build, "builder", ...CODEX, "gpt-6-sol", usage(100_000, 10_000, 400_000, 0, 2_000));
  run.envelope(build, "builder", 0, "success");
  run.gate(build, 0, "writes_within_globs", true);
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1, status: "SUCCEEDED", endedAt: "2026-09-26T10:10:00.000Z" }));
  run.phase(phase("reviewer", "reviewer", { phaseId: review, ordinal: 2 }));
  run.start(review, "reviewer", "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: "reviewer" });
  run.event(review, `${sessionId}-run-2`, { kind: "usage", usage: usage(20_000, 3_000, 50_000, 10_000, null) });
  run.envelope(review, "reviewer", 0, "success");
  run.review(review, "accept");
  run.phase(phase("reviewer", "reviewer", { phaseId: review, ordinal: 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:12:00.000Z" }));
  run.transition("AWAITING_OWNER");
  run.transition("LANDING");
  run.transition("LANDED");
  return run;
}

/** A run blocked in its builder by a write-boundary breach: a model attribution, so the row is blocked here. */
function blocked(sessionId: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session(sessionId));
  const build = `${sessionId}:builder`;
  run.phase(phase("builder", "builder", { phaseId: build, ordinal: 1, maxCorrections: 0 }));
  run.start(build, "builder", ...CODEX);
  run.event(build, `${sessionId}-run-1`, { kind: "usage", usage: usage(40_000, 4_000, 0, 0, null) });
  run.envelope(build, "builder", 0, "success");
  run.gate(build, 0, "writes_within_globs", false);
  run.phase(phase("builder", "builder", {
    phaseId: build, ordinal: 1, maxCorrections: 0, status: "FAILED", errorCode: "PermissionBreach", endedAt: "2026-09-26T10:05:00.000Z",
  }));
  run.transition("BLOCKED", "PermissionBreach");
  return run;
}

/** A run blocked in a host phase before any agent phase ran: it has an attribution and no role-row. */
function hostBlocked(sessionId: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session(sessionId));
  run.phase(phase("context", "host", {
    phaseId: `${sessionId}:context`, ordinal: 1, kind: "code", status: "FAILED", errorCode: "Error", endedAt: "2026-09-26T10:01:00.000Z",
  }));
  run.phase(phase("builder", "builder", { phaseId: `${sessionId}:builder`, ordinal: 2, status: "QUEUED", startedAt: null }));
  run.transition("BLOCKED", "Error");
  return run;
}

/**
 * Five runs over two projects and three workflows: two landed production runs
 * (one in a second project), one blocked in its builder, one blocked before any
 * agent phase, and one proving-ground replay the default lens leaves out.
 */
export function syntheticMetricsPayload(): MetricsResponse {
  const dir = mkdtempSync(join(tmpdir(), "awsf-metrics-fixture-"));
  const dbPath = join(dir, "awsf.db");
  try {
    const writer = openDatabase(dbPath);
    try {
      landed("f1").project(writer);
      landed("f2", { workflowId: "build-review", projectSlug: "fusion-harness", startedAt: "2026-09-26T11:00:00.000Z" }).project(writer);
      blocked("f3").project(writer);
      hostBlocked("f4").project(writer);
      landed("f5", { workflowId: "prove" }).project(writer);
    } finally {
      writer.close();
    }
    const reader = openDatabase(dbPath, { readonly: true });
    try {
      return JSON.parse(JSON.stringify(publicApiValue(buildMetricsPayload(reader, { extractedAt: EXTRACTED_AT })))) as MetricsResponse;
    } finally {
      reader.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function serializePayload(payload: MetricsResponse): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PAYLOAD_PATH, serializePayload(syntheticMetricsPayload()));
}
