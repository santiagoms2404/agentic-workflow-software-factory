import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("../../../src/cli/main.ts", import.meta.url));
const nodeFlags = ["--disable-warning=ExperimentalWarning", "--experimental-strip-types"];

function fixture(): { root: string; link: string } {
  const root = mkdtempSync(join(tmpdir(), "awsf-entrypoint-b7-23-"));
  const link = join(root, "awsf link #%.ts");
  symlinkSync(entry, link);
  return { root, link };
}

function run(executable: string, args: string[], cwd: string): ReturnType<typeof spawnSync> {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

function assertUsage(result: ReturnType<typeof spawnSync>): void {
  // --help currently follows the harmless usage refusal, not a success route.
  // Keep its exit/output contract; this change does not alter argument parsing.
  assert.equal(result.status, 1, "the real CLI must run and return its usage exit code");
  assert.equal(result.stdout, "");
  assert.match(String(result.stderr), /Error: usage: awsf init/);
}

test("B7-23: invoking the real CLI through a symlink runs main", () => {
  const { root, link } = fixture();
  assertUsage(run(process.execPath, [...nodeFlags, link, "--help"], root));
});

test("the CLI is tracked as executable even on filesystems that ignore Git modes", () => {
  // WSL/NTFS can report executable permissions for a tracked 100644 file.
  // Check the index too, so a Linux checkout does not lose the shebang route.
  const tracked = execFileSync("git", ["ls-files", "--stage", "--", "core/src/cli/main.ts"], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8",
  });
  assert.match(tracked, /^100755 /u, "the CLI must be stored with its executable bit");
});

test("B7-24: invoking the bin symlink through its shebang runs main", () => {
  const { root, link } = fixture();
  assertUsage(run(link, ["--help"], root));
});

test("direct and relative entry paths keep the existing usage response", () => {
  const { root } = fixture();
  assertUsage(run(process.execPath, [...nodeFlags, entry, "--help"], root));
  assertUsage(run(process.execPath, [...nodeFlags, relative(root, entry), "--help"], root));
});

test("a relative symlink chain also runs the CLI", () => {
  const { root, link } = fixture();
  const chained = join(root, "awsf");
  symlinkSync(relative(root, link), chained);
  assertUsage(run(process.execPath, [...nodeFlags, "./awsf", "--help"], root));
});

test("importing the CLI from another entrypoint does not execute it", () => {
  const { root, link } = fixture();
  const importer = join(root, "importer.mjs");
  writeFileSync(importer, `import { main } from ${JSON.stringify(pathToFileURL(link).href)};\nconsole.log(typeof main);\n`);
  const result = run(process.execPath, [...nodeFlags, importer, "--help"], root);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "function\n");
  assert.equal(result.stderr, "");
});

test("importing without a file entrypoint or with an unresolvable argv path stays inert", () => {
  const { root } = fixture();
  const source = `const { main } = await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log(typeof main);`;
  for (const prefix of ["", `process.argv[1] = ${JSON.stringify(join(root, "missing.mjs"))};`]) {
    const result = run(process.execPath, [...nodeFlags, "--input-type=module", "--eval", prefix + source], root);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "function\n");
    assert.equal(result.stderr, "");
  }
});
