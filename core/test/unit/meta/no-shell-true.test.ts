import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_EXTS, repoRoot, relRepo } from "./_walk.ts";
import { drivingTextFiles } from "./_driving.ts";

/**
 * Invariant 4: executable + argv array only. No `shell` option enables a shell anywhere, so the only value
 * it may take is false. A literal true, a number, a string shell path, or `!0` refuses. The key may be bare,
 * quoted, computed, or built from literal parts, and a comment or parentheses may sit between colon and value.
 * A member assignment (`options.shell = …`) is the same option. A variable that merely shares the name is not.
 */
const SHELL_ENABLED = /(?:(?:\bshell|["'`]shell["'`]|\[\s*["'`]shell["'`]\s*\]|\[\s*["'`]sh["'`]\s*\+\s*["'`]ell["'`]\s*\])\s*:|\.shell\s*=|\[\s*["'`]shell["'`]\s*\]\s*=)\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*[(\s]*(?!false\b)(?:true\b|!\s*0\b|\d|["'`])/u;

/**
 * The one refusal row that spells the forbidden option on purpose: the broker must refuse shell execution, and its
 * negative test has to name the option to prove it. Exempt by exact path and row text, never by pattern. The
 * placeholder is renamed at run time so this file does not carry the spelling it exempts.
 */
const REFUSAL_ROW = {
  path: "core/test/unit/execution/spawn-sites.test.ts",
  row: '["SHELL execution", {}, { SHELL: true as unknown as false }, /SHELL execution is not available/],'.replaceAll("SHELL", "shell"),
};

/** Tracked code wherever it lives. Dependencies and build output are not tracked, so no sweep reads them. */
function trackedCode(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot() })
    .toString("utf8")
    .split("\0")
    .filter((file) => CODE_EXTS.some((ext) => file.endsWith(ext)));
}

function sweptFiles(): { path: string; text: string }[] {
  const code = trackedCode().map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf8") }));
  const driving = drivingTextFiles().map((file) => ({ path: relRepo(file), text: readFileSync(file, "utf8") }));
  return [...code, ...driving];
}

function enablesShell(path: string, text: string): boolean {
  const exempt = path === REFUSAL_ROW.path ? text.split("\n").find((line) => line.trim() === REFUSAL_ROW.row) : undefined;
  return SHELL_ENABLED.test(exempt === undefined ? text : text.replace(exempt, ""));
}

test("no shell option enables a shell in tracked code or the driving-document tree", () => {
  // The walk must reach the code the broader invariant names, not only the two trees the first fence began with.
  const paths = trackedCode();
  assert.ok(paths.some((path) => path.startsWith("core/test/")), "the sweep must read the test tree");
  assert.ok(paths.includes("core/test/fixtures/providers/stub/stub-provider.mjs"), "the sweep must read .mjs fixtures");
  assert.ok(drivingTextFiles().length > 0, "the driving-document half must not be vacuous");
  const offenders = sweptFiles().filter(({ path, text }) => enablesShell(path, text)).map(({ path }) => path);
  assert.deepEqual(offenders, []);
});

test("the one exempt refusal row still exists exactly, so the exemption cannot outlive its row", () => {
  const source = readFileSync(join(repoRoot(), REFUSAL_ROW.path), "utf8");
  assert.ok(source.split("\n").some((line) => line.trim() === REFUSAL_ROW.row), `${REFUSAL_ROW.path} moved; update REFUSAL_ROW`);
});

test("the shell matcher bites every enabling spelling and passes only the false value", () => {
  // Planted rows use uppercase placeholders, renamed here, so this file never carries an enabling spelling.
  const planted = (row: string): string => row.replaceAll("SHELL", "shell").replaceAll("SH", "sh").replaceAll("ELL", "ell");
  const enabling = [
    "await spawn(cmd, argv, { SHELL: true });",
    "execFile(bin, args, { SHELL : true })",
    '{ "SHELL": true }',
    "{ 'SHELL': true }",
    '{ ["SHELL"]: true }',
    '{ ["SH" + "ELL"]: true }',
    "{ SHELL: /* checked */ true }",
    "{ SHELL: (true) }",
    '{ SHELL: "/bin/sh" }',
    "{ SHELL: 1 }",
    "{ SHELL: !0 }",
    "options.SHELL = true;",
    '{ "SHELL": "/bin/sh" }',
    "const planted = `${row}`; // SHELL: true as text",
    "/** Invariant 4: `SHELL: true` appears nowhere. */",
  ];
  for (const row of enabling) {
    assert.equal(SHELL_ENABLED.test(planted(row)), true, row);
  }
  const inert = [
    "{ SHELL: false }",
    "{ SHELL: false as const }",
    "{ SHELL: spec.SHELL }",
    "(spec as { SHELL: unknown }).SHELL !== false",
    "const SHELL = true;",
    'const SHELL = "bash";',
    "// SHELL: false documents the default",
  ];
  for (const row of inert) {
    assert.equal(SHELL_ENABLED.test(planted(row)), false, row);
  }
});

test("an exempt row is exempt only in its own file", () => {
  const row = REFUSAL_ROW.row;
  assert.equal(enablesShell(REFUSAL_ROW.path, `const rows = [\n  ${row}\n];\n`), false);
  assert.equal(enablesShell("core/test/unit/execution/other.test.ts", `const rows = [\n  ${row}\n];\n`), true);
  assert.equal(enablesShell(REFUSAL_ROW.path, `const rows = [\n  ${row}\n  ${row}\n];\n`), true, "a second copy in the exempt file still refuses");
});
