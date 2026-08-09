import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";
import { CREDENTIAL_PATTERNS } from "../../../src/policy/redaction.ts";

/**
 * AGENTS.md invariant 9 says "in fixtures **or anywhere else**", and the
 * ownership table says committed durable intent carries no machine paths and
 * no credentials. The fixtures walk above does not reach the repo root, so the
 * committed manifests get their own sweep.
 */
const ROOT_MANIFESTS = ["package.json", "core/package.json", "dashboard/package.json", "awsf.config.yaml"];

const LOCKFILE = "package-lock.json";

/** The only registry this project's dependencies may come from. */
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

/** Keys npm writes when a registry required authentication. None may be present. */
const AUTH_KEYS = ["_auth", "_authToken", "auth", "authToken", "password", "token", "certfile", "keyfile"];

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\|~\/|file:)/;

test("no credential-shaped values in test fixtures", () => {
  // `.jsonl` and `.md` are on this list because M4's real-adapter fixtures are
  // CAPTURED provider output plus a provenance note beside it. Bytes nobody
  // wrote by hand are exactly the bytes this sweep exists for.
  const files = walkFiles(join(repoRoot(), "core", "test", "fixtures"), [
    ".ts",
    ".json",
    ".jsonl",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
  ]);
  const offenders = files
    .map(relRepo)
    .filter((f) => CREDENTIAL_PATTERNS.some((p) => p.test(readFileSync(join(repoRoot(), f), "utf8"))));
  assert.deepEqual(offenders, []);
});

test("no credential-shaped values in the committed root manifests", () => {
  const offenders = ROOT_MANIFESTS.filter((f) => {
    const full = join(repoRoot(), f);
    if (!existsSync(full)) return false;
    return CREDENTIAL_PATTERNS.some((p) => p.test(readFileSync(full, "utf8")));
  });
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// The lockfile. Checked STRUCTURALLY, not by regex: it is mostly base64
// integrity hashes, and a generic credential pattern sweeping base64 is a
// false-positive generator. The two things that can genuinely leak are a
// `resolved` URL and an auth key, so those are what get checked.
// ---------------------------------------------------------------------------

test("the lockfile exists — a floating transitive tree is not a pinned one", () => {
  // package.json pins every DIRECT dependency exactly (no carets), but without
  // a committed lockfile every transitive dependency still floats, and D2's
  // allowlist meta-test cannot see them at all.
  assert.equal(existsSync(join(repoRoot(), LOCKFILE)), true, `${LOCKFILE} must be committed`);
});

test("every lockfile package resolves to the public npm registry, with no embedded credentials", () => {
  const lock = JSON.parse(readFileSync(join(repoRoot(), LOCKFILE), "utf8")) as {
    packages?: Record<string, { resolved?: string; link?: boolean }>;
  };
  const packages = lock.packages ?? {};
  assert.ok(Object.keys(packages).length > 0, "the lockfile records no packages");

  // The two workspaces resolve to their own directories, not to a registry.
  // Read them from the root manifest rather than hard-coding, so adding a third
  // workspace does not silently widen what this test tolerates.
  const root = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")) as { workspaces?: string[] };
  const workspaces = new Set(root.workspaces ?? []);
  assert.deepEqual([...workspaces].sort(), ["core", "dashboard"]);

  const offenders: string[] = [];
  for (const [name, entry] of Object.entries(packages)) {
    const resolved = entry.resolved;
    if (resolved === undefined) continue; // the workspace root carries none
    if (entry.link === true) {
      // A link may only point at a declared workspace — never at some other
      // directory on whichever machine ran `npm install`.
      if (!workspaces.has(resolved)) offenders.push(`${name}: links outside the workspaces (${resolved})`);
      continue;
    }
    if (!resolved.startsWith(PUBLIC_REGISTRY)) offenders.push(`${name}: ${resolved}`);
    // `user:pass@host` in a registry URL is the exact leak this guards.
    if (/\/\/[^/@\s]*:[^/@\s]*@/.test(resolved)) offenders.push(`${name}: credentials in resolved URL`);
  }
  assert.deepEqual(offenders, []);
});

test("the lockfile records no machine-local path", () => {
  // Committed durable intent is machine-path-free: a `file:` or linked
  // dependency would pin this repository to one laptop.
  const raw = readFileSync(join(repoRoot(), LOCKFILE), "utf8");
  const lock = JSON.parse(raw) as { packages?: Record<string, Record<string, unknown>> };
  const offenders: string[] = [];
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    for (const field of ["resolved", "version"]) {
      const value = entry[field];
      if (typeof value === "string" && ABSOLUTE_PATH.test(value)) offenders.push(`${name}.${field}: ${value}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the lockfile carries no registry authentication of any kind", () => {
  const raw = readFileSync(join(repoRoot(), LOCKFILE), "utf8");
  const present = AUTH_KEYS.filter((key) => new RegExp(`"${key}"\\s*:`).test(raw));
  assert.deepEqual(present, []);
});
