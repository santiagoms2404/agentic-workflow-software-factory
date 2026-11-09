// B1-08, B1-09: the publish host check must read every push URL git will write
// to, after git's own insteadOf/pushInsteadOf rewriting, and must refuse a URL
// whose host two parsers read differently. The fixture is a tmpdir repository
// with no inherited Git configuration. `ls-remote` is answered in-process so no
// test touches the network.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GitResult, GitRunner } from "../../../src/git/changes.ts";
import { PublishBlocked, observePublishTarget } from "../../../src/git/publish.ts";
import { authorizePublish, type PublishAuthorization } from "../../../src/publish/authorize.ts";
import { parseRefspec } from "../../../src/publish/refspec.ts";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const ALLOWED_HOST = ["allowed", "example"].join(".");
const OTHER_HOST = ["other", "example"].join(".");
const BRANCH = "main";

interface Fixture {
  readonly work: string;
  readonly headSha: string;
  readonly runner: GitRunner;
  readonly git: (...argv: string[]) => string;
  readonly dispose: () => void;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "awsf-push-urls-"));
  const work = join(root, "work");
  execFileSync("git", ["init", "-q", "-b", BRANCH, work], { env: GIT_ENV });
  const git = (...argv: string[]): string =>
    execFileSync("git", ["-C", work, ...argv], { encoding: "utf8", env: GIT_ENV }).trim();
  writeFileSync(join(work, "note.txt"), "candidate\n");
  git("add", "note.txt");
  git("-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", "test: push url candidate");
  const headSha = git("rev-parse", "HEAD");

  const runner: GitRunner = (argv): GitResult => {
    // An absent destination branch is empty output at exit 0. Answering here
    // keeps the observation offline; every other argv reaches real Git.
    if (argv[0] === "ls-remote") return { status: 0, stdout: "", stderr: "", error: null };
    const result = spawnSync("git", ["-C", work, ...argv], { encoding: "utf8", env: GIT_ENV });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message ?? null,
    };
  };

  return { work, headSha, runner, git, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function authorize(target: Fixture): PublishAuthorization {
  const observed = observePublishTarget(target.work, "origin", BRANCH, target.runner);
  return authorizePublish(
    { lifecycleState: "LANDED", candidateSha: target.headSha, landingApproval: { candidateSha: target.headSha } },
    { ...observed.repository, allow: { remotes: ["origin"], branches: [BRANCH], host: ALLOWED_HOST } },
    observed.remote,
    parseRefspec(`${target.headSha}:refs/heads/${BRANCH}`),
  );
}

function refusedCode(result: PublishAuthorization): string {
  return result.decision === "refused" ? result.code : result.decision;
}

function assertAmbiguous(target: Fixture, hidden: string): void {
  assert.throws(
    () => observePublishTarget(target.work, "origin", BRANCH, target.runner),
    (error: unknown) =>
      error instanceof PublishBlocked
      && error.code === "remote-ambiguous"
      && !error.message.includes(hidden),
  );
}

test("B1-09: a second push URL on a host the allowlist refuses is refused", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${OTHER_HOST}/owner/repo.git`);

    assert.equal(refusedCode(authorize(target)), "remote-host-mismatch");
  } finally {
    target.dispose();
  }
});

test("B1-09: every push URL on the allowlisted host is still authorized", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `ssh://git@${ALLOWED_HOST}/owner/mirror.git`);

    assert.equal(refusedCode(authorize(target)), "authorized");
  } finally {
    target.dispose();
  }
});

test("B1-08: a push URL containing a backslash is refused before authorization", () => {
  const target = fixture();
  try {
    // WHATWG reads the host before the backslash; git's transport contacts the one after it.
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}\\@${OTHER_HOST}/owner/repo.git`);

    assertAmbiguous(target, OTHER_HOST);
  } finally {
    target.dispose();
  }
});

test("B1-08: a push URL whose strict and WHATWG hosts disagree is refused", () => {
  const target = fixture();
  try {
    // WHATWG percent-decodes the host to the allowlisted name; the literal authority is not that name.
    target.git("remote", "add", "origin", `https://%61${ALLOWED_HOST.slice(1)}/owner/repo.git`);

    assertAmbiguous(target, "%61");
  } finally {
    target.dispose();
  }
});

test("B1-08: a disagreeing second push URL is refused even when the first is clean", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${ALLOWED_HOST}\\@${OTHER_HOST}/owner/repo.git`);

    assertAmbiguous(target, OTHER_HOST);
  } finally {
    target.dispose();
  }
});

test("pushInsteadOf rewriting away from the allowlisted host is applied and refused", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", `url.https://${OTHER_HOST}/.pushInsteadOf`, `https://${ALLOWED_HOST}/`);

    assert.equal(refusedCode(authorize(target)), "remote-host-mismatch");
  } finally {
    target.dispose();
  }
});

test("pushInsteadOf rewriting onto the allowlisted host is applied and authorized", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${OTHER_HOST}/owner/repo.git`);
    target.git("config", `url.https://${ALLOWED_HOST}/.pushInsteadOf`, `https://${OTHER_HOST}/`);

    assert.equal(refusedCode(authorize(target)), "authorized");
  } finally {
    target.dispose();
  }
});

test("insteadOf rewriting of an explicit push URL is applied and refused", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", "--add", "remote.origin.pushurl", `https://${ALLOWED_HOST}/owner/repo.git`);
    target.git("config", `url.https://${OTHER_HOST}/.insteadOf`, `https://${ALLOWED_HOST}/`);

    assert.equal(refusedCode(authorize(target)), "remote-host-mismatch");
  } finally {
    target.dispose();
  }
});

test("B1-08: an scp-style push URL without a user resolves to its host", () => {
  const target = fixture();
  try {
    target.git("remote", "add", "origin", `${ALLOWED_HOST}:owner/repo.git`);

    assert.equal(refusedCode(authorize(target)), "authorized");
  } finally {
    target.dispose();
  }
});
