import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  /(["'`])\+[^"'`\s:]+:refs\/[^"'`\s]+\1/,
  // An empty-source refspec produced `[deleted]` at exit 0.
  /(["'`]):refs\/[^"'`\s]+\1/,
  // An all-zeros-source refspec produced `[deleted]` at exit 0.
  /(["'`])0{40}:refs\/[^"'`\s]+\1/,
] as const;

const FORBIDDEN = [
  /--force\b/,
  /-f\b.*push/,
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
  /["'`]update-ref["'`]\s*,\s*["'`](?:-d|--delete)["'`]/,
  /["'`]reset["'`]\s*,\s*["'`]--hard["'`]/,
  // `clean -f` is destructive; this also covers combined forms such as `-fdx` and `-dfx`.
  /["'`]clean["'`]\s*,\s*["'`]-[a-z]*f[a-z]*["'`]/i,
  ...DESTRUCTIVE_REFSPEC_PATTERNS,
];

interface AllowedDelete {
  file: string;
  /** The whole trimmed source line, so the entry survives the line moving but not the call changing. */
  line: string;
}

/**
 * The deletes core/src is allowed to perform, each argued here.
 *
 * Owner call O2: invariant 8's auto-delete is about Git refs, worktrees and the
 * user's work, not a process releasing a lock file it created itself. These are
 * exactly those releases, and nothing else. A new delete is an offender until
 * it is argued into this list; it never rides on an existing entry, because an
 * entry names its file and its whole source line and excuses one occurrence.
 */
const ALLOWED_DELETES: readonly AllowedDelete[] = [
  // Lease takeover: runs under the claim lock, only after
  // assertNoExecutionController found no live holder for the old record.
  { file: "core/src/execution/operation-lease.ts", line: "if (old !== null) await unlink(pathFor(directory));" },
  // Lease release: runs under the claim lock, only when the lease still names this process's id.
  { file: "core/src/execution/operation-lease.ts", line: "await unlink(pathFor(directory));" },
  // reclaimLock: recovery's one authorized repair, only against the exact holder it observed.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(lockPath);" },
  // AttemptLock.withLock: the holder releasing the `wx` lock file it created.
  { file: "core/src/persistence/attempt-lock.ts", line: "await unlink(this.lockPath);" },
];

interface Source {
  path: string;
  text: string;
}

/**
 * Every line of `sources` a FORBIDDEN pattern hits, minus the allowlisted ones.
 * An allowlist entry excuses one line, once: a second identical delete in the
 * same file is still an offender. Entries no line used come back as `unused`,
 * so a lock release that moves or goes away cannot leave a stale excuse behind.
 */
export function fenceHits(sources: readonly Source[]): { offenders: string[]; unused: string[] } {
  const used = new Set<AllowedDelete>();
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    const hitLines = new Set<number>();
    for (const pattern of FORBIDDEN) {
      for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        hitLines.add(text.slice(0, match.index).split("\n").length - 1);
      }
    }
    const lines = text.split("\n");
    for (const index of [...hitLines].sort((a, b) => a - b)) {
      const line = (lines[index] ?? "").trim();
      const excuse = ALLOWED_DELETES.find((entry) => !used.has(entry) && entry.file === path && entry.line === line);
      if (excuse === undefined) offenders.push(`${path}:${String(index + 1)}: ${line}`);
      else used.add(excuse);
    }
  }
  const unused = ALLOWED_DELETES.filter((entry) => !used.has(entry)).map((entry) => `${entry.file}: ${entry.line}`);
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

test("the four lock releases pass, wherever their lines sit", () => {
  const leasePath = "core/src/execution/operation-lease.ts";
  const lockPath = "core/src/persistence/attempt-lock.ts";
  const real = [leasePath, lockPath].map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf8") }));
  assert.deepEqual(fenceHits(real), { offenders: [], unused: [] });

  // The same calls at other line numbers: the allowlist is keyed by line text, not position.
  const moved = [
    { path: leasePath, text: "\n\n    if (old !== null) await unlink(pathFor(directory));\n\n      await unlink(pathFor(directory));" },
    { path: lockPath, text: "\n  await unlink(lockPath);\n\n\n\n        await unlink(this.lockPath);" },
  ];
  assert.deepEqual(fenceHits(moved), { offenders: [], unused: [] });
});

test("a fifth delete is flagged, even when it copies an allowed line", () => {
  const relate = { path: "core/src/workflow/relate.ts", text: 'import { unlink } from "node:fs/promises";\n  await unlink(lockPath);' };
  const lock = {
    path: "core/src/persistence/attempt-lock.ts",
    text: "  await unlink(lockPath);\n  await unlink(this.lockPath);\n  await unlink(lockPath);",
  };
  const lease = {
    path: "core/src/execution/operation-lease.ts",
    text: "if (old !== null) await unlink(pathFor(directory));\nawait unlink(pathFor(directory));",
  };
  assert.deepEqual(fenceHits([relate, lock, lease]), {
    offenders: ["core/src/workflow/relate.ts:2: await unlink(lockPath);", "core/src/persistence/attempt-lock.ts:3: await unlink(lockPath);"],
    unused: [],
  });
});

test("an allowlisted release that disappears leaves a stale entry, not a silent pass", () => {
  const lease = { path: "core/src/execution/operation-lease.ts", text: "await unlink(pathFor(directory));" };
  assert.deepEqual(fenceHits([lease]).unused, [
    "core/src/execution/operation-lease.ts: if (old !== null) await unlink(pathFor(directory));",
    "core/src/persistence/attempt-lock.ts: await unlink(lockPath);",
    "core/src/persistence/attempt-lock.ts: await unlink(this.lockPath);",
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
