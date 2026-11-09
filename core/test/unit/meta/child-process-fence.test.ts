import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { repoRoot, walkFiles } from "./_walk.ts";

// The inv 3 fence (AGENTS.md): `node:child_process` is importable only in the transport broker.
//
// COVERAGE — inv 3 is scoped to shipped code (owner decision O5 of the whole-project review); tests may spawn.
// This fence walks exactly:
//   core/src/**, dashboard/src/**, docs/driving/**
// reading every file ending .ts .tsx .vue .mts .cts .js .mjs .cjs, except test files (*.test.* / *.spec.*).
// Not covered: core/test/**, dashboard/shared/**, the rest of docs/**, and non-code files (.sh .md .json) — a
// shell hook spawns natively and has no child_process import to fence. At this commit the walk over
// dashboard/src and docs/driving finds no importer, so extending it produced no false hit.
const ALLOWED = "core/src/execution/transport-broker.ts";
// Keep the quoted-specifier guard; also catch no-substitution templates in loaders.
// A bare backtick mention appears in boundary documentation, not just executable code.
const PATTERN = /(['"])(node:)?child_process\1|\b(?:import|require|getBuiltinModule)\s*\(\s*`(?:node:)?child_process`/;
const ROOTS = ["core/src", "dashboard/src", "docs/driving"];
const CODE_EXTS = [".ts", ".tsx", ".vue", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
// Only dependencies are skipped. A `dist` folder under a root is shipped code as far as this fence is concerned.
const READ_PRUNE = ["node_modules", ".git"];

export function offenders(base: string): string[] {
  return ROOTS.flatMap((root) => walkFiles(join(base, root), CODE_EXTS, READ_PRUNE))
    .map((f) => relative(base, f).split("\\").join("/"))
    .filter((f) => f !== ALLOWED)
    .filter((f) => !TEST_FILE.test(f))
    .filter((f) => PATTERN.test(readFileSync(join(base, f), "utf8")))
    .sort();
}

// Built at run time so this file never carries a quoted spelling the fence (or a reader grepping for one) would see.
const MODULE = "child" + "_process";
const SPAWN_IMPORT = `import { spawn } from "node:${MODULE}";\nexport const run = () => spawn("true");\n`;
const SPAWN_REQUIRE = `const { spawnSync } = require('${MODULE}');\nmodule.exports = () => spawnSync("true");\n`;

function write(base: string, path: string, source: string): void {
  const target = join(base, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

test("node:child_process is imported nowhere in shipped code except transport-broker.ts", () => {
  assert.deepEqual(offenders(repoRoot()), []);
});

test("the fence flags a spawn under every walked root", () => {
  const base = mkdtempSync(join(tmpdir(), "awsf-cp-fence-"));
  try {
    write(base, "core/src/sneaky.ts", SPAWN_IMPORT);
    write(base, "dashboard/src/composables/sneaky.ts", SPAWN_IMPORT);
    write(base, "dashboard/src/components/Sneaky.vue", `<script setup lang="ts">\n${SPAWN_IMPORT}</script>\n`);
    write(base, "docs/driving/marimba/sneaky.mts", SPAWN_REQUIRE);
    write(base, "docs/driving/marimba/sneaky.pi.ts", SPAWN_IMPORT);
    write(base, "core/src/dist/packed.mjs", SPAWN_REQUIRE);
    assert.deepEqual(offenders(base), [
      "core/src/dist/packed.mjs",
      "core/src/sneaky.ts",
      "dashboard/src/components/Sneaky.vue",
      "dashboard/src/composables/sneaky.ts",
      "docs/driving/marimba/sneaky.mts",
      "docs/driving/marimba/sneaky.pi.ts",
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the fence ignores the broker, test files, and spawns outside the walked roots", () => {
  const base = mkdtempSync(join(tmpdir(), "awsf-cp-fence-scope-"));
  try {
    write(base, "dashboard/src/real-offender.ts", SPAWN_IMPORT);
    write(base, ALLOWED, SPAWN_IMPORT);
    write(base, "dashboard/src/clean.ts", "export const ok = 1;\n");
    write(base, "core/test/unit/spawns.test.ts", SPAWN_IMPORT);
    write(base, "dashboard/src/spawns.test.ts", SPAWN_IMPORT);
    write(base, "docs/driving/marimba/spawns.test.mts", SPAWN_REQUIRE);
    write(base, "dashboard/shared/spawns.ts", SPAWN_IMPORT);
    write(base, "docs/design/spawns.ts", SPAWN_IMPORT);
    write(base, "docs/driving/marimba/notes.md", SPAWN_IMPORT);
    write(base, "docs/driving/marimba/hook.sh", SPAWN_IMPORT);
    assert.deepEqual(offenders(base), ["dashboard/src/real-offender.ts"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
