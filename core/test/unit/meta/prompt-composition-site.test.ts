import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { repoRoot, walkFiles } from "./_walk.ts";

const FUTURE_SITE = "core/src/workflow/prompt-composition.ts";
const LEGACY_SITES = [
  "core/src/cli/commands/production-run.ts",
  "core/src/cli/commands/review-phase.ts",
  "core/src/cli/commands/rework.ts",
] as const;

/**
 * A composition site either reads a configured role-system path or joins a
 * shared system block. Callers that only consume a composed bundle match
 * neither condition and therefore do not become composition implementations.
 */
function composesSystemPrompt(source: string): boolean {
  const readsConfiguredSystem = /\b[A-Za-z_$][\w$]*\.prompt\.system\b/.test(source);
  const compact = source.replace(/\s+/g, "");
  const joinsSharedSystemBlock = /\[[^\]]*(?:shared(?:System)?Block|sharedBlockBytes|renderedSharedBytes)[^\]]*\]\.join\(/i.test(compact);
  return readsConfiguredSystem || joinsSharedSystemBlock;
}

function compositionSites(root: string): readonly string[] {
  return walkFiles(join(root, "core", "src"), [".ts"])
    .filter((path) => composesSystemPrompt(readFileSync(path, "utf8")))
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
}

function assertPermittedLayout(sites: readonly string[]): void {
  const legacy = [...LEGACY_SITES].sort();
  const current = [...sites].sort();
  const isCharacterizedBaseline = JSON.stringify(current) === JSON.stringify(legacy);
  const isCentralizedFuture = current.length === 1 && current[0] === FUTURE_SITE;
  assert.ok(
    isCharacterizedBaseline || isCentralizedFuture,
    `system-prompt composition sites must be the characterized three-site baseline or only ${FUTURE_SITE}; observed: ${current.join(", ") || "none"}`,
  );
}

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

test("the repository is still on the characterized three-site baseline", () => {
  const sites = compositionSites(repoRoot());
  assert.deepEqual(sites, [...LEGACY_SITES].sort());
  assertPermittedLayout(sites);
});

test("the fence recognizes both mechanical definitions and permits the one named future module", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-"));
  try {
    write(root, FUTURE_SITE, [
      "export function compose(agent: { prompt: { system: string } }) {",
      "  return agent.prompt.system;",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [FUTURE_SITE]);
    assertPermittedLayout(compositionSites(root));

    write(root, FUTURE_SITE, [
      "export function compose(roleSystemBytes: string, renderedSharedBytes: string) {",
      "  return [roleSystemBytes, renderedSharedBytes].join('\\n\\n');",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [FUTURE_SITE], "joining the shared system block is independently counted");
    assertPermittedLayout(compositionSites(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the one-site fence proves red on a temporary second composition site", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-red-"));
  try {
    write(root, FUTURE_SITE, "export const compose = (agent: any) => agent.prompt.system;\n");
    write(root, "core/src/cli/commands/second-site.ts", "export const second = (agent: any) => agent.prompt.system;\n");
    const sites = compositionSites(root);
    assert.deepEqual(sites, [
      "core/src/cli/commands/second-site.ts",
      FUTURE_SITE,
    ]);
    assert.throws(
      () => assertPermittedLayout(sites),
      /system-prompt composition sites must be.*observed: core\/src\/cli\/commands\/second-site\.ts, core\/src\/workflow\/prompt-composition\.ts/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
