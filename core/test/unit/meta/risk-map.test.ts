import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../../src/config/load.ts";
import { compilePathGlob } from "../../../src/policy/path-policy.ts";
import { credentialKey } from "../../../src/policy/redaction.ts";
import { trackedFiles } from "./_scope.ts";
import { repoRoot } from "./_walk.ts";

// IM13: risk.default is the tier of any path no glob names. Every part of
// core/src must be named in awsf.config.yaml, so a new part gets its tier from
// a choice the owner made and never from the default by accident.
//
// A key the scrubber reads as credential-named is redacted wherever the
// configuration is scrubbed, and owner rework then refuses the whole
// configuration as credential-shaped. Such a path stays out of risk.paths.

const SOURCE = "core/src/";
const root = repoRoot();

/** Each directory directly under core/src as `<dir>/**`, and each file directly in it. */
function sourceParts(tracked: readonly string[]): string[] {
  const parts = new Set<string>();
  for (const path of tracked) {
    if (!path.startsWith(SOURCE)) continue;
    const rest = path.slice(SOURCE.length);
    const slash = rest.indexOf("/");
    parts.add(slash === -1 ? path : `${SOURCE}${rest.slice(0, slash)}/**`);
  }
  return [...parts].sort();
}

/** Parts the map does not name, core/src entries that match no tracked file, and credential-named keys. */
function riskMapGaps(tracked: readonly string[], paths: Readonly<Record<string, string>>): string[] {
  const parts = sourceParts(tracked);
  assert.ok(parts.length > 0, "empty scan root: core/src");
  const unnamed = parts.filter(part => !Object.hasOwn(paths, part)).map(part => `no tier: ${part}`);
  const stale = Object.keys(paths).filter(glob => glob.startsWith(SOURCE)).filter(glob => {
    const matcher = compilePathGlob(glob, true);
    return !tracked.some(path => matcher.test(path));
  }).map(glob => `matches no tracked file: ${glob}`);
  const redacted = Object.keys(paths).filter(credentialKey).map(glob => `credential-named key: ${glob}`);
  return [...unnamed, ...stale, ...redacted];
}

function configuredPaths(): Readonly<Record<string, string>> {
  return loadConfig(readFileSync(join(root, "awsf.config.yaml"), "utf8")).risk.paths;
}

test("every part of core/src has a risk tier by name", () => {
  const gaps = riskMapGaps(trackedFiles(root), configuredPaths());
  assert.deepEqual(gaps, [], gaps.join("\n"));
});

test("the risk map check names a planted part, a stale entry, a credential-named key and an empty scan", () => {
  const tracked = trackedFiles(root);
  const paths = configuredPaths();
  assert.deepEqual(riskMapGaps([...tracked, "core/src/planted/a.ts", "core/src/planted.ts"], paths),
    ["no tier: core/src/planted.ts", "no tier: core/src/planted/**"]);
  assert.deepEqual(riskMapGaps(tracked, { ...paths, "core/src/gone/**": "T2" }),
    ["matches no tracked file: core/src/gone/**"]);
  assert.deepEqual(riskMapGaps(tracked, { ...paths, "dashboard/shared/credential-patterns.ts": "T2" }),
    ["credential-named key: dashboard/shared/credential-patterns.ts"]);
  assert.throws(() => riskMapGaps(["README.md"], paths), /empty scan root: core\/src/u);
});
