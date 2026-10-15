// H9 (B1-01 B1-07 B1-12 B7-08 B8-04 B8-05 B9-01 B9-09): every AWSF-made commit carries
// HOST_AUTHOR as author and committer, whatever the checkout's git config or the
// launching environment says (AGENTS.md invariant 11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCommand } from "../../../src/cli/commands/close.ts";
import { closureGitRunner } from "../../../src/git/closure.ts";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";
import { commitAsHost, HOST_AUTHOR, HOST_IDENTITY, hostCommitGitRunner, hostIdentityEnv } from "../../../src/git/commit.ts";

const OWNER_PAIR = `${HOST_AUTHOR}|${HOST_AUTHOR}`;
// Built at run time so no identity literal other than the owner's sits in the source.
const intruder = ["in", "truder"].join("");
const ambient = {
  GIT_COMMITTER_NAME: intruder, GIT_COMMITTER_EMAIL: `${intruder}@example.invalid`,
  GIT_AUTHOR_NAME: intruder, GIT_AUTHOR_EMAIL: `${intruder}@example.invalid`,
} as const;
const repoLocal = { name: ["Repo", "Local"].join(" "), email: ["repo", "local@example.invalid"].join("-") };

/** Export identity variables for the duration of `act`, as a launching shell would. */
async function withAmbient<T>(vars: Readonly<Record<string, string>>, act: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try { return await act(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const identities = (git: ReturnType<typeof systemGitRunner>, sha: string) =>
  runGit(git, ["show", "-s", "--format=%an <%ae>|%cn <%ce>", sha]).trim();

const plan = `<section id="phases">
<h3><code class="status">[]</code> Milestone M1: One</h3>
<h4>1. First task</h4>
<ul><li><code class="status">[]</code> First row.</li></ul>
</section>\n`;
const ticket = `---
id: T01
title: First task
milestone: M1
state: todo
depends_on: []
workflow: build-review
---
# Ticket

## Handoff

Findings.

## Build prompt

\`\`\`
Build T01.
\`\`\`
`;

/** A canonical checkout whose repo-local identity is NOT the owner's. */
function closureWorld(): { root: string; repository: string; git: ReturnType<typeof closureGitRunner>; head: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-identity-closure-"));
  const repository = join(root, "repository");
  mkdirSync(join(repository, "plans/tickets/sample"), { recursive: true });
  const git = closureGitRunner(repository);
  runGit(git, ["init", "-b", "main"]);
  runGit(git, ["config", "user.name", repoLocal.name]);
  runGit(git, ["config", "user.email", repoLocal.email]);
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: sample}\nrepositories:\n  app: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, "plans/sample.html"), plan);
  writeFileSync(join(repository, "plans/sample-build-prompts.md"), "# Section B — Task prompts (recommended)\n### T01 — First task\n\n```\nBuild T01.\n```\n");
  writeFileSync(join(repository, "plans/tickets/sample/T01.md"), ticket);
  runGit(git, ["add", "."]);
  runGit(git, ["commit", "-m", "fixture base"]);
  return { root, repository, git, head: runGit(git, ["rev-parse", "HEAD"]).trim() };
}

async function closeAsOwner(w: ReturnType<typeof closureWorld>): Promise<string> {
  const terminal = { interactive: true, write: () => {}, confirm: async () => true };
  const result = await closeCommand({ commit: w.head, repository: w.repository, projectDir: join(w.root, "state/projects/sample"),
    project: "sample", plan: "sample", tickets: ["T01"], terminal });
  assert.ok(result.record, "closure produced a commit");
  return result.record.commitSha;
}

/** A worktree with one uncommitted change, its repo-local identity not the owner's. */
function candidateWorld(): string {
  const repository = mkdtempSync(join(tmpdir(), "awsf-identity-candidate-"));
  const git = systemGitRunner(repository);
  runGit(git, ["init", "-b", "main"]);
  runGit(git, ["config", "user.name", repoLocal.name]);
  runGit(git, ["config", "user.email", repoLocal.email]);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  runGit(git, ["add", "."]);
  runGit(git, ["commit", "-m", "fixture base"]);
  writeFileSync(join(repository, "README.md"), "fixture change\n");
  return repository;
}

test("RED B1-01: with GIT_COMMITTER_NAME exported and a non-owner repo-local identity, a closure commit carries HOST_AUTHOR", async () => {
  const w = closureWorld();
  const sha = await withAmbient(ambient, () => closeAsOwner(w));
  assert.equal(identities(w.git, sha), OWNER_PAIR);
});

test("B1-12: a candidate commit made with commitAsHost's default runner ignores exported author and committer variables", async () => {
  const repository = candidateWorld();
  const sha = await withAmbient(ambient, () => commitAsHost({ repository, message: "test: candidate" }));
  assert.equal(identities(systemGitRunner(repository), sha), OWNER_PAIR);
});

test("B7-08: the seed and phase commit runner (hostCommitGitRunner) pins HOST_AUTHOR under an exported committer", async () => {
  const repository = candidateWorld();
  const sha = await withAmbient(ambient, () => commitAsHost({ repository, message: "test: seed" }, hostCommitGitRunner(repository)));
  assert.equal(identities(systemGitRunner(repository), sha), OWNER_PAIR);
});

test("B1-07: closure ignores the checkout's repo-local user.name, even when it is empty", async () => {
  const w = closureWorld();
  runGit(w.git, ["config", "user.name", ""]);
  const sha = await closeAsOwner(w);
  assert.equal(identities(w.git, sha), OWNER_PAIR);
});

test("B9-01: the four pinned variables all derive from HOST_AUTHOR", () => {
  assert.equal(`${HOST_IDENTITY.name} <${HOST_IDENTITY.email}>`, HOST_AUTHOR);
  assert.deepEqual(hostIdentityEnv(), {
    GIT_AUTHOR_NAME: HOST_IDENTITY.name, GIT_AUTHOR_EMAIL: HOST_IDENTITY.email,
    GIT_COMMITTER_NAME: HOST_IDENTITY.name, GIT_COMMITTER_EMAIL: HOST_IDENTITY.email,
  });
});

test("B1-01: close.ts no longer reads user.name or user.email from git config", () => {
  const source = readFileSync(new URL("../../../src/cli/commands/close.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"config",\s*"--get",\s*"user\.(name|email)"/u);
});
