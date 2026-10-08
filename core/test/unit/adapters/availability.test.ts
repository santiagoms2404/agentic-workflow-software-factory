import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { AntigravityAdapter } from "../../../src/adapters/antigravity.ts";
import { registeredAdapter } from "../../../src/adapters/registry.ts";
import { filterEnv } from "../../../src/adapters/env.ts";
import { resolveExecutable } from "../../../src/execution/transport-broker.ts";

for (const Adapter of [ClaudeCodeAdapter, PiCodexAdapter]) {
  test(`${Adapter.name} checks the descriptor environment and retains obstructions without spawning`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-availability-"));
    try {
      const executable = "synthetic-cli";
      const path = join(root, executable);
      // Invalid program bytes are sufficient: availability must never execute them.
      writeFileSync(path, "not a program\n", { mode: 0o700 });
      const adapter = new Adapter({ executable });
      const env = { PATH: root, HOME: root, EXTRA: "not passed" };
      const available = await adapter.isAvailable(undefined, env);
      assert.deepEqual(available, { status: "available", executable, path: root, resolved: path });
      const spec = adapter.buildSpec({ model: Adapter === ClaudeCodeAdapter ? "claude-opus-5" : "gpt-5-codex",
        prompt: "test", cwd: root, env });
      assert.deepEqual(spec.env, filterEnv(adapter.id, env));
      assert.equal(resolveExecutable(spec.executable, spec.env), available.resolved);
      assert.equal((await new Adapter({ executable: "" }).isAvailable(undefined, env)).status, "blocked");
      assert.equal((await new Adapter({ executable: "relative/cli" }).isAvailable(undefined, env)).status, "blocked");
      const missing = await adapter.isAvailable(undefined, { PATH: "" });
      assert.equal(missing.status, "blocked");
      assert.equal(missing.code, "ExecutableNotFound");
      assert.equal(missing.path, "");
      assert.deepEqual(missing.obstructions, []);
      assert.match(missing.detail!, /launch PATH=""/u);
      chmodSync(path, 0o600);
      const obstructed = await adapter.isAvailable(undefined, env);
      assert.equal(obstructed.status, "blocked");
      assert.ok(obstructed.obstructions?.some(detail => detail.includes("EACCES")));
      assert.match(obstructed.detail!, /search was obstructed/u);
      // An explicit absolute executable is also checked by the broker's resolver.
      chmodSync(path, 0o700);
      assert.equal((await new Adapter({ executable: path }).isAvailable(undefined, { PATH: "" })).resolved, path);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("Antigravity resolves its configured executable but never graduates its unverified route", async () => {
  const adapter = registeredAdapter({ agy: { kind: "antigravity", executable: process.execPath } }, "agy")!;
  const available = await adapter.isAvailable(undefined, { PATH: "" });
  assert.equal(available.status, "blocked");
  assert.equal(available.code, "E_ADAPTER_UNVERIFIED");
  assert.equal(available.resolved, process.execPath);
  const missing = await new AntigravityAdapter({ executable: "synthetic-missing-agy" }).isAvailable(undefined, { PATH: "" });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.code, "E_ADAPTER_UNVERIFIED");
  assert.match(missing.detail!, /synthetic-missing-agy.*not runnable.*launch PATH=""/u);
});
