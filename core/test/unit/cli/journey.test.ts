import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nextRevision, persistAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { journeyCommand } from "../../../src/cli/commands/journey.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import type { PhaseEvidenceRecord } from "../../../src/observability/attempt-evidence.ts";

const AT = "2026-08-18T00:00:00.000Z";
const RECIPE_PHASES = ["request", "builder", "tests", "review-context", "reviewer"] as const;
const REWORK_PHASES = [
  "owner-rework-1",
  "owner-rework-1-tests",
  "owner-rework-1-review-context",
  "owner-rework-1-reviewer",
] as const;

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function commit(repository: string): string {
  writeFileSync(join(repository, "README.md"), "journey ordinal fixture\n");
  git(repository, "add", "README.md");
  execFileSync("git", [
    "-C", repository,
    "-c", "user.name=AWSF Test",
    "-c", "user.email=awsf-test@example.com",
    "commit", "-m", "test: seed journey fixture",
  ], { stdio: "ignore" });
  return git(repository, "rev-parse", "HEAD");
}

function phase(sessionId: string, key: string, ordinal: number): PhaseEvidenceRecord {
  return {
    phaseId: `${sessionId}:${key}`,
    ordinal,
    key,
    name: key,
    kind: key === "request" ? "engineer" : key.includes("tests") || key.includes("context") ? "code" : "agent",
    owner: key === "request" ? "owner" : key.includes("tests") || key.includes("context") ? "host" : "builder",
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
}

async function awaitingJourney(includeRework: boolean): Promise<{
  root: string;
  attemptDir: string;
  candidateSha: string;
  priorOrdinals: number[];
}> {
  const root = mkdtempSync(join(tmpdir(), "awsf-journey-ordinal-"));
  const repository = join(root, "repository");
  execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
  const candidateSha = commit(repository);
  const created = await newCommand({
    stateRoot: join(root, "state"),
    project: "journey-test",
    taskId: includeRework ? "after-rework" : "ordinary",
    repository,
    request: "record an owner journey",
    workflow: "build-review",
    tier: 2,
    sessionId: () => includeRework ? "journey-after-rework" : "journey-ordinary",
    now: () => AT,
  });

  const keys = includeRework ? [...RECIPE_PHASES, ...REWORK_PHASES] : [...RECIPE_PHASES];
  let status: AttemptStatus = created.status;
  for (const [index, key] of keys.entries()) {
    status = await persistAttempt(created.attemptDir, status.revision, {
      kind: "attempt.updated",
      next: nextRevision(status, {}),
      evidence: { type: "phase", phase: phase(status.sessionId, key, index + 1) },
    });
  }
  status = await persistAttempt(created.attemptDir, status.revision, {
    kind: "attempt.updated",
    next: nextRevision(status, {
      lifecycleState: "AWAITING_OWNER",
      worktree: repository,
      baseSha: candidateSha,
      candidateSha,
      gatesPass: true,
      requiredReviewPresent: true,
      protectedApprovalsValid: true,
    }),
  });

  return { root, attemptDir: created.attemptDir, candidateSha, priorOrdinals: keys.map((_, index) => index + 1) };
}

async function recordJourney(fixture: Awaited<ReturnType<typeof awaitingJourney>>): Promise<number> {
  await journeyCommand({
    attemptDir: fixture.attemptDir,
    journeyId: "recorded-owner-journey",
    observedSha: fixture.candidateSha,
    now: () => AT,
    terminal: { interactive: true, write: () => {}, confirm: async () => true },
  });
  const evidence = await readAttemptEvidence(fixture.attemptDir);
  const journey = evidence.find(
    (record) => record.type === "phase" && record.phase.key === "owner-journey",
  );
  assert.ok(journey?.type === "phase");
  return journey.phase.ordinal;
}

test("a journey after a T2 owner rework follows every recorded recipe and rework phase", async () => {
  const fixture = await awaitingJourney(true);
  try {
    const ordinal = await recordJourney(fixture);
    assert.ok(fixture.priorOrdinals.every((prior) => ordinal > prior));
    assert.equal(ordinal, 10);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a journey without rework remains immediately after the compiled T2 workflow", async () => {
  const fixture = await awaitingJourney(false);
  try {
    assert.equal(await recordJourney(fixture), 6);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
