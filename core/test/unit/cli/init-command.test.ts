import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initCommand, InitTargetNotEmptyError } from "../../../src/cli/commands/init.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { HOST_AUTHOR } from "../../../src/git/commit.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

test("initCommand creates a clean one-commit AWSF repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-init-command-"));
  const target = join(root, "fresh-project");
  try {
    const result = await initCommand({ path: target, slug: "fresh-project" });

    assert.equal(result.path, target);
    assert.match(result.commitSha, /^[0-9a-f]{40}$/);
    assert.equal(result.schema, "awsf.init-output/v1");
    assert.equal(result.kind, "host command result printed to stdout");
    assert.equal(result.line, `Initialized ${target} at ${result.commitSha}.`);
    assert.equal(parseEnvelope(JSON.stringify(result), result.schema).valid, true);
    assert.ok(existsSync(join(target, ".git")));
    assert.equal(loadConfig(readFileSync(join(target, "awsf.config.yaml"), "utf8")).project.slug, "fresh-project");
    assert.equal(git(target, "rev-list", "--count", "HEAD"), "1");
    const logIdentity = HOST_AUTHOR.replace(" <", "<");
    assert.equal(git(target, "log", "-1", "--format=%an<%ae>%cn<%ce>"), `${logIdentity}${logIdentity}`);
    assert.equal(git(target, "status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("initCommand refuses a non-empty target before initializing Git", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-init-command-refusal-"));
  const target = join(root, "occupied-project");
  const unrelatedFile = join(target, "unrelated.txt");
  try {
    mkdirSync(target);
    writeFileSync(unrelatedFile, "leave me alone\n");

    await assert.rejects(
      initCommand({ path: target, slug: "occupied-project" }),
      InitTargetNotEmptyError,
    );

    assert.equal(readFileSync(unrelatedFile, "utf8"), "leave me alone\n");
    assert.ok(!existsSync(join(target, ".git")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("initCommand refuses to initialize an existing repository again", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-init-command-rerun-"));
  const target = join(root, "initialized-project");
  try {
    await initCommand({ path: target, slug: "initialized-project" });

    await assert.rejects(
      initCommand({ path: target, slug: "initialized-project" }),
      InitTargetNotEmptyError,
    );

    assert.ok(existsSync(join(target, ".git")));
    assert.equal(git(target, "rev-list", "--count", "HEAD"), "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
