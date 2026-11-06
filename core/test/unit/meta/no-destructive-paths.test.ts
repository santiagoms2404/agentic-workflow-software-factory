import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

/**
 * Invariant 8 has three enforcement legs. The publish fence holds the conditional
 * push half through locality, derivation, and the pre-LANDED condition. The land
 * route fence keeps browser write paths absent. This scan holds the unconditional
 * force and auto-delete half everywhere in core/src, including publish/argv.ts.
 * The former push phrase scan moved to the publish fence; it did not vanish.
 */
const DESTRUCTIVE_REFSPEC_PATTERNS = [
  // A plus-prefixed refspec produced `(forced update)` at exit 0.
  /(["'])\+[a-zA-Z0-9_\-/]+:(?:refs\/)?[a-zA-Z0-9_\-/]+\1/,
  // An empty-source refspec produced `[deleted]` at exit 0.
  /(["']):(?!(?:\/\d+|\/\/))(?:\b|refs\/)[a-zA-Z][a-zA-Z0-9_\-/]*\1/,
  // An all-zeros-source refspec produced `[deleted]` at exit 0 (both 40 and 64 hex zero object ids).
  /(["'])0{40,64}:(?:refs\/)?[a-zA-Z0-9_\-/]+\1/,
] as const;

const FORBIDDEN = [
  /--force\b/,
  /(?:-f\b.*?\bpush\b|\bpush\b.*?-f\b)/,
  /\[[^\]]*?["'`]push["'`][^\]]*?["'`](?:--delete|--prune|--mirror|-f)["'`][^\]]*?\]/,
  /\[[^\]]*?["'`](?:--delete|--prune|--mirror|-f)["'`][^\]]*?["'`]push["'`][^\]]*?\]/,
  /["'`]--delete["'`]/,
  /["'`]--prune["'`]/,
  /rm\s+-rf/,
  /rmSync\s*\(/,
  /rmdirSync\s*\(/,
  /unlinkSync\s*\(/,
  // The callback and promise spellings of the same deletes (owner call O2):
  // `unlink(`, `rm(`, `rmdir(` whether imported from node:fs/promises, called
  // as `fs.unlink(`, or reached through `fs.promises.`, plus a bare
  // `promises.unlink` reference that is called later under another name.
  /\bunlink\s*\(/,
  /\brm\s*\(/,
  /\brmdir\s*\(/,
  /\bpromises\s*\.\s*(?:unlink|rm|rmdir)\b/,
  /\bauto[-_]?delete\b/i,
  /worktree\s+(?:remove|prune)\b/,
  // Git receives these as argv tokens, so a space/string scan cannot see the destructive pair.
  /["'`]worktree["'`]\s*,\s*["'`](?:remove|prune)["'`]/,
  /["'`]branch["'`]\s*,\s*["'`](?:-D|-d|--delete)["'`]/,
  /branch\s+(?:-D|-d|--delete)\b/,
  /["'`]update-ref["'`]\s*,\s*["'`](?:-d|--delete)["'`]/,
  /["'`]reset["'`]\s*,\s*["'`]--hard["'`]/,
  // `clean -f` is destructive; this also covers combined forms such as `-fdx` and `-dfx`.
  /["'`]clean["'`]\s*,\s*["'`]-[a-z]*f[a-z]*["'`]/i,
  /clean\s+-[a-z]*f[a-z]*\b/i,
  ...DESTRUCTIVE_REFSPEC_PATTERNS,
];

interface AllowedDelete {
  file: string;
  /** The whole trimmed source line, so the entry survives the line moving but not the call changing. */
  line: string;
}

/**
 * The only deletes core/src is allowed to perform, each argued here: the
 * previously authorized lock releases and the six narrow operation-owned
 * cleanup callsites from invariant 8's dated owner amendment (2026-11-06, D1).
 * D1 covers private temporaries and failed-admission rollback only, not user
 * work or refs. Publish deny-list and validation lines are tracked separately
 * in VALIDATION_ONLY_LINES; they are checks, not delete exceptions. A new delete
 * is an offender until argued into this list; it never rides on an existing
 * entry, because an entry names its file and whole source line and excuses one
 * occurrence.
 */
const ALLOWED_DELETES: readonly AllowedDelete[] = [
  // Lease takeover: runs under the claim lock, only after
  // assertNoExecutionController found no live holder for the old record.
  { file: "core/src/execution/operation-lease.ts", line: "if (old !== null) await unlink(pathFor(directory));" },
  // Lease release: runs under the claim lock, only when the lease still names this process's id.
  { file: "core/src/execution/operation-lease.ts", line: "await unlink(pathFor(directory));" },
  // reclaimLock: recovery's one authorized repair, only against the exact holder it observed.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(lockPath);" },
  // reclaimLock: recovery repair against an empty/unnamed lock file from interrupted atomic link.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(lockPath);" },
  // AttemptLock.withLock: cleaning up the temp file after atomic link.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(tmpPath).catch(() => {});" },
  // AttemptLock.withLock: the holder releasing the `wx` lock file it created.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(this.lockPath);" },
  // Immutable checkpoint generation: unlink the exclusive-created private temporary after linking it.
  { file: "core/src/execution/continuity-store.ts", line: "await fs.unlink(temporary);" },
  // Immutable checkpoint generation: remove its exclusive-created temporary after EEXIST.
  { file: "core/src/execution/continuity-store.ts", line: "await fs.unlink(temporary).catch(() => undefined);" },
  { file: "core/src/execution/continuity-store.ts", line: "await fs.unlink(temporary).catch(() => undefined);" },
  // Immutable checkpoint generation: best-effort rollback of its exclusive-created temporary.
  { file: "core/src/execution/continuity-store.ts", line: "await fs.unlink(temporary).catch(() => undefined);" },
  // Admission rollback: remove only files recorded after successful exclusive creation.
  { file: "core/src/registry/plan-admission.ts", line: "try { rmSync(file, { force: true }); } catch { /* best effort */ }" },
  // Admission rollback: remove only operation-created directories that remain empty.
  { file: "core/src/registry/plan-admission.ts", line: "rmdirSync(dir);" },
];

interface ValidationOnlyLine {
  file: string;
  /** The whole trimmed source line; this excuses validator data, never a delete or argv. */
  line: string;
}

/** Deny-list and validation lines are checks, not destructive actions. */
const VALIDATION_ONLY_LINES: readonly ValidationOnlyLine[] = [
  {
    file: "core/src/publish/argv.ts",
    line: 'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
  },
  {
    file: "core/src/publish/argv.ts",
    line: 'if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
  },
];

interface Source {
  path: string;
  text: string;
}

function literalString(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function destructiveArgv(tokens: readonly string[]): boolean {
  const has = (token: string): boolean => tokens.includes(token);
  if (has("push")) {
    if (has("-f") || has("--force") || has("--delete") || has("--prune") || has("--mirror")) return true;
    if (tokens.some((token) => /^\+[^:]+:.+$/u.test(token) || /^:[^:]+$/u.test(token) || /^0{40,64}:.+$/u.test(token))) return true;
  }
  if (has("worktree") && (has("remove") || has("prune"))) return true;
  if (has("branch") && (has("-D") || has("-d") || has("--delete"))) return true;
  if (has("update-ref") && (has("-d") || has("--delete"))) return true;
  if (has("reset") && has("--hard")) return true;
  return has("clean") && tokens.some((token) => /^-[a-z]*f[a-z]*$/iu.test(token));
}

/** Literal argv arrays at known process/Git boundaries; token order is immaterial to the deny rules. */
function destructiveArgvLines(path: string, text: string): number[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines: number[] = [];
  const argvIndex = (call: ts.CallExpression): number | null => {
    if (!ts.isIdentifier(call.expression)) return null;
    switch (call.expression.text) {
      case "runGit": return 1;
      case "runSystemCommand":
      case "spawn":
      case "spawnSync": return 1;
      default: return null;
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const index = argvIndex(node);
      const argument = index === null ? undefined : node.arguments[index];
      if (argument !== undefined && ts.isArrayLiteralExpression(argument)) {
        const tokens = argument.elements.map(literalString).filter((token): token is string => token !== null);
        if (destructiveArgv(tokens)) lines.push(argument.getStart(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/**
 * Every line of `sources` a FORBIDDEN pattern hits, minus the allowlisted ones.
 * An allowlist entry excuses one line, once: a second identical delete in the
 * same file is still an offender. Entries no line used come back as `unused`,
 * so a lock release that moves or goes away cannot leave a stale excuse behind.
 */
export function fenceHits(sources: readonly Source[]): { offenders: string[]; unused: string[] } {
  const usedDeletes = new Set<AllowedDelete>();
  const usedValidationLines = new Set<ValidationOnlyLine>();
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    const hitLines = new Set<number>();
    for (const pattern of FORBIDDEN) {
      for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        hitLines.add(text.slice(0, match.index).split("\n").length - 1);
      }
    }
    for (const position of destructiveArgvLines(path, text)) {
      hitLines.add(text.slice(0, position).split("\n").length - 1);
    }
    const lines = text.split("\n");
    for (const index of [...hitLines].sort((a, b) => a - b)) {
      const line = (lines[index] ?? "").trim();
      const deleteException = ALLOWED_DELETES.find((entry) =>
        !usedDeletes.has(entry) && entry.file === path && entry.line === line);
      if (deleteException !== undefined) {
        usedDeletes.add(deleteException);
        continue;
      }
      const validationLine = VALIDATION_ONLY_LINES.find((entry) =>
        !usedValidationLines.has(entry) && entry.file === path && entry.line === line);
      if (validationLine !== undefined) usedValidationLines.add(validationLine);
      else offenders.push(`${path}:${String(index + 1)}: ${line}`);
    }
  }
  const unused = [
    ...ALLOWED_DELETES.filter((entry) => !usedDeletes.has(entry)).map((entry) => `${entry.file}: ${entry.line}`),
    ...VALIDATION_ONLY_LINES.filter((entry) => !usedValidationLines.has(entry)).map((entry) => `${entry.file}: ${entry.line}`),
  ];
  return { offenders, unused };
}

test("no force/auto-delete paths in core/src", () => {
  const sources = walkFiles(join(repoRoot(), "core", "src")).map((f) => ({ path: relRepo(f), text: readFileSync(f, "utf8") }));
  const { offenders, unused } = fenceHits(sources);
  assert.deepEqual(offenders, []);
  assert.deepEqual(unused, []);
});

test("the async and promise delete spellings bite", () => {
  const text = [
    'import fs from "node:fs";',
    'import { rm } from "node:fs/promises";',
    "export async function sweep(path: string): Promise<void> {",
    "  await fs.promises.unlink(path);",
    "  await rm(path, { recursive: true });",
    "}",
  ].join("\n");
  assert.deepEqual(fenceHits([{ path: "core/src/fixture/sweep.ts", text }]).offenders, [
    "core/src/fixture/sweep.ts:4: await fs.promises.unlink(path);",
    "core/src/fixture/sweep.ts:5: await rm(path, { recursive: true });",
  ]);
});

test("every callback and promise delete spelling is an offender", () => {
  const text = [
    "await unlink(path);",
    "fs.unlink(path, done);",
    "await rmdir(path);",
    "await fs.promises.rmdir(path);",
    "const drop = fs.promises.rm;",
    'import { unlink } from "node:fs/promises";',
  ].join("\n");
  assert.deepEqual(fenceHits([{ path: "core/src/fixture/spellings.ts", text }]).offenders, [
    "core/src/fixture/spellings.ts:1: await unlink(path);",
    "core/src/fixture/spellings.ts:2: fs.unlink(path, done);",
    "core/src/fixture/spellings.ts:3: await rmdir(path);",
    "core/src/fixture/spellings.ts:4: await fs.promises.rmdir(path);",
    "core/src/fixture/spellings.ts:5: const drop = fs.promises.rm;",
  ]);
});

test("async and promise unlink, rm and rmdir calls all bite", () => {
  const text = [
    "await unlink(path);",
    "await rm(path, { recursive: true });",
    "await rmdir(path);",
    "await fs.promises.unlink(path);",
    "await fs.promises.rm(path, { recursive: true });",
    "await fs.promises.rmdir(path);",
  ].join("\n");
  assert.deepEqual(fenceHits([{ path: "core/src/fixture/async-delete.ts", text }]).offenders, [
    "core/src/fixture/async-delete.ts:1: await unlink(path);",
    "core/src/fixture/async-delete.ts:2: await rm(path, { recursive: true });",
    "core/src/fixture/async-delete.ts:3: await rmdir(path);",
    "core/src/fixture/async-delete.ts:4: await fs.promises.unlink(path);",
    "core/src/fixture/async-delete.ts:5: await fs.promises.rm(path, { recursive: true });",
    "core/src/fixture/async-delete.ts:6: await fs.promises.rmdir(path);",
  ]);
});

test("the lock releases pass, wherever their lines sit", () => {
  const leasePath = "core/src/execution/operation-lease.ts";
  const lockPath = "core/src/persistence/attempt-lock.ts";
  const real = [leasePath, lockPath].map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf8") }));
  const d1Unused = [
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/registry/plan-admission.ts: try { rmSync(file, { force: true }); } catch { /* best effort */ }",
    "core/src/registry/plan-admission.ts: rmdirSync(dir);",
    'core/src/publish/argv.ts: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
    'core/src/publish/argv.ts: if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
  ];
  assert.deepEqual(fenceHits(real), { offenders: [], unused: d1Unused });

  // The same calls at other line numbers: the allowlist is keyed by line text, not position.
  const moved = [
    { path: leasePath, text: "\n\n    if (old !== null) await unlink(pathFor(directory));\n\n      await unlink(pathFor(directory));" },
    {
      path: lockPath,
      text: "\n  await unlink(lockPath);\n  await unlink(lockPath);\n  await unlink(tmpPath).catch(() => {});\n\n\n\n        await unlink(this.lockPath);",
    },
  ];
  assert.deepEqual(fenceHits(moved), { offenders: [], unused: d1Unused });
});

test("operation-owned cleanup and validator exceptions are exact and position-independent", () => {
  const unusedLocks = [
    "core/src/execution/operation-lease.ts: if (old !== null) await unlink(pathFor(directory));",
    "core/src/execution/operation-lease.ts: await unlink(pathFor(directory));",
    "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
    "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
    "core/src/persistence/attempt-lock.ts: await unlink(tmpPath).catch(() => {});",
    "core/src/persistence/attempt-lock.ts: await unlink(this.lockPath);",
  ];
  const continuity = {
    path: "core/src/execution/continuity-store.ts",
    text: ["", "await fs.unlink(temporary);", "", "await fs.unlink(temporary).catch(() => undefined);",
      "await fs.unlink(temporary).catch(() => undefined);", "await fs.unlink(temporary).catch(() => undefined);"].join("\n"),
  };
  const admission = {
    path: "core/src/registry/plan-admission.ts",
    text: ["", "try { rmSync(file, { force: true }); } catch { /* best effort */ }", "", "rmdirSync(dir);"].join("\n"),
  };
  const publish = {
    path: "core/src/publish/argv.ts",
    text: ["", 'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
      "", 'if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {'].join("\n"),
  };
  assert.deepEqual(fenceHits([continuity, admission, publish]), { offenders: [], unused: unusedLocks });
});

test("cleanup exceptions reject copied paths, excess occurrences and changed calls", () => {
  const wrongPath = { path: "core/src/other/cleanup.ts", text: "await fs.unlink(temporary);" };
  const duplicate = {
    path: "core/src/execution/continuity-store.ts",
    text: Array.from({ length: 4 }, () => "await fs.unlink(temporary).catch(() => undefined);").join("\n"),
  };
  const changed = { path: "core/src/registry/plan-admission.ts", text: "try { rmSync(userFile, { force: true }); } catch { /* best effort */ }" };
  assert.deepEqual(fenceHits([wrongPath, duplicate, changed]).offenders, [
    "core/src/other/cleanup.ts:1: await fs.unlink(temporary);",
    "core/src/execution/continuity-store.ts:4: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/registry/plan-admission.ts:1: try { rmSync(userFile, { force: true }); } catch { /* best effort */ }",
  ]);
});

test("forbidden cleanup and force-push argv remain rejected in exception-bearing files", () => {
  const continuity = {
    path: "core/src/execution/continuity-store.ts",
    text: ["await fs.unlink(temporary);", "await fs.unlink(temporary).catch(() => undefined);",
      "await fs.unlink(temporary).catch(() => undefined);", "await fs.unlink(temporary).catch(() => undefined);",
      "await fs.unlink(userPath);"].join("\n"),
  };
  const admission = {
    path: "core/src/registry/plan-admission.ts",
    text: ["try { rmSync(file, { force: true }); } catch { /* best effort */ }", "rmdirSync(dir);",
      "rmSync(userFile, { recursive: true, force: true });"].join("\n"),
  };
  const publish = {
    path: "core/src/publish/argv.ts",
    text: ['const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
      'if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
      'runGit(runner, ["push", "--force", remote, "main"]);', "await unlink(userPath);"].join("\n"),
  };
  assert.deepEqual(fenceHits([continuity, admission, publish]).offenders, [
    "core/src/execution/continuity-store.ts:5: await fs.unlink(userPath);",
    "core/src/registry/plan-admission.ts:3: rmSync(userFile, { recursive: true, force: true });",
    'core/src/publish/argv.ts:3: runGit(runner, ["push", "--force", remote, "main"]);',
    "core/src/publish/argv.ts:4: await unlink(userPath);",
  ]);
});

test("a disappeared cleanup or validation exception is reported stale", () => {
  const stale = fenceHits([
    { path: "core/src/execution/continuity-store.ts", text: "" },
    { path: "core/src/registry/plan-admission.ts", text: "" },
    { path: "core/src/publish/argv.ts", text: "" },
  ]).unused;
  assert.equal(stale.filter((entry) => entry.startsWith("core/src/execution/continuity-store.ts:")).length, 4);
  assert.equal(stale.filter((entry) => entry.startsWith("core/src/registry/plan-admission.ts:")).length, 2);
  assert.equal(stale.filter((entry) => entry.startsWith("core/src/publish/argv.ts:")).length, 2);
});

test("a copied or modified validation line is not a validation-only exception", () => {
  const copiedAndChanged = {
    path: "core/src/publish/argv.ts",
    text: [
      'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
      'if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
      'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
      'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d", "--no-verify"]);',
    ].join("\n"),
  };
  const copiedElsewhere = {
    path: "core/src/publish/other.ts",
    text: 'const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
  };
  const offenders = fenceHits([copiedAndChanged, copiedElsewhere]).offenders;
  assert.deepEqual(offenders, [
    'core/src/publish/argv.ts:3: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
    'core/src/publish/argv.ts:4: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d", "--no-verify"]);',
    'core/src/publish/other.ts:1: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
  ]);
});

test("an unauthorized delete is flagged, even when it copies an allowed line", () => {
  const relate = { path: "core/src/workflow/relate.ts", text: 'import { unlink } from "node:fs/promises";\n  await unlink(lockPath);' };
  const lock = {
    path: "core/src/persistence/attempt-lock.ts",
    text: "  await unlink(lockPath);\n  await unlink(lockPath);\n  await unlink(tmpPath).catch(() => {});\n  await unlink(this.lockPath);\n  await unlink(lockPath);",
  };
  const lease = {
    path: "core/src/execution/operation-lease.ts",
    text: "if (old !== null) await unlink(pathFor(directory));\nawait unlink(pathFor(directory));",
  };
  assert.deepEqual(fenceHits([relate, lock, lease]), {
    offenders: ["core/src/workflow/relate.ts:2: await unlink(lockPath);", "core/src/persistence/attempt-lock.ts:5: await unlink(lockPath);"],
    unused: [
      "core/src/execution/continuity-store.ts: await fs.unlink(temporary);",
      "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
      "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
      "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
      "core/src/registry/plan-admission.ts: try { rmSync(file, { force: true }); } catch { /* best effort */ }",
      "core/src/registry/plan-admission.ts: rmdirSync(dir);",
      'core/src/publish/argv.ts: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
      'core/src/publish/argv.ts: if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
    ],
  });
});

test("an allowlisted release that disappears leaves a stale entry, not a silent pass", () => {
  const lease = { path: "core/src/execution/operation-lease.ts", text: "await unlink(pathFor(directory));" };
  assert.deepEqual(fenceHits([lease]).unused, [
    "core/src/execution/operation-lease.ts: if (old !== null) await unlink(pathFor(directory));",
    "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
    "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
    "core/src/persistence/attempt-lock.ts: await unlink(tmpPath).catch(() => {});",
    "core/src/persistence/attempt-lock.ts: await unlink(this.lockPath);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/execution/continuity-store.ts: await fs.unlink(temporary).catch(() => undefined);",
    "core/src/registry/plan-admission.ts: try { rmSync(file, { force: true }); } catch { /* best effort */ }",
    "core/src/registry/plan-admission.ts: rmdirSync(dir);",
    'core/src/publish/argv.ts: const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);',
    'core/src/publish/argv.ts: if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {',
  ]);
});

test("the destructive refspec patterns bite", () => {
  const syntheticOffenders = [
    '["+refs/heads/main:refs/heads/main"]',
    '[":refs/heads/main"]',
    '["0000000000000000000000000000000000000000:refs/heads/main"]',
  ];

  assert.equal(syntheticOffenders.length, DESTRUCTIVE_REFSPEC_PATTERNS.length);
  for (const [index, pattern] of DESTRUCTIVE_REFSPEC_PATTERNS.entries()) {
    assert.match(syntheticOffenders[index] ?? "", pattern);
  }
});

test("short-name and 64-zero refspecs bite", () => {
  assert.match('["+HEAD:main"]', DESTRUCTIVE_REFSPEC_PATTERNS[0]!);
  assert.match('["+main:main"]', DESTRUCTIVE_REFSPEC_PATTERNS[0]!);
  assert.match('[":main"]', DESTRUCTIVE_REFSPEC_PATTERNS[1]!);
  assert.match('["0000000000000000000000000000000000000000:main"]', DESTRUCTIVE_REFSPEC_PATTERNS[2]!);
  assert.match(`["${"0".repeat(64)}:refs/heads/main"]`, DESTRUCTIVE_REFSPEC_PATTERNS[2]!);
});

test("push-first and destructive argv spellings bite", () => {
  const text = [
    'runGit(g, ["push", "-f", remote, "main"]);',
    'runGit(g, ["push", remote, "+HEAD:main"]);',
    'runGit(g, ["push", remote, ":main"]);',
    'runGit(g, ["push", "--delete", remote, "feature"]);',
    'runGit(g, ["push", "--prune", remote]);',
    'runGit(g, ["push", "--mirror", remote]);',
    'runGit(g, ["branch", "-D", name]);',
    'runGit(g, ["clean", "-fdx"]);',
  ].join("\n");
  const hits = fenceHits([{ path: "core/src/fixture/destructive.ts", text }]);
  assert.equal(hits.offenders.length, 8);
});

test("literal argv checks survive multiline and reordered command tokens", () => {
  const text = [
    "runGit(g, [",
    '  "push",',
    "  remote,",
    '  "-f",',
    '  "HEAD:main",',
    "]);",
    'runGit(g, ["+HEAD:main", remote, "push"]);',
    'runGit(g, [":main", "push", remote]);',
    'runGit(g, ["--delete", remote, "push", branch]);',
    'runGit(g, ["remove", path, "worktree"]);',
    'runGit(g, [name, "-D", "branch"]);',
  ].join("\n");
  const hits = fenceHits([{ path: "core/src/fixture/reordered.ts", text }]);
  assert.equal(hits.offenders.length, 6);
});
