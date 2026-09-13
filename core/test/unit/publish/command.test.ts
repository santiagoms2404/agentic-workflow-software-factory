import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { publishCommand } from "../../../src/cli/commands/publish.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import { envelopesForPhase, getSession } from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { containsCredential } from "../../../src/policy/redaction.ts";
import { SealedAttempt } from "../../../src/persistence/attempt-lock.ts";
import { bareFixture } from "./_bare.ts";

const AT = "2026-08-25T00:00:00.000Z";

function terminal(confirm: boolean, lines: string[] = []): OwnerTerminal {
  return { interactive: true, write: (line) => { lines.push(line); }, confirm: async () => confirm };
}

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function catalog(): string {
  return `version: awsf.project/v1
project:
  slug: publish-test
repositories:
  plans:
    role: plan
    default_branch: main
    publish:
      remotes: [origin]
      branches: [published]
plans:
  root: specs
  format: awsf-plan-html/v1
`;
}

async function landed(stateRoot: string, repository: string, taskId: string, sha: string, projectRecord?: Parameters<typeof newCommand>[0]["projectRecord"]): Promise<{ attemptDir: string; status: AttemptStatus }> {
  const created = await newCommand({
    stateRoot,
    project: "publish-test",
    taskId,
    repository,
    request: "publish the landed candidate",
    workflow: "build",
    tier: 1,
    now: () => AT,
    sessionId: () => `${taskId}-session`,
    ...(projectRecord === undefined ? {} : { projectRecord }),
  });
  const status = await persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.transitioned",
    next: nextRevision(created.status, {
      lifecycleState: "LANDED",
      activeOperation: "completed-operation",
      recovery: null,
      seed: null,
      candidateSha: sha,
      landingApproval: { candidateSha: sha, summary: "Publish this revision.", approvedAt: AT },
      lastActivityAt: AT,
      lastActivity: "candidate landed",
    }),
  }, projectRecord);
  return { attemptDir: created.attemptDir, status };
}

function configurePublish(repository: string): string {
  writeFileSync(join(repository, "awsf.project.yaml"), catalog());
  execFileSync("git", ["-C", repository, "add", "awsf.project.yaml"], { env: GIT_ENV });
  execFileSync("git", ["-C", repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: configure publication"], { env: GIT_ENV });
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8", env: GIT_ENV }).trim();
}

function journalLines(attemptDir: string): string[] {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8").trim().split("\n").filter(Boolean);
}

test("a second awsf publish is sealed before it can observe or push", async () => {
  const fixture = bareFixture();
  try {
    const sha = configurePublish(fixture.work);
    const created = await landed(join(fixture.root, "state"), fixture.work, "T18-sealed", sha);
    const published = await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, { lifecycleState: "PUBLISHED" }),
    });
    let calls = 0;

    await assert.rejects(
      publishCommand({
        attemptDir: created.attemptDir,
        stateRoot: join(fixture.root, "state"),
        terminal: terminal(true),
        gitRunner: (argv) => { calls += 1; return fixture.runner(argv); },
      }),
      (error: unknown) => error instanceof SealedAttempt,
    );
    assert.equal(calls, 0);
    assert.equal((await readAttempt(created.attemptDir)).revision, published.revision);
  } finally {
    fixture.dispose();
  }
});

test("a declined publish has no push, transition, or journal record", async () => {
  const fixture = bareFixture();
  try {
    const sha = configurePublish(fixture.work);
    const created = await landed(join(fixture.root, "state"), fixture.work, "T18-declined", sha);
    const before = journalLines(created.attemptDir).length;
    const invocations: string[][] = [];
    const result = await publishCommand({
      attemptDir: created.attemptDir,
      stateRoot: join(fixture.root, "state"),
      terminal: terminal(false),
      gitRunner: (argv) => { invocations.push([...argv]); return fixture.runner(argv); },
    });

    assert.deepEqual(result, { outcome: "declined" });
    assert.equal(invocations.some((argv) => argv[0] === "push"), false);
    assert.equal(journalLines(created.attemptDir).length, before);
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "LANDED");
  } finally {
    fixture.dispose();
  }
});

test("publication journals a scrubbed round-trippable record and projects PUBLISHED", async () => {
  const fixture = bareFixture();
  const projection = createDashboardProjection(join(fixture.root, "state"));
  try {
    const sha = configurePublish(fixture.work);
    const created = await landed(join(fixture.root, "state"), fixture.work, "T18-record", sha, projection.project);
    const terminalLines: string[] = [];
    const result = await publishCommand({
      attemptDir: created.attemptDir,
      stateRoot: join(fixture.root, "state"),
      terminal: terminal(true, terminalLines),
      gitRunner: fixture.runner,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      now: () => AT,
    });

    assert.equal(result.outcome, "published");
    const line = journalLines(created.attemptDir).at(-1)!;
    const record = JSON.parse(line) as {
      event: { evidence?: { type: string; remote: string; branch: string; publishedSha: string; phaseId?: string } };
    };
    assert.equal(JSON.stringify(record), line, "the serialized journal line round-trips");
    assert.equal(record.event.evidence?.type, "publish");
    assert.equal(record.event.evidence?.phaseId, "T18-record-session:publish");
    assert.equal(line.includes("://"), false);
    assert.equal(line.includes("@"), false);
    assert.equal(containsCredential(line), false, "sweep the serialized line, never the record object");

    const db = openDatabase(join(fixture.root, "state", "awsf.db"));
    try {
      assert.equal(getSession(db, "T18-record-session")?.lifecycle_state, "PUBLISHED");
      const envelopes = envelopesForPhase(db, "T18-record-session", "T18-record-session:publish");
      assert.equal(envelopes.length, 1);
      assert.equal(envelopes[0]?.schema_id, "awsf.publish-output/v1");
      assert.equal(envelopes[0]?.valid, 1);
      const payload = JSON.parse(envelopes[0]!.payload_json) as {
        terminalLines: string[];
        result: { status: AttemptStatus };
        finalStatusBytes: string;
      };
      assert.deepEqual(payload.terminalLines, terminalLines);
      assert.deepEqual(payload.result.status, result.status);
      assert.equal(payload.result.status.activeOperation, "completed-operation");
      assert.equal(payload.result.status.recovery, null);
      assert.equal(payload.result.status.seed, null);
      assert.equal(payload.finalStatusBytes, readFileSync(join(created.attemptDir, "status.json"), "utf8"));
    } finally {
      db.close();
    }
  } finally {
    projection.close();
    fixture.dispose();
  }
});
