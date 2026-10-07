import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { loadConfig } from "../../src/config/load.ts";
import { markerPairs, PROTECTED_TRAP_PATHS, treeFiles } from "../fixtures/trap-fence.ts";
import { refusalAssertion } from "./_harness.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const MUTANT_ID = "AWSF_TEST_TRAP_MUTANT_ID";
export interface MutantOptions {
  readonly id: string;
  /** import.meta.filename of the calling trap. */
  readonly file: string;
  /** Only demonstration fixtures override this; real traps use this checkout. */
  readonly sourceRoot?: string;
}
export interface MutantResult { readonly wallTimeMs: number; readonly output: string; readonly exitCode: number }

/** Copy the import tree, remove precisely one refusal, and run one trap file.
 * A loader error, timeout, signal or unrelated red assertion is NOT a mutant.
 */
export function runMutant(options: MutantOptions): MutantResult {
  const started = performance.now();
  const sourceRoot = resolve(options.sourceRoot ?? ROOT);
  const file = relative(sourceRoot, resolve(options.file));
  assert.ok(!isAbsolute(file) && !file.startsWith("..") && file.endsWith(".test.ts"), "trap test must be inside its source tree");
  assert.match(options.id, /^TR-\d{2,}$/u);
  const scratch = mkdtempSync(join(tmpdir(), "awsf-trap-mutant-"));
  try {
    for (const path of ["core/src", "core/test", "dashboard/shared", "prompts", "awsf.config.yaml", "awsf.project.yaml", "package.json"]) {
      if (existsSync(join(sourceRoot, path))) cpSync(join(sourceRoot, path), join(scratch, path), { recursive: true, dereference: false });
    }
    symlinkSync(realpathSync(join(ROOT, "node_modules")), join(scratch, "node_modules"), "dir");
    const configPath = join(scratch, "awsf.config.yaml");
    const configuredProtected = existsSync(configPath) ? loadConfig(readFileSync(configPath, "utf8")).policy.protected_paths : [];
    const pairs = markerPairs(treeFiles(scratch, "core/src"), [...PROTECTED_TRAP_PATHS, ...configuredProtected]);
    const selected = pairs.filter(pair => pair.id === options.id);
    assert.equal(selected.length, 1, `${options.id}: expected exactly one refusal marker pair in scratch copy`);
    const pair = selected[0]!;
    const path = join(scratch, pair.path);
    const lines = readFileSync(path, "utf8").split("\n");
    lines.splice(pair.begin + 1, pair.end - pair.begin - 1);
    writeFileSync(path, lines.join("\n"));
    const label = refusalAssertion(options.id);
    const env: NodeJS.ProcessEnv = { ...process.env, [MUTANT_ID]: options.id };
    // A fresh test runner, not a recursively inherited node:test worker.
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap",
      "--test-name-pattern", `^${label}(?:$|:)`, join(scratch, file)], {
      cwd: scratch, env, encoding: "utf8",
      timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    assert.equal(child.error, undefined, `${options.id}: mutant process failed: ${child.error?.message}\n${output}`);
    assert.equal(child.signal, null, `${options.id}: mutant was signalled\n${output}`);
    assert.ok(child.status !== null && child.status !== 0, `${options.id}: mutant stayed green\n${output}`);
    // TAP puts the actual assertion message in error:, not just in its test title.
    const failures = output.split(/(?=\nnot ok )/u).filter(block => block.startsWith("\nnot ok "));
    const assertionError = new RegExp(`\\n\\s+error: (?:['"]?${label}|\\|[-+]?\\n\\s+${label})`, "u");
    assert.ok(failures.some(block => block.includes(`- ${label}`)
      && block.includes("code: 'ERR_ASSERTION'") && assertionError.test(block.split(/\n\s*stack:/u)[0]!)),
    `${options.id}: mutant did not fail its refusal assertion\n${output}`);
    return { wallTimeMs: performance.now() - started, output, exitCode: child.status! };
  } finally {
    // Only this invocation's synthetic scratch tree is removed.
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Call LAST in every trap file, after its named refusal test(s). */
export function ownMutant(options: MutantOptions): void {
  test(`${options.id} own mutant`, { skip: process.env[MUTANT_ID] === options.id }, context => {
    const result = runMutant(options);
    context.diagnostic(`${options.id} mutant wall time: ${result.wallTimeMs.toFixed(1)} ms`);
  });
}
