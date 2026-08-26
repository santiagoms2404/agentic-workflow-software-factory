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
  /\bauto[-_]?delete\b/i,
  /worktree\s+(?:remove|prune)\b/,
  ...DESTRUCTIVE_REFSPEC_PATTERNS,
];

test("no force/auto-delete paths in core/src", () => {
  const files = walkFiles(join(repoRoot(), "core", "src"));
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (FORBIDDEN.some((p) => p.test(src))) offenders.push(relRepo(f));
  }
  assert.deepEqual(offenders, []);
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
