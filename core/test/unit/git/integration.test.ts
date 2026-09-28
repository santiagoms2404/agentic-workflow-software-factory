import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";
import {
  IntegrationRefused,
  integrationMessage,
  planIntegration,
  verifyIntegrationCommit,
  writeIntegrationCommit,
} from "../../../src/git/integration.ts";

const AT = "2026-09-27T00:00:00.000Z";
const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];

function git(repository: string, ...argv: string[]): string {
  return runGit(systemGitRunner(repository), argv).trim();
}

function commit(repository: string, path: string, text: string, message: string): string {
  writeFileSync(join(repository, path), text);
  git(repository, "add", path);
  git(repository, ...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

/** base → candidate on one side, base → head on the other; the checkout sits at head. */
function divergence(t: { after(fn: () => void): void }, options: { headPath?: string; headText?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "awsf-integration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  git(root, "init", "--quiet", "-b", "main", repository);
  const base = commit(repository, "README.md", "base\n", "base");
  const candidate = commit(repository, "feature.ts", "export const feature = 1;\n", "feat: candidate");
  git(repository, "checkout", "--quiet", "--detach", base);
  const head = commit(repository, options.headPath ?? "canonical.md", options.headText ?? "canonical advance\n", "docs: advance canonical");
  git(repository, "checkout", "--quiet", "-B", "main", head);
  return { repository, base, candidate, head };
}

function refs(repository: string): string {
  return `${git(repository, "for-each-ref", "--format=%(refname) %(objectname)")}\n${git(repository, "rev-parse", "HEAD")}\n${git(repository, "status", "--porcelain")}`;
}

test("a clean divergence becomes one exact owner merge, canonical HEAD first, with no ref, index or checkout moved", (t) => {
  const world = divergence(t);
  const before = refs(world.repository);
  const plan = planIntegration(world.repository, { sourceBaseSha: world.base, sourceCandidateSha: world.candidate, integrationBaseSha: world.head });
  const hostile = { GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"], GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] };
  process.env["GIT_AUTHOR_NAME"] = "Some Agent";
  process.env["GIT_COMMITTER_EMAIL"] = "agent@example.com";
  let record;
  try {
    record = writeIntegrationCommit(world.repository, plan, AT);
  } finally {
    for (const [key, value] of Object.entries(hostile)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  const merge = record.integratedCandidateSha;
  assert.equal(record.integrationBaseSha, world.head);
  assert.equal(git(world.repository, "rev-parse", `${merge}^1`), world.head);
  assert.equal(git(world.repository, "rev-parse", `${merge}^2`), world.candidate);
  assert.equal(git(world.repository, "rev-parse", `${merge}^{tree}`), plan.treeSha);
  assert.equal(git(world.repository, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%s", merge),
    `Santiago Marin <santiagomarinsuarez@me.com>|Santiago Marin <santiagomarinsuarez@me.com>|${integrationMessage(plan)}`);
  assert.doesNotMatch(integrationMessage(plan), /task|attempt|session/u, "a commit never names live task state");
  assert.equal(git(world.repository, "diff", "--name-only", `${world.head}..${merge}`), "feature.ts");
  assert.equal(refs(world.repository), before);
  assert.equal(writeIntegrationCommit(world.repository, plan, AT).integratedCandidateSha, merge, "the bytes are fixed by the plan and the recorded time");
  verifyIntegrationCommit(world.repository, plan, record);
});

test("a recorded merge that is not the exact host merge is refused", (t) => {
  const world = divergence(t);
  const plan = planIntegration(world.repository, { sourceBaseSha: world.base, sourceCandidateSha: world.candidate, integrationBaseSha: world.head });
  const record = writeIntegrationCommit(world.repository, plan, AT);
  const forge = (...argv: string[]) => git(world.repository, ...OWNER, "commit-tree", "--no-gpg-sign", plan.treeSha, ...argv);
  const swapped = forge("-p", world.candidate, "-p", world.head, "-m", integrationMessage(plan));
  const foreign = git(world.repository, "-c", "user.name=Some Agent", "-c", "user.email=agent@example.com",
    "commit-tree", "--no-gpg-sign", plan.treeSha, "-p", world.head, "-p", world.candidate, "-m", integrationMessage(plan));
  for (const [label, altered] of [
    ["parent order", { ...record, integratedCandidateSha: swapped }],
    ["identity", { ...record, integratedCandidateSha: foreign }],
    ["date", { ...record, committedAt: "2026-09-28T00:00:00.000Z" }],
    ["absent object", { ...record, integratedCandidateSha: "f".repeat(40) }],
    ["integration base", { ...record, integrationBaseSha: world.base }],
  ] as const) {
    assert.throws(() => verifyIntegrationCommit(world.repository, plan, altered), IntegrationRefused, label);
  }
});

test("conflict, unrelated or rewound history, absorbed candidates and empty merges are refused, never resolved", (t) => {
  const conflict = divergence(t, { headPath: "feature.ts", headText: "export const feature = 2;\n" });
  assert.throws(() => planIntegration(conflict.repository, { sourceBaseSha: conflict.base, sourceCandidateSha: conflict.candidate, integrationBaseSha: conflict.head }),
    (error: unknown) => error instanceof IntegrationRefused && /conflicts .* in feature\.ts; no conflict is resolved/u.test(error.message));

  const empty = divergence(t, { headPath: "feature.ts", headText: "export const feature = 1;\n" });
  assert.throws(() => planIntegration(empty.repository, { sourceBaseSha: empty.base, sourceCandidateSha: empty.candidate, integrationBaseSha: empty.head }),
    /changes nothing over canonical HEAD/u);

  const world = divergence(t);
  const plan = (integrationBaseSha: string) => () => planIntegration(world.repository, {
    sourceBaseSha: world.base, sourceCandidateSha: world.candidate, integrationBaseSha,
  });
  assert.throws(plan(world.base), /nothing to integrate/u);
  git(world.repository, "checkout", "--quiet", "--orphan", "unrelated");
  const unrelated = commit(world.repository, "other.md", "unrelated\n", "unrelated root");
  assert.throws(plan(unrelated), /does not descend from the source base/u);
  git(world.repository, "checkout", "--quiet", "--detach", world.base);
  git(world.repository, "merge", "--quiet", "--ff-only", world.candidate);
  const absorbed = commit(world.repository, "later.md", "later\n", "docs: after the candidate landed");
  assert.throws(plan(absorbed), /do not diverge from exactly the source base .*merge bases: [0-9a-f]{40}\)/u);
  assert.throws(plan(world.candidate), /do not diverge from exactly the source base/u);
  assert.throws(plan("HEAD"), /not an exact 40-hex commit/u);
});
