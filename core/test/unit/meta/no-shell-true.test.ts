import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";
import { DRIVING_REL, drivingTextFiles } from "./_driving.ts";

/** Invariant 4: executable + argv array only, and `shell: true` appears nowhere. */
const SHELL_TRUE = /shell\s*:\s*true/;

test("no shell:true in core/src, dashboard/src, or the driving-document tree", () => {
  // The driving tree is in scope because the invariant says "anywhere" and this
  // walk did not. A cookbook that shows a shell-interpolated spawn is teaching
  // the forbidden pattern to the one reader most likely to copy it verbatim.
  const files = [
    ...walkFiles(join(repoRoot(), "core", "src")),
    ...walkFiles(join(repoRoot(), "dashboard", "src")),
    ...drivingTextFiles(),
  ];
  const offenders = files.filter((f) => SHELL_TRUE.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map(relRepo), []);
});

test("the shell:true matcher bites — the driving half of the walk is vacuous until the tree exists", () => {
  // `walkFiles` returns [] for a missing directory, so the sweep above cannot
  // fail on account of `${DRIVING_REL}` today. This is what proves it would.
  assert.ok(SHELL_TRUE.test("await spawn(cmd, { shell: true });"));
  assert.ok(SHELL_TRUE.test("execFile(bin, args, { shell : true })"));
  // Inside a fenced markdown example, which is the shape the widened walk exists for.
  assert.ok(
    SHELL_TRUE.test(["Run it like this:", "```ts", 'spawn("git", argv, { shell: true });', "```"].join("\n")),
    `a fenced example under ${DRIVING_REL} must not slip past the matcher`,
  );
  assert.equal(SHELL_TRUE.test("spawn(cmd, { shell: false })"), false);
});
