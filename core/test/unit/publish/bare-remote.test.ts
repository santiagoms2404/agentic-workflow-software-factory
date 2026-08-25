import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { PublishBlocked, observePublishTarget, runPublish } from "../../../src/git/publish.ts";
import { parseRefspec } from "../../../src/publish/refspec.ts";
import type { GitRunner } from "../../../src/git/changes.ts";
import { bareFixture, remoteSha } from "./_bare.ts";

function checkout(repository: string, sha: string): void {
  execFileSync("git", ["-C", repository, "checkout", "--detach", sha], { stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
}

function publish(fixture: ReturnType<typeof bareFixture>, sha: string, runner: GitRunner = fixture.runner) {
  const observed = observePublishTarget(fixture.work, "origin", "published", runner);
  return runPublish(
    { lifecycleState: "LANDED", candidateSha: sha, landingApproval: { candidateSha: sha } },
    { ...observed.repository, allow: { remotes: ["origin"], branches: ["published"] } },
    observed.remote,
    parseRefspec(`${sha}:refs/heads/published`),
    runner,
  );
}

test("an exact landed revision creates an absent bare-remote branch", () => {
  const fixture = bareFixture();
  try {
    checkout(fixture.work, fixture.firstSha);
    const result = publish(fixture, fixture.firstSha);
    assert.deepEqual(result, { decision: "published", outcomes: ["created"] });
    assert.equal(remoteSha(fixture, "published"), fixture.firstSha);
  } finally {
    fixture.dispose();
  }
});

test("a fast-forward preserves the literal-space porcelain flag and old..new summary", () => {
  const fixture = bareFixture();
  try {
    checkout(fixture.work, fixture.firstSha);
    publish(fixture, fixture.firstSha);
    checkout(fixture.work, fixture.secondSha);

    let pushStdout = "";
    const runner: GitRunner = (argv) => {
      const result = fixture.runner(argv);
      if (argv[0] === "push") pushStdout = result.stdout;
      return result;
    };
    const result = publish(fixture, fixture.secondSha, runner);

    const refLine = pushStdout.split(/\r?\n/u).find((line) => line.startsWith(" "));
    assert.ok(refLine, "Git emitted a literal-space fast-forward porcelain line");
    assert.match(refLine, /\t[0-9a-f]+\.\.[0-9a-f]+$/u, "the last field is old..new");
    assert.deepEqual(result, { decision: "published", outcomes: ["fast-forwarded"] }, "the untrimmed line maps its space flag");
    assert.equal(remoteSha(fixture, "published"), fixture.secondSha);
  } finally {
    fixture.dispose();
  }
});

test("the table refuses a non-fast-forward before a push invocation", () => {
  const fixture = bareFixture();
  try {
    const initial = publish(fixture, fixture.secondSha);
    assert.equal(initial.decision, "published");
    checkout(fixture.work, fixture.firstSha);

    const invocations: string[][] = [];
    const runner: GitRunner = (argv) => {
      invocations.push([...argv]);
      return fixture.runner(argv);
    };
    const result = publish(fixture, fixture.firstSha, runner);

    assert.equal(result.decision, "refused");
    if (result.decision === "refused") assert.equal(result.code, "non-fast-forward");
    assert.equal(remoteSha(fixture, "published"), fixture.secondSha);
    assert.equal(invocations.some((argv) => argv[0] === "push"), false);
  } finally {
    fixture.dispose();
  }
});

test("observation reports closed remote failures without leaking a local path or Git prose", () => {
  const fixture = bareFixture();
  try {
    assert.throws(
      () => observePublishTarget(fixture.work, "absent", "published", fixture.runner),
      (error: unknown) => error instanceof PublishBlocked && error.code === "remote-unknown" && !error.message.includes(fixture.root) && !/No such remote/u.test(error.message),
    );

    const missing = `${fixture.root}/missing.git`;
    execFileSync("git", ["-C", fixture.work, "remote", "add", "broken", missing], { stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    assert.throws(
      () => observePublishTarget(fixture.work, "broken", "published", fixture.runner),
      (error: unknown) => error instanceof PublishBlocked && error.code === "remote-unreadable" && !error.message.includes(missing) && !/does not appear to be a git repository/u.test(error.message),
    );
  } finally {
    fixture.dispose();
  }
});
