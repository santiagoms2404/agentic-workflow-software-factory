import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import {
  PreviewBundleMissing, PreviewBundleStale, PreviewRefused, previewCommand, readPreviewRecord, type PreviewCommandRunner,
} from "../../src/cli/commands/preview.ts";
import { PreviewPostureUndeclared, planPreview } from "../../src/contracts/preview-record.ts";
import type { CommandResult } from "../../src/execution/process-controller.ts";

// W17 M5 task 15. The preview's form is derived from the repository's declared
// delivery posture and the candidate's own diff, and the `service` form builds
// the candidate fresh or refuses. The build is injected so the test can make
// the bundle stale on purpose; everything else is a real Git repository and a
// real attempt at the owner gate.

const AT = "2026-09-25T06:00:00.000Z";
const BUILT_AT = "2026-09-25T06:01:02.345Z";
const SERVICE = { build: { argv: ["node", "build.js"], timeout_seconds: 60 }, bundle: "dist", sources: ["web"] };

test("each delivery posture selects its own preview form, and mobile is named and not built", () => {
  const changed = ["web/app.js", "core/lib.ts"];
  assert.equal(planPreview("app", "service", SERVICE, changed).form, "serve");
  const mobile = planPreview("app", "mobile", undefined, changed);
  assert.equal(mobile.form, "named-not-built");
  assert.equal(mobile.visual, true);
  assert.match(mobile.reason, /an emulator is not a browser/u);
  assert.equal(planPreview("app", "docs", undefined, changed).form, "diff-readout");
  assert.equal(planPreview("app", "none", undefined, changed).form, "diff-readout");
  assert.throws(() => planPreview("app", undefined, SERVICE, changed), PreviewPostureUndeclared);
});

test("visual review is derived from the candidate's own diff against the posture, never from a flag", () => {
  const core = planPreview("app", "service", SERVICE, ["core/lib.ts", "webby/x.ts"]);
  assert.deepEqual([core.form, core.visual, core.visualPaths], ["diff-readout", false, []]);
  const web = planPreview("app", "service", SERVICE, ["core/lib.ts", "web/app.js", "web"]);
  assert.deepEqual([web.form, web.visual, web.visualPaths], ["serve", true, ["web/app.js", "web"]]);
  // With no declared sources every change counts: an undeclared project is shown, not skipped.
  assert.deepEqual(planPreview("app", "service", { build: SERVICE.build, bundle: "dist" }, ["core/lib.ts"]).visualPaths, ["core/lib.ts"]);
  const mobileCore = planPreview("app", "mobile", { sources: ["ios"] }, ["core/lib.ts"]);
  assert.deepEqual([mobileCore.form, mobileCore.visual], ["diff-readout", false]);
  // docs and none are read, never rendered, whatever the diff touches.
  assert.equal(planPreview("app", "docs", SERVICE, ["web/app.js"]).visual, false);
});

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function commitAll(repository: string, message: string): string {
  git(repository, "add", "-A");
  execFileSync("git", ["-C", repository, "-c", "user.name=AWSF Test", "-c", "user.email=awsf-test@example.com",
    "commit", "-m", message], { stdio: "ignore" });
  return git(repository, "rev-parse", "HEAD");
}

function catalog(delivery: string | null): string {
  return [
    "version: awsf.project/v1", "project:", "  slug: preview-test", "repositories:", "  app:", "    role: plan",
    "    default_branch: main",
    ...(delivery === null ? [] : [`    delivery: ${delivery}`]),
    "    preview:", "      build: { argv: [node, build.js], timeout_seconds: 60 }", "      bundle: dist", "      sources: [web]",
    "plans:", "  root: specs", "  format: awsf-plan-html/v1", "",
  ].join("\n");
}

async function atOwnerGate(delivery: string | null, taskId = "preview"): Promise<{ root: string; stateRoot: string; attemptDir: string; worktree: string; candidateSha: string }> {
  const root = mkdtempSync(join(tmpdir(), "awsf-preview-"));
  const worktree = join(root, "repository");
  execFileSync("git", ["init", "-b", "main", worktree], { stdio: "ignore" });
  writeFileSync(join(worktree, "awsf.project.yaml"), catalog(delivery));
  writeFileSync(join(worktree, ".gitignore"), "dist/\n");
  mkdirSync(join(worktree, "web"));
  writeFileSync(join(worktree, "web", "app.js"), "export const v = 1;\n");
  const baseSha = commitAll(worktree, "base");
  writeFileSync(join(worktree, "web", "app.js"), "export const v = 2;\n");
  const candidateSha = commitAll(worktree, "candidate");
  const stateRoot = join(root, "state");
  const created = await newCommand({
    stateRoot, project: "preview-test", taskId, repository: worktree, request: "preview the candidate",
    workflow: "build-review", tier: 2, sessionId: () => `session-${taskId}`, now: () => AT,
  });
  await persistAttempt(created.attemptDir, created.status.revision, {
    kind: "attempt.updated",
    next: nextRevision(created.status, { lifecycleState: "AWAITING_OWNER", worktree, baseSha, candidateSha }),
  });
  return { root, stateRoot, attemptDir: created.attemptDir, worktree, candidateSha };
}

/** A build that writes the named files into the bundle, or nothing at all. */
function builder(files: readonly string[], calls: { count: number }): PreviewCommandRunner {
  return (_executable, _argv, options): CommandResult => {
    calls.count += 1;
    for (const file of files) {
      mkdirSync(join(options.cwd!, "dist"), { recursive: true });
      writeFileSync(join(options.cwd!, "dist", file), `<!-- ${file} built -->\n`);
    }
    return { status: 0, stdout: "", stderr: "", error: null };
  };
}

function staleBundle(worktree: string, files: readonly string[]): void {
  mkdirSync(join(worktree, "dist"), { recursive: true });
  const old = new Date("2020-01-01T00:00:00.000Z");
  for (const file of files) {
    writeFileSync(join(worktree, "dist", file), "<!-- an old build -->\n");
    utimesSync(join(worktree, "dist", file), old, old);
  }
}

test("a stale bundle makes the preview refuse, and the refusal names staleness rather than a missing file", async () => {
  const fixture = await atOwnerGate("service");
  staleBundle(fixture.worktree, ["index.html", "app.js"]);
  const calls = { count: 0 };
  // The build runs and exits 0, but writes nothing: the bundle on disk is the old one.
  await assert.rejects(
    previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT, runCommand: builder([], calls) }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewBundleStale, String(error));
      assert.match(error.message, /is stale/u);
      assert.doesNotMatch(error.message, /missing|no file|ENOENT/iu);
      assert.deepEqual(error.staleFiles, ["app.js", "index.html"]);
      return true;
    },
  );
  assert.equal(calls.count, 1, "the step built before judging the bundle");
  assert.equal(await readPreviewRecord(fixture.attemptDir), null, "a refused preview records nothing as built");
  const lease = JSON.parse(readFileSync(join(fixture.stateRoot, "preview-server.json"), "utf8")) as { state: string };
  assert.equal(lease.state, "released");
});

test("a build that rewrites only part of an old bundle is refused, naming the file it left behind", async () => {
  const fixture = await atOwnerGate("service");
  staleBundle(fixture.worktree, ["index.html", "old-chunk.js"]);
  await assert.rejects(
    previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT,
      runCommand: builder(["index.html"], { count: 0 }) }),
    (error: unknown) => error instanceof PreviewBundleStale && error.staleFiles.join() === "old-chunk.js",
  );
});

test("a build that writes nothing where there was nothing is a missing bundle, a different refusal", async () => {
  const fixture = await atOwnerGate("service");
  await assert.rejects(
    previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT,
      runCommand: builder([], { count: 0 }) }),
    (error: unknown) => error instanceof PreviewBundleMissing && !/stale/u.test(error.message),
  );
});

test("service builds fresh, records what and when, serves only what it built, and keeps exactly one server", async () => {
  const fixture = await atOwnerGate("service");
  staleBundle(fixture.worktree, ["index.html"]);
  const lines: string[] = [];
  const calls = { count: 0 };
  const first = await previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: (line) => lines.push(line),
    now: () => BUILT_AT, runCommand: builder(["index.html", "app.js"], calls) });
  try {
    assert.equal(first.record.form, "serve");
    assert.equal(first.record.candidateSha, fixture.candidateSha);
    assert.equal(first.record.recordedAt, BUILT_AT);
    assert.deepEqual(first.record.build, { argv: ["node", "build.js"], bundle: "dist", files: 2 });
    assert.deepEqual(first.record.visualPaths, ["web/app.js"]);
    assert.deepEqual(await readPreviewRecord(fixture.attemptDir), first.record);
    const url = first.record.server!.url;
    assert.ok(lines.includes(`Preview serving at ${url} — the only preview server; stop it with Ctrl-C.`), lines.join("\n"));
    assert.ok(lines.some((line) => line.includes("web/app.js")), "the diff readout is printed");
    const index = await fetch(url);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), "<!-- index.html built -->\n");
    assert.equal((await fetch(`${url}not-built.js`)).status, 404);
    assert.equal((await fetch(`${url}%E0%A4%A`)).status, 404, "a malformed path is a 404");
    assert.equal((await fetch(`${url}app.js`)).status, 200, "and the server is still up");

    // A second preview, of any attempt, is refused while this one is alive, and builds nothing.
    const other = await atOwnerGate("service", "other");
    const second = { count: 0 };
    await assert.rejects(
      previewCommand({ attemptDir: other.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT,
        runCommand: builder(["index.html"], second) }),
      (error: unknown) => error instanceof PreviewRefused && error.message.includes("already alive") && error.message.includes(url),
    );
    assert.equal(second.count, 0);
  } finally {
    await first.close();
  }
  assert.equal((await readPreviewRecord(fixture.attemptDir))?.server, null, "a closed server is no longer recorded as where the preview is");
  // Once closed, a preview may start again, and it too must rewrite every file it serves.
  const again = await previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT,
    runCommand: builder(["index.html", "app.js"], calls) });
  await again.close();
  assert.equal(calls.count, 2);
});

test("mobile names the preview and builds nothing; docs and none print the diff readout alone", async () => {
  for (const [delivery, form] of [["mobile", "named-not-built"], ["docs", "diff-readout"], ["none", "diff-readout"]] as const) {
    const fixture = await atOwnerGate(delivery);
    const calls = { count: 0 };
    const lines: string[] = [];
    const result = await previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: (line) => lines.push(line),
      now: () => BUILT_AT, runCommand: builder(["index.html"], calls) });
    assert.equal(result.record.form, form, delivery);
    assert.equal(result.server, null);
    assert.equal(result.record.build, null);
    assert.equal(result.record.recordedAt, BUILT_AT);
    assert.equal(calls.count, 0, `${delivery} runs no build`);
    assert.equal(existsSync(join(fixture.worktree, "dist")), false);
    assert.ok(lines.some((line) => line.includes("web/app.js")), `${delivery} prints the diff readout`);
  }
});

test("an undeclared posture is refused by name rather than guessed, and nothing is built", async () => {
  const fixture = await atOwnerGate(null);
  const calls = { count: 0 };
  await assert.rejects(
    previewCommand({ attemptDir: fixture.attemptDir, stateRoot: fixture.stateRoot, write: () => {}, now: () => BUILT_AT,
      runCommand: builder(["index.html"], calls) }),
    PreviewPostureUndeclared,
  );
  assert.equal(calls.count, 0);
});
