import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { repoRoot, walkFiles } from "./_walk.ts";

const COMPOSITION_SITE = "core/src/workflow/prompt-composition.ts";

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
  const current = [...sites].sort();
  assert.deepEqual(
    current,
    [COMPOSITION_SITE],
    `system-prompt composition site must be only ${COMPOSITION_SITE}; observed: ${current.join(", ") || "none"}`,
  );
}

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

test("the repository has one prompt-composition site in the approved module", () => {
  const sites = compositionSites(repoRoot());
  assert.deepEqual(sites, [COMPOSITION_SITE]);
  assertPermittedLayout(sites);
});

test("the fence recognizes both mechanical definitions in the approved module", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-"));
  try {
    write(root, COMPOSITION_SITE, [
      "export function compose(agent: { prompt: { system: string } }) {",
      "  return agent.prompt.system;",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [COMPOSITION_SITE]);
    assertPermittedLayout(compositionSites(root));

    write(root, COMPOSITION_SITE, [
      "export function compose(roleSystemBytes: string, renderedSharedBytes: string) {",
      "  return [roleSystemBytes, renderedSharedBytes].join('\\n\\n');",
      "}",
    ].join("\n"));
    assert.deepEqual(compositionSites(root), [COMPOSITION_SITE], "joining the shared system block is independently counted");
    assertPermittedLayout(compositionSites(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the one-site fence proves red on a temporary second composition site", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-site-red-"));
  try {
    write(root, COMPOSITION_SITE, "export const compose = (agent: any) => agent.prompt.system;\n");
    write(root, "core/src/cli/commands/second-site.ts", "export const second = (agent: any) => agent.prompt.system;\n");
    const sites = compositionSites(root);
    assert.deepEqual(sites, [
      "core/src/cli/commands/second-site.ts",
      COMPOSITION_SITE,
    ]);
    assert.throws(
      () => assertPermittedLayout(sites),
      /system-prompt composition site must be.*observed: core\/src\/cli\/commands\/second-site\.ts, core\/src\/workflow\/prompt-composition\.ts/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
