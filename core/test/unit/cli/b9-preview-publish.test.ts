// B9-13, B9-14, B9-16, B9-17, B9-29: Tier 4 Batch 9 fixes in init, metrics, preview, publish.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initCommand } from "../../../src/cli/commands/init.ts";
import { filterRuns, metricsFilter, parseUtcInstant } from "../../../src/cli/commands/metrics.ts";
import { CONTENT_TYPES, previewCommand } from "../../../src/cli/commands/preview.ts";
import { candidateModifiesProjectCatalog, publishCommand, publishPolicyFor } from "../../../src/cli/commands/publish.ts";
import { nextRevision, persistAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import type { MetricsRun } from "../../../../dashboard/shared/types.ts";

const AT = "2026-08-16T12:00:00.000Z";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function terminal(): OwnerTerminal {
  return {
    interactive: true,
    write: () => {},
    confirm: async () => true,
  };
}

// ---------------------------------------------------------------------------
// 1. B9-13 (init.ts:41): init cleanup on failure leaves directory retryable
// ---------------------------------------------------------------------------

test("B9-13: if init fails on a non-existent path, the created path is removed so retry succeeds", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-13-new-"));
  const target = join(root, "repo-target");
  try {
    // Calling with an invalid slug causes buildMinimalConfig to fail
    await assert.rejects(
      initCommand({ path: target, slug: "Invalid Slug With Spaces" }),
    );
    // The target path should have been cleaned up and not left as a partial empty/corrupt dir
    assert.equal(existsSync(target), false, "target directory should be cleaned up on failure");

    // Retrying with a valid slug succeeds
    const result = await initCommand({ path: target, slug: "valid-slug" });
    assert.equal(result.producerStatus, "success");
    assert.ok(existsSync(join(target, ".git")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B9-13: if init fails on an existing empty dir, contents are cleaned up so retry succeeds", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-13-existing-"));
  const target = join(root, "empty-target");
  mkdirSync(target);
  try {
    await assert.rejects(
      initCommand({ path: target, slug: "Invalid Slug" }),
    );
    // Target still exists, but is empty so init can retry
    assert.ok(existsSync(target));

    const result = await initCommand({ path: target, slug: "valid-slug" });
    assert.equal(result.producerStatus, "success");
    assert.ok(existsSync(join(target, ".git")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. B9-14 (metrics.ts:88): parse --started-before treating date-time strings without offset as UTC
// ---------------------------------------------------------------------------

test("B9-14: parseUtcInstant treats date-time without offset as UTC", () => {
  const withOffset = "2026-05-01T12:00:00Z";
  const withoutOffset = "2026-05-01T12:00:00";
  const withSpace = "2026-05-01 12:00:00";
  const dateOnly = "2026-05-01";

  assert.equal(parseUtcInstant(withoutOffset), Date.parse(withOffset));
  assert.equal(parseUtcInstant(withSpace), Date.parse(withOffset));
  assert.equal(parseUtcInstant(dateOnly), Date.parse("2026-05-01T00:00:00.000Z"));
});

test("B9-14: metricsFilter accepts date-time without offset and filters runs strictly before that UTC instant", () => {
  const filter = metricsFilter({ startedBefore: "2026-05-01T12:00:00" });
  assert.equal(filter.startedBefore, "2026-05-01T12:00:00");

  const runBefore: MetricsRun = {
    workflow: "build-review",
    startedAt: "2026-05-01T11:59:59.000Z",
    project: "p",
    taskId: "t1",
    attempt: 1,
    lifecycleState: "SUCCEEDED",
    terminalAt: "2026-05-01T12:05:00.000Z",
  } as unknown as MetricsRun;

  const runAfter: MetricsRun = {
    workflow: "build-review",
    startedAt: "2026-05-01T12:00:01.000Z",
    project: "p",
    taskId: "t2",
    attempt: 1,
    lifecycleState: "SUCCEEDED",
    terminalAt: "2026-05-01T12:05:00.000Z",
  } as unknown as MetricsRun;

  const inScope = filterRuns([runBefore, runAfter], filter);
  assert.equal(inScope.length, 1);
  assert.equal(inScope[0]?.taskId, "t1");
});

// ---------------------------------------------------------------------------
// 3. B9-16 (preview.ts:162): common web MIME types (.mjs, .wasm, .json, etc.)
// ---------------------------------------------------------------------------

test("B9-16: CONTENT_TYPES includes .mjs, .wasm, .json, and common web extensions", () => {
  assert.equal(CONTENT_TYPES["mjs"], "text/javascript; charset=utf-8");
  assert.equal(CONTENT_TYPES["wasm"], "application/wasm");
  assert.equal(CONTENT_TYPES["json"], "application/json; charset=utf-8");
  assert.equal(CONTENT_TYPES["map"], "application/json; charset=utf-8");
  assert.equal(CONTENT_TYPES["png"], "image/png");
  assert.equal(CONTENT_TYPES["svg"], "image/svg+xml");
});

// ---------------------------------------------------------------------------
// 4. B9-17 (preview.ts:303): serveBundle failure handling covers lease & preview.json writes
// ---------------------------------------------------------------------------

test("B9-17: if lease write or preview.json write fails after server start, server is closed and lease released", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-17-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");

    const projectYaml = `version: awsf.project/v1
project:
  slug: preview-test
repositories:
  plan:
    role: plan
    default_branch: main
    delivery: service
    preview:
      bundle: dist
      build:
        argv: ["fake-build"]
        timeout_seconds: 5
plans:
  root: specs
  format: awsf-plan-html/v1
`;
    writeFileSync(join(repo, "awsf.project.yaml"), projectYaml);
    writeFileSync(join(repo, ".gitignore"), "dist/\n");
    const dist = join(repo, "dist");
    mkdirSync(dist);
    writeFileSync(join(dist, "index.html"), "<h1>hello base</h1>");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "index.ts"), "export const x = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "chore: base");
    const baseSha = git(repo, "rev-parse", "HEAD");

    writeFileSync(join(repo, "src", "index.ts"), "export const x = 2;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "chore: candidate");
    const candidateSha = git(repo, "rev-parse", "HEAD");

    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot,
      project: "preview-test",
      taskId: "T-prev",
      repository: repo,
      request: "preview failure handling",
      workflow: "build",
      tier: 1,
      now: () => AT,
      sessionId: () => "sess-prev",
    });

    await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, {
        lifecycleState: "AWAITING_OWNER",
        baseSha,
        candidateSha,
        worktree: repo,
      }),
    });

    // Make preview.json a directory so writing preview.json fails inside record()
    const previewJsonDir = join(created.attemptDir, "preview.json");
    mkdirSync(previewJsonDir);

    const runCommand = () => {
      // simulate build by writing fresh file in bundle
      writeFileSync(join(dist, "index.html"), `<h1>fresh at ${Date.now()}</h1>`);
      return { status: 0, stdout: "ok", stderr: "", error: null };
    };

    await assert.rejects(
      previewCommand({
        attemptDir: created.attemptDir,
        stateRoot,
        write: () => {},
        now: () => AT,
        port: 0,
        runCommand,
      }),
      (err: unknown) => err instanceof Error && "code" in err && (err.code === "EISDIR" || err.code === "EEXIST"),
    );

    // Lease should be released
    const leaseRaw = readFileSync(join(stateRoot, "preview-server.json"), "utf8");
    const lease = JSON.parse(leaseRaw) as { state: string };
    assert.equal(lease.state, "released", "lease should be marked released after error");

    // Remove the obstruction on preview.json
    rmSync(previewJsonDir, { recursive: true, force: true });

    // Now previewCommand should succeed without "a preview server is already alive" refusal
    const result = await previewCommand({
      attemptDir: created.attemptDir,
      stateRoot,
      write: () => {},
      now: () => AT,
      port: 0,
      runCommand,
    });

    assert.ok(result.server !== null);
    assert.equal(result.record.posture, "service");
    await result.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. B9-29 (init.ts:41, publish.ts:156): awsf.project.yaml is protected against untrusted modification
// ---------------------------------------------------------------------------

test("B9-29: initCommand includes awsf.project.yaml in policy.protected_paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-29-init-"));
  const target = join(root, "init-repo");
  try {
    await initCommand({ path: target, slug: "test-slug" });
    const config = loadConfig(readFileSync(join(target, "awsf.config.yaml"), "utf8"));
    assert.ok(
      config.policy.protected_paths.includes("awsf.project.yaml"),
      "awsf.project.yaml must be in protected_paths",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B9-29: publishCommand refuses when awsf.project.yaml is modified by candidate", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b9-29-pub-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");

    const projectYaml = `version: awsf.project/v1
project:
  slug: publish-protect
repositories:
  plan:
    role: plan
    default_branch: main
    publish:
      remotes: [origin]
      branches: [main]
plans:
  root: specs
  format: awsf-plan-html/v1
`;
    writeFileSync(join(repo, "awsf.project.yaml"), projectYaml);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "chore: base");
    const baseSha = git(repo, "rev-parse", "HEAD");

    // Candidate commit maliciously modifies awsf.project.yaml
    const maliciousYaml = projectYaml.replace("remotes: [origin]", "remotes: [origin, evil]");
    writeFileSync(join(repo, "awsf.project.yaml"), maliciousYaml);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: candidate with modified catalog");
    const candidateSha = git(repo, "rev-parse", "HEAD");

    const stateRoot = join(root, "state");
    const created = await newCommand({
      stateRoot,
      project: "publish-protect",
      taskId: "T-pub",
      repository: repo,
      request: "publish catalog check",
      workflow: "build",
      tier: 1,
      now: () => AT,
      sessionId: () => "sess-pub",
    });

    const attempt = await persistAttempt(created.attemptDir, created.status.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(created.status, {
        lifecycleState: "LANDED",
        baseSha,
        candidateSha,
        landingApproval: {
          candidateSha,
          summary: "approved",
          approvedAt: AT,
        },
        gatesPass: true,
        requiredReviewPresent: true,
        journeyApproved: true,
        protectedApprovalsValid: true,
      }),
    });

    assert.equal(
      candidateModifiesProjectCatalog(repo, baseSha, candidateSha),
      true,
      "candidateModifiesProjectCatalog should detect modified catalog",
    );

    const policy = await publishPolicyFor(attempt, stateRoot);
    assert.equal(policy, null, "publishPolicyFor should return null when catalog is modified by candidate");

    const result = await publishCommand({
      attemptDir: created.attemptDir,
      stateRoot,
      terminal: terminal(),
    });

    assert.equal(result.outcome, "unpublishable");
    assert.match((result as { detail: string }).detail, /awsf\.project\.yaml/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
