import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_walk.ts";
import { DRIVING_REL } from "./_driving.ts";

// AWSF does not read skills. The PROVIDER CLI does, from its working
// directory — and a Claude-route phase's cwd is a managed worktree of this
// repository. So a grep proving `core/src/**` never mentions `.claude` guards
// nothing at all; what matters is whether a discoverable tree is there to find.
//
// The two adapters differ, and the asymmetry is the whole reason the driving
// documents live at `docs/driving/`:
//
//   pi-codex     suppresses discovery explicitly — `--no-skills` and four other
//                clean-room flags, emitted on every launch it builds.
//   claude-code  has no verified equivalent. `buildSpec` sets `cwd` to the
//                worktree and passes no flag that is known to disable project
//                skill or command discovery.
//
// This file holds both halves of that fence.

const PI_DESCRIPTOR_TEST = join(repoRoot(), "core", "test", "unit", "adapters", "pi-codex.test.ts");

test("the repository root contains no .claude/ — this asserts ABSENCE, not isolation", () => {
  // Read the claim precisely. It does not say a worker phase is isolated from
  // owner-tier instructions; nothing in this repository can say that, because
  // whether a CLI exposes a discovered tree is a question about that CLI's
  // gating behaviour. It says there is no tree at the path the CLI would scan.
  // Absence is a weaker property than isolation and it is the one we can hold.
  //
  // The STRICTLY BETTER guard, if it ever lands: a Claude descriptor flag that
  // demonstrably disables project skill and command discovery, added to
  // `buildSpec` and pinned in the claude-code descriptor test in exact argv
  // order, the way pi's `--no-skills` is pinned below. That would be enforced
  // rather than avoided, and it is what would make moving the driving tree from
  // `docs/driving/` to `.claude/` a safe one-commit change. It has not been
  // found and verified, and this repository already refuses to treat an
  // unverified flag as a control (see the `no-tools` comment in
  // `core/src/adapters/claude-code.ts`) — so until then, placement is the
  // control and this line is the fence.
  assert.equal(
    existsSync(join(repoRoot(), ".claude")),
    false,
    `.claude/ exists at the repository root. Every Claude-route phase runs with this tree in ` +
      `its cwd and no verified flag suppresses discovery, so owner-tier documents belong at ` +
      `${DRIVING_REL}/ and are installed by the owner from there.`,
  );
});

test("pi's --no-skills is pinned in the descriptor test's argv order, not carried as a new copy", () => {
  const text = readFileSync(PI_DESCRIPTOR_TEST, "utf8");

  // The five clean-room flags in the order `pi-codex.ts` emits them, as they
  // appear inside the exact-argv assertions. The ORDER is the point: a bare
  // `argv.includes("--no-skills")` satisfies a membership check while the flag
  // drifts to a position that means something else, which is why the adapter
  // contract asks descriptor tests to pin argv exactly.
  const inArgvOrder =
    /"--no-extensions",\s*"--no-skills",\s*"--no-prompt-templates",\s*"--no-themes",\s*"--no-context-files",/g;
  const pins = text.match(inArgvOrder) ?? [];
  assert.ok(
    pins.length > 0,
    "the pi descriptor test no longer pins the clean-room flags in argv order — a membership " +
      "check is not a substitute, so restore the exact-argv assertion rather than adding one",
  );

  // The one occurrence that is NOT an ordered pin is the "four other clean-room
  // flags" loop, which proves the flag is unconditional across profiles rather
  // than incidental to one request shape.
  const flagLoop = /for \(const flag of \[[^\]]*"--no-skills"/;
  assert.ok(flagLoop.test(text), "the unconditional clean-room flag loop is gone");

  // Every other mention would be a copy, and a copy is how a pin quietly turns
  // into decoration: it satisfies a reader looking for the flag while the real
  // argv order goes unwatched. Arithmetic rather than a magic number, so a
  // legitimately new argv assertion moves both sides at once.
  assert.equal(
    (text.match(/--no-skills/g) ?? []).length,
    pins.length + 1,
    "--no-skills is asserted somewhere other than an exact-argv pin and the clean-room flag loop",
  );
});
