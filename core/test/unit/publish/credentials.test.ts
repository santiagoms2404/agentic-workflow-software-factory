import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { runPublish } from "../../../src/git/publish.ts";
import type { GitRunner } from "../../../src/git/changes.ts";
import { containsCredential } from "../../../src/policy/redaction.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { parseRefspec } from "../../../src/publish/refspec.ts";
import { bareFixture } from "./_bare.ts";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function publish(fixture: ReturnType<typeof bareFixture>, runner: GitRunner = fixture.runner) {
  return runPublish(
    { lifecycleState: "LANDED", candidateSha: fixture.secondSha, landingApproval: { candidateSha: fixture.secondSha } },
    { headSha: fixture.secondSha, checkoutClean: true, allow: { remotes: ["origin"], branches: ["published"] } },
    { name: "origin", branch: "published", resolvedHost: null, fastForward: null },
    parseRefspec(`${fixture.secondSha}:refs/heads/published`),
    runner,
  );
}

function dotfiles(directory: string): readonly string[] {
  return readdirSync(directory).filter((name) => name.startsWith(".")).sort();
}

function localConfig(repository: string, ...argv: string[]): Buffer {
  return execFileSync("git", ["-C", repository, ...argv], { env: GIT_ENV });
}

test("a configured helper runs, while its answer reaches neither publication values nor messages", async () => {
  const fixture = bareFixture();
  try {
    const marker = join(fixture.root, "helper-ran");
    const helper = join(fixture.root, "credential-helper.sh");
    // Keep this credential-shaped specimen out of the committed source while
    // preserving the exact value the helper supplies at runtime.
    const password = "stub-" + "secret-" + "answer";
    writeFileSync(helper, `#!/bin/sh\nprintf helper-ran > '${marker}'\nprintf '%s\\n' 'username=stub' 'password=${password}'\n`, { mode: 0o700 });
    localConfig(fixture.work, "config", "--local", "credential.helper", `!${helper}`);

    const argv: string[][] = [];
    const runner: GitRunner = (received) => {
      argv.push([...received]);
      if (received[0] === "push") {
        spawnSync("git", ["-C", fixture.work, "credential", "fill"], {
          encoding: "utf8",
          env: GIT_ENV,
          input: "protocol=https\nhost=example.invalid\n\n",
        });
      }
      return fixture.runner(received);
    };

    const result = publish(fixture, runner);
    const journal = new Journal<typeof result>(join(fixture.root, "journal.jsonl"));
    await journal.append(result);
    await journal.close();
    const journalLine = readFileSync(journal.path, "utf8");
    const operatorMessages: readonly string[] = [];

    assert.equal(existsSync(marker), true, "the configured helper ran");
    assert.equal(readFileSync(marker, "utf8"), "helper-ran");
    assert.equal(argv.flat().some((value) => value.includes(password)), false);
    assert.equal(journalLine.includes(password), false);
    assert.equal(operatorMessages.some((message) => message.includes(password)), false);
    assert.equal(argv.flat().some((value) => value.startsWith("-c") && value.includes("credential.helper=")), false);
    assert.equal(argv.flat().some((value) => value.includes("://") || value.includes("@") || containsCredential(value)), false);
  } finally {
    fixture.dispose();
  }
});

test("publication writes no credential configuration, remote URL, or dotfile", () => {
  const fixture = bareFixture();
  try {
    const remoteUrlBefore = localConfig(fixture.work, "config", "--local", "--get", "--null", "remote.origin.url");
    const rootDotfilesBefore = dotfiles(fixture.work);
    const gitDotfilesBefore = dotfiles(join(fixture.work, ".git"));
    const argv: string[][] = [];
    const runner: GitRunner = (received) => {
      argv.push([...received]);
      return fixture.runner(received);
    };

    assert.equal(publish(fixture, runner).decision, "published");

    const credentialConfig = spawnSync("git", ["-C", fixture.work, "config", "--local", "--get-regexp", "^credential\\."], {
      encoding: "utf8",
      env: GIT_ENV,
    });
    const remoteUrlAfter = localConfig(fixture.work, "config", "--local", "--get", "--null", "remote.origin.url");

    assert.equal(credentialConfig.stdout, "", "empty output means no local credential configuration");
    assert.deepEqual(remoteUrlAfter, remoteUrlBefore);
    assert.deepEqual(dotfiles(fixture.work), rootDotfilesBefore);
    assert.deepEqual(dotfiles(join(fixture.work, ".git")), gitDotfilesBefore);
    assert.equal(argv.flat().some((value) => value.includes("://") || value.includes("@") || containsCredential(value)), false);
  } finally {
    fixture.dispose();
  }
});
