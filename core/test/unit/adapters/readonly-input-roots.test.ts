import assert from "node:assert/strict";
import { test } from "node:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";

const request = { model: "sonnet", prompt: "read delivered evidence; no command may be run", cwd: "/worktree",
  profile: "readonly", tools: ["read", "grep", "find", "ls"], env: { PATH: "/usr/bin" } };
const roots = ["/state/attempt/private/review-diffs/run", "/state/attempt/private/visual-references/run"];

test("Claude dontAsk gets exactly --add-dir for each read-only input root, with no shell or mutating tool", () => {
  const adapter = new ClaudeCodeAdapter();
  const baseline = adapter.buildSpec(request);
  const spec = adapter.buildSpec({ ...request, readOnlyRoots: roots });
  assert.deepEqual(spec.argv, [...baseline.argv, "--add-dir", roots[0], "--add-dir", roots[1]]);
  assert.equal(baseline.argv.includes("--add-dir"), false);
  assert.equal(spec.argv[spec.argv.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(spec.argv[spec.argv.indexOf("--tools") + 1], "Read,Grep,Glob");
  assert.equal(spec.argv[spec.argv.indexOf("--disallowed-tools") + 1], "Bash,Write,Edit,NotebookEdit");
  assert.equal(spec.shell, false);
  assert.equal(spec.argv.includes(request.cwd), false);
  assert.equal(spec.argv.includes("/state"), false);
  assert.equal(spec.argv.includes("/canonical"), false);
});

test("pi needs no argv widening for absolute input paths; readonly still exposes no bash", () => {
  const adapter = new PiCodexAdapter();
  const piRequest = { ...request, model: "codex:gpt-5.6-sol" };
  assert.deepEqual(adapter.buildSpec({ ...piRequest, readOnlyRoots: roots }), adapter.buildSpec(piRequest));
  const spec = adapter.buildSpec(piRequest);
  assert.equal(spec.argv[spec.argv.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.equal(spec.shell, false);
});
