// B7-03 (owner call O6, decision R): every configured gate runs with the
// allowlisted environment.
//
// A gate runs agent-authored candidate code on the host with no sandbox: the
// builder's own tests are what `npm run test:unit` executes. Inheriting the full
// host environment handed that code the Jev credential and every other secret
// the owner's shell holds. Each case below plants credential-NAMED variables in
// the parent environment and asserts the gate sees nothing outside the provider
// allowlist, the gate passthrough, the injected set, and what config declared.
//
// Inv 9: no credential-shaped literal appears in this file. Variable names and
// the one credential-shaped value are built at run time from parts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AdapterError } from "../../../src/adapters/interface.ts";
import { ENV_ALLOWLIST, ENV_INJECTED, GATE_ENV_PASSTHROUGH, gateEnv } from "../../../src/adapters/env.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { SystemCommandOptions } from "../../../src/execution/transport-broker.ts";
import { runBaselineSuite } from "../../../src/preflight/suite.ts";

const JEV_KEY = "OPENROUTER_" + "API_KEY";
const GITHUB_KEY = "GITHUB_" + "TOKEN";
const AWS_KEY = "AWS_SECRET_" + "ACCESS_KEY";

/** A parent environment shaped like the owner's shell: tools, locale, CI, and secrets. */
function ownerShell(): Record<string, string> {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/owner",
    TMPDIR: "/tmp",
    SHELL: "/bin/zsh",
    CI: "true",
    LANG: "en_GB.UTF-8",
    TZ: "Europe/Madrid",
    NODE_OPTIONS: "--require ./owner-profile.cjs",
    [JEV_KEY]: "probe-sentinel-jev",
    [GITHUB_KEY]: "probe-sentinel-github",
    [AWS_KEY]: "probe-sentinel-aws",
  };
}

function permittedKeys(declared: readonly string[] = []): Set<string> {
  return new Set([...ENV_ALLOWLIST, ...GATE_ENV_PASSTHROUGH, ...Object.keys(ENV_INJECTED), ...declared]);
}

test("a gate's env holds nothing outside the allowlist, the gate passthrough and the injected set", () => {
  const env = gateEnv(ownerShell());
  const outside = Object.keys(env).filter((key) => !permittedKeys().has(key)).sort();
  assert.deepEqual(outside, [], "a parent variable outside the allowlist reached the gate");
  assert.equal(env[JEV_KEY], undefined, "the Jev credential reached the gate");
});

test("the gate keeps what it needs to run: PATH, HOME, TMPDIR, CI and the owner's locale", () => {
  const env = gateEnv(ownerShell());
  assert.deepEqual(
    { PATH: env["PATH"], HOME: env["HOME"], TMPDIR: env["TMPDIR"], CI: env["CI"], LANG: env["LANG"] },
    { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/owner", TMPDIR: "/tmp", CI: "true", LANG: "en_GB.UTF-8" },
  );
  // LC_ALL was not set by the parent, so the injected value fills it; TZ is
  // injected and an ambient zone cannot override it.
  assert.equal(env["LC_ALL"], ENV_INJECTED["LC_ALL"]);
  assert.equal(env["TZ"], "UTC");
});

test("a parent LC_ALL passes through to the gate and replaces the injected default", () => {
  const env = gateEnv({ ...ownerShell(), LC_ALL: "es_ES.UTF-8" });
  assert.equal(env["LC_ALL"], "es_ES.UTF-8");
});

test("a CI-less, locale-less parent gives the gate no CI and the injected locale", () => {
  const env = gateEnv({ PATH: "/usr/bin", HOME: "/home/owner" });
  assert.equal(env["CI"], undefined);
  assert.equal(env["LANG"], ENV_INJECTED["LANG"]);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", ...Object.keys(ENV_INJECTED)].sort());
});

test("NODE_OPTIONS reaches the gate only when config declares it, with the declared value", () => {
  const inherited = gateEnv(ownerShell());
  assert.equal(inherited["NODE_OPTIONS"], undefined, "the parent's NODE_OPTIONS can preload code into every gate");
  const declared = gateEnv(ownerShell(), { NODE_OPTIONS: "--max-old-space-size=4096" });
  assert.equal(declared["NODE_OPTIONS"], "--max-old-space-size=4096");
  const outside = Object.keys(declared).filter((key) => !permittedKeys(["NODE_OPTIONS"]).has(key));
  assert.deepEqual(outside, []);
});

test("other secret-looking parent variables never reach the gate", () => {
  const env = gateEnv(ownerShell());
  assert.deepEqual([GITHUB_KEY, AWS_KEY, "SHELL"].filter((key) => key in env), []);
});

test("a passthrough variable holding credential-shaped bytes is refused, not laundered", () => {
  const token = "gh" + "p_" + "A1b2C3d4".repeat(4) + "E5f6";
  assert.throws(
    () => gateEnv({ ...ownerShell(), CI: token }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION" && /"CI"/.test(error.message),
  );
});

test("a declared variable with a credential name is refused rather than handed to the gate", () => {
  assert.throws(
    () => gateEnv(ownerShell(), { [JEV_KEY]: "declared-in-config" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION",
  );
});

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

test("the baseline suite dispatch hands every gate the filtered env, never the inherited one", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-gate-env-"));
  const previous = process.env[JEV_KEY];
  process.env[JEV_KEY] = "probe-sentinel-jev";
  try {
    const repository = join(root, "canonical");
    execFileSync("git", ["init", "-q", "-b", "main", repository]);
    writeFileSync(join(repository, "README.md"), "gate env fixture\n");
    git(repository, "add", "README.md");
    git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
      "commit", "-q", "-m", "test: seed gate env fixture");
    const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
    const config = {
      ...loaded,
      runtime: { ...loaded.runtime, seed_paths: [] },
      gates: {
        test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 },
        lint: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 },
      },
    };
    const seen: Array<SystemCommandOptions["env"]> = [];
    const gathering = await runBaselineSuite({
      repository, worktreeRoot: join(root, "worktrees"), project: loaded.project.slug,
      baseSha: git(repository, "rev-parse", "HEAD"), config, outputDir: join(root, "out"),
      runCommand: (_executable, _argv, options) => {
        seen.push(typeof options === "number" ? undefined : options.env);
        return { status: 0, stdout: "", stderr: "", error: null };
      },
    });
    assert.equal(gathering.unavailable, null);
    assert.equal(seen.length, 2, "both configured gates were dispatched");
    const expected = gateEnv(process.env);
    assert.deepEqual(seen, [expected, expected], "each gate received exactly the gate env builder's output");
    assert.equal(seen[0]?.[JEV_KEY], undefined, "the Jev credential reached a gate");
  } finally {
    if (previous === undefined) delete process.env[JEV_KEY];
    else process.env[JEV_KEY] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

// The baseline suite above is the one dispatch reachable without a full run.
// The other three dispatchers build their options inline at the call, so this
// pins that each of them hands the configured gate the same builder's output.
const DISPATCHERS = [
  "core/src/cli/commands/production-run.ts",
  "core/src/cli/commands/rework.ts",
  "core/src/cli/commands/adopt.ts",
  "core/src/preflight/suite.ts",
] as const;

test("every configured-gate dispatch passes the gate env to runCommand", () => {
  const unfiltered = DISPATCHERS.flatMap((path) => {
    const source = readFileSync(resolve(path), "utf8");
    const calls = [...source.matchAll(/runCommand\(executable!, argv, \{([^}]*)\}\)/g)];
    assert.equal(calls.length, 1, `${path} has exactly one configured-gate dispatch`);
    return calls.filter((call) => !/\benv: gateEnvironment\b/.test(call[1]!)).map(() => path);
  });
  assert.deepEqual(unfiltered, []);
});
