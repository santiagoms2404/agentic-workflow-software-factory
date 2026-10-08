import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PermissionSession } from "../../src/policy/sandbox-broker.ts";
import { reviewDiffPrompt } from "../../src/workflow/review-diff-delivery.ts";
import { reviewDeliveryFixture } from "../fixtures/review-diff-delivery.ts";

test("a capped review's real bwrap readonly phase reads the full delivered file but cannot write it or see retained state", async () => {
  const world = await reviewDeliveryFixture();
  try {
    const context = world.composed.context;
    const delivery = context.diffDelivery!;
    const runtime = join(world.location.attemptDir, "private", "reviewer");
    mkdirSync(runtime);
    const hidden = join(world.location.stateRoot, "hidden.txt");
    writeFileSync(hidden, "not review evidence");
    const permissions = new PermissionSession({ canonicalRepository: world.location.repository,
      worktree: world.location.worktree, sessionRuntime: runtime, stateRoot: world.location.stateRoot,
      profile: "readonly", tools: ["read", "grep", "find", "ls"], writes: [], protectedPaths: [],
      readOnlyRoots: [delivery.directory], platform: "linux" });
    assert.deepEqual(permissions.profile.tools, ["read", "grep", "find", "ls"]);
    const file = delivery.files.find(file => file.inlineOmitted)!;
    const path = join(delivery.directory, file.file);
    // A host-authored probe process, not an exec tool granted to the reviewer.
    // Deliberately attempts writes despite 0400: EROFS proves the mount, not DAC.
    const program = `const fs = require('node:fs');
      const file = process.argv[1], hidden = process.argv[2];
      const bytes = fs.readFileSync(file); let writeError = null;
      try { fs.writeFileSync(file, 'overwrite'); } catch (error) { writeError = error.code; }
      let createError = null;
      try { fs.writeFileSync(file + '.extra', 'new'); } catch (error) { createError = error.code; }
      console.log(JSON.stringify({ bytes: bytes.length, writeError, createError, hidden: fs.existsSync(hidden) }));`;
    const spec = { executable: process.execPath, argv: ["-e", program, path, hidden], cwd: world.location.worktree,
      env: { PATH: process.env.PATH! }, stdin: reviewDiffPrompt(context), shell: false as const };
    const grant = permissions.sandbox(spec);
    assert.equal(grant.mechanism, "linux-bwrap", "this journey requires real bwrap, not a tool-policy fallback");
    assert.equal(grant.spec.shell, false);
    assert.ok(grant.spec.argv.includes(delivery.directory));
    const bind = grant.spec.argv.indexOf(delivery.directory);
    assert.equal(grant.spec.argv[bind - 1], "--ro-bind");
    assert.deepEqual(grant.writableRoots, [runtime]);
    const output = execFileSync(grant.spec.executable, [...grant.spec.argv], { cwd: grant.spec.cwd, env: grant.spec.env, encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), { bytes: file.bytes, writeError: "EROFS", createError: "EROFS", hidden: false });
    assert.equal(readFileSync(path).length, file.bytes);
    permissions.enforce();
  } finally { world.cleanup(); }
});
