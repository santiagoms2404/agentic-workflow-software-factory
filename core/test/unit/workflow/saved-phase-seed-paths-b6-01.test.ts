import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { PhaseRecovery } from "../../../src/contracts/phase-recovery.ts";
import { systemGitRunner } from "../../../src/git/changes.ts";
import { verifyRecoveryWorktree } from "../../../src/workflow/phase-recovery.ts";
import { ResultSnapshotUnavailable, savedResultTreeDigest, savedResultTreeDigestOrSkip } from "../../../src/workflow/saved-phase-result.ts";

// B6-01: the saved-result digest walked the seeded `node_modules` (about 137 MB
// in this repository) and threw past its 64 MiB ceiling, so no result-ready
// checkpoint was ever written. A lowered ceiling stands in for 64 MiB here.
const LIMIT = 4 * 1024;
const SEEDS = ["node_modules"] as const;

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** A canonical repository and one detached, registered worktree carrying a seeded directory past LIMIT. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-saved-seed-paths-"));
  const canonical = join(root, "canonical");
  const worktree = join(root, "worktree");
  execFileSync("git", ["init", "-q", "-b", "main", canonical]);
  writeFileSync(join(canonical, "README.md"), "base\n");
  writeFileSync(join(canonical, ".gitignore"), "node_modules/\n");
  git(canonical, "add", "README.md", ".gitignore");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", "test: seed fixture");
  git(canonical, "worktree", "add", "-q", "--detach", worktree);
  mkdirSync(join(worktree, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(worktree, "node_modules", "pkg", "index.js"), "x".repeat(LIMIT * 3));
  writeFileSync(join(worktree, "README.md"), "the agent's reply\n");
  return { root, canonical, worktree, gitRunner: systemGitRunner(worktree),
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("B6-01: a worktree whose only bulk is a seeded path gets a digest under the byte ceiling", async () => {
  const fixture = world();
  try {
    // Without the exclusion this same tree is over the ceiling, which is the
    // exact refusal production swallowed.
    await assert.rejects(savedResultTreeDigest(fixture.worktree, fixture.gitRunner, [], { maxBytes: LIMIT }), ResultSnapshotUnavailable);
    let digest = "";
    await assert.doesNotReject(async () => { digest = await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT }); });
    assert.match(digest, /^[0-9a-f]{64}$/);
  } finally { fixture.dispose(); }
});

test("B6-01: a worktree over the ceiling outside the seed paths still refuses", async () => {
  const fixture = world();
  try {
    writeFileSync(join(fixture.worktree, "generated.bin"), "y".repeat(LIMIT + 1));
    await assert.rejects(savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT }),
      (error: unknown) => error instanceof ResultSnapshotUnavailable && /exceeds 4096 bytes outside runtime\.seed_paths/.test(error.message));
  } finally { fixture.dispose(); }
});

test("B6-01: a change inside a seeded path leaves the digest alone; a change elsewhere moves it", async () => {
  const fixture = world();
  try {
    const before = await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT });
    writeFileSync(join(fixture.worktree, "node_modules", "pkg", "index.js"), "z".repeat(LIMIT * 3));
    writeFileSync(join(fixture.worktree, "node_modules", "pkg", "extra.js"), "added\n");
    const seededChange = await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT });
    assert.equal(seededChange, before);
    writeFileSync(join(fixture.worktree, "README.md"), "a different reply\n");
    const ownChange = await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT });
    assert.notEqual(ownChange, before);
  } finally { fixture.dispose(); }
});

test("B6-01: a result-ready snapshot skip is journaled with its reason, not swallowed; a snapshot journals nothing", async () => {
  const fixture = world();
  try {
    const skipped: string[] = [];
    const journal = async (reason: string) => { skipped.push(reason); };
    writeFileSync(join(fixture.worktree, "generated.bin"), "y".repeat(LIMIT + 1));
    assert.equal(await savedResultTreeDigestOrSkip(fixture.worktree, fixture.gitRunner, SEEDS, journal, { maxBytes: LIMIT }), null);
    assert.deepEqual(skipped, ["saved-result tree exceeds 4096 bytes outside runtime.seed_paths"]);
    skipped.length = 0;
    // Under the ceiling once the stray output is gone: a digest, and no skip record.
    rmSync(join(fixture.worktree, "generated.bin"));
    const digest = await savedResultTreeDigestOrSkip(fixture.worktree, fixture.gitRunner, SEEDS, journal, { maxBytes: LIMIT });
    assert.equal(digest, await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS, { maxBytes: LIMIT }));
    assert.deepEqual(skipped, []);
  } finally { fixture.dispose(); }
});

test("B6-01: recovery given the same seed paths accepts the checkpointed seeded worktree, and refuses without them", async () => {
  const fixture = world();
  try {
    // The production default ceiling: the seeded bytes are small here, so only
    // the seed list, not the ceiling, can make the two measurements disagree.
    const worktreeDigest = await savedResultTreeDigest(fixture.worktree, fixture.gitRunner, SEEDS);
    const head = git(fixture.worktree, "rev-parse", "HEAD");
    const status = { worktree: fixture.worktree, repository: fixture.canonical, baseSha: head } as unknown as AttemptStatus;
    const checkpoint = { pending: { worktreeDigest }, worktreeHeadSha: head, integrationBaseSha: git(fixture.canonical, "rev-parse", "HEAD"),
      commonGitDir: realpathSync(join(fixture.canonical, ".git")), repository: realpathSync(fixture.canonical),
      worktree: realpathSync(fixture.worktree) } as unknown as PhaseRecovery;
    assert.equal(await verifyRecoveryWorktree(status, checkpoint, SEEDS), null);
    await assert.rejects(verifyRecoveryWorktree(status, checkpoint, []), /saved reply worktree or index bytes changed/);
  } finally { fixture.dispose(); }
});
