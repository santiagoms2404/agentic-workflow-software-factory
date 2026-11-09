import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { GitRunner } from "../../../src/git/changes.ts";
import { observePublishTarget, runPublish } from "../../../src/git/publish.ts";
import { parseRefspec } from "../../../src/publish/refspec.ts";
import { bareFixture, remoteSha } from "../publish/_bare.ts";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const BRANCH = "published";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8", env: GIT_ENV }).trim();
}

function unrelatedCommit(root: string): { readonly work: string; readonly sha: string } {
  const work = join(root, "unrelated-work");
  execFileSync("git", ["init", "-q", "-b", "main", work], { env: GIT_ENV });
  writeFileSync(join(work, "unrelated.txt"), "unrelated\n");
  git(work, "add", "unrelated.txt");
  git(work, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", "test: unrelated push tip");
  return { work, sha: git(work, "rev-parse", "HEAD") };
}

function configureSplitRemotes(
  fixture: ReturnType<typeof bareFixture>,
  fetchTip: string,
  pushTip: string,
  fetchSource: string,
  pushSource: string,
): { readonly fetch: string; readonly push: string } {
  const fetch = join(fixture.root, "fetch.git");
  const push = join(fixture.root, "push.git");
  execFileSync("git", ["init", "--bare", "-q", fetch], { env: GIT_ENV });
  execFileSync("git", ["init", "--bare", "-q", push], { env: GIT_ENV });
  git(fetchSource, "push", fetch, `${fetchTip}:refs/heads/${BRANCH}`);
  git(pushSource, "push", push, `${pushTip}:refs/heads/${BRANCH}`);
  git(fixture.work, "remote", "set-url", "origin", fetch);
  git(fixture.work, "config", "remote.origin.pushurl", push);
  return { fetch, push };
}

function publish(fixture: ReturnType<typeof bareFixture>, runner: GitRunner = fixture.runner) {
  const observed = observePublishTarget(fixture.work, "origin", BRANCH, runner);
  const sha = fixture.secondSha;
  const result = runPublish(
    { lifecycleState: "LANDED", candidateSha: sha, landingApproval: { candidateSha: sha } },
    { ...observed.repository, allow: { remotes: ["origin"], branches: [BRANCH] } },
    observed.remote,
    parseRefspec(`${sha}:refs/heads/${BRANCH}`),
    runner,
  );
  return { observed, result };
}

test("B1-21 refuses before push when the push tip is unrelated but the fetch tip is an ancestor", () => {
  const fixture = bareFixture();
  try {
    const unrelated = unrelatedCommit(fixture.root);
    const pushTip = unrelated.sha;
    git(fixture.work, "fetch", unrelated.work, pushTip);
    const remotes = configureSplitRemotes(fixture, fixture.firstSha, pushTip, fixture.work, unrelated.work);
    const pushes: string[][] = [];
    const runner: GitRunner = (argv) => {
      if (argv[0] === "push") pushes.push([...argv]);
      return fixture.runner(argv);
    };

    const observed = observePublishTarget(fixture.work, "origin", BRANCH, runner);
    assert.equal(observed.remotePriorSha, pushTip, "the observed prior tip belongs to the push destination");
    assert.equal(observed.remote.fastForward, false, "the push destination is not a fast-forward target");

    const sha = fixture.secondSha;
    const result = runPublish(
      { lifecycleState: "LANDED", candidateSha: sha, landingApproval: { candidateSha: sha } },
      { ...observed.repository, allow: { remotes: ["origin"], branches: [BRANCH] } },
      observed.remote,
      parseRefspec(`${sha}:refs/heads/${BRANCH}`),
      runner,
    );
    assert.deepEqual(result, {
      decision: "refused",
      code: "non-fast-forward",
      detail: "The publication would not be a fast-forward update.",
    });
    assert.deepEqual(pushes, [], "refusal happens before a push invocation");
    assert.equal(remoteSha({ ...fixture, bare: remotes.push }, BRANCH), pushTip);
  } finally {
    fixture.dispose();
  }
});

test("B1-21 permits the mirror case when the push tip is an ancestor despite an unrelated fetch tip", () => {
  const fixture = bareFixture();
  try {
    const unrelated = unrelatedCommit(fixture.root);
    const fetchTip = unrelated.sha;
    git(fixture.work, "fetch", unrelated.work, fetchTip);
    const remotes = configureSplitRemotes(fixture, fetchTip, fixture.firstSha, unrelated.work, fixture.work);
    const { observed, result } = publish(fixture);

    assert.equal(observed.remotePriorSha, fixture.firstSha, "the observed prior tip belongs to the push destination");
    assert.equal(observed.remote.fastForward, true);
    assert.deepEqual(result, { decision: "published", outcomes: ["fast-forwarded"] });
    assert.equal(remoteSha({ ...fixture, bare: remotes.push }, BRANCH), fixture.secondSha);
  } finally {
    fixture.dispose();
  }
});
