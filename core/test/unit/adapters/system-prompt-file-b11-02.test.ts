import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import {
  assertSystemPromptSlot,
  SYSTEM_PROMPT_FILE_NAME,
  writeSystemPromptFile,
} from "../../../src/adapters/system-prompt-file.ts";
import { DEFAULT_INFRASTRUCTURE } from "../../../src/cli/commands/production-run.ts";

/**
 * B11-02: the session runtime is bound writable into the provider sandbox, so
 * an agent can plant `<runtime>/system-prompt.md` as a link to a host file. A
 * relaunch into that runtime must refuse it rather than write and chmod the
 * target as the AWSF user.
 */

const HOST_CONTENT = "host content that must not be overwritten\n";

async function plantedRuntime(): Promise<{ runtime: string; target: string; slot: string }> {
  const root = await mkdtemp(join(tmpdir(), "awsf-b11-02-"));
  const runtime = join(root, "private", "review");
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  // The target sits outside the runtime, where the sandbox has no business writing.
  const target = join(root, "host-target.txt");
  await writeFile(target, HOST_CONTENT);
  await chmod(target, 0o644);
  const slot = join(runtime, SYSTEM_PROMPT_FILE_NAME);
  await symlink(target, slot);
  return { runtime, target, slot };
}

test("a symlink planted at the prompt path is refused and its target is left untouched", async () => {
  const { runtime, target, slot } = await plantedRuntime();

  await assert.rejects(writeSystemPromptFile("SYSTEM PROMPT TEXT", runtime), /not a plain file|E_REDACTION|ELOOP/);

  assert.equal(await readFile(target, "utf8"), HOST_CONTENT);
  if (platform !== "win32") assert.equal((await stat(target)).mode & 0o777, 0o644);
  assert.equal((await lstat(slot)).isSymbolicLink(), true);
});

test("the containment check refuses the planted link before any write, with E_REDACTION", async () => {
  const { runtime, target } = await plantedRuntime();

  await assert.rejects(assertSystemPromptSlot("claude-code", runtime), (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "E_REDACTION");
    assert.equal((error as { adapter?: unknown }).adapter, "claude-code");
    return true;
  });
  assert.equal(await readFile(target, "utf8"), HOST_CONTENT);
});

test("a hard link to a host file is refused like a symlink", async (t) => {
  const { link } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "awsf-b11-02-hard-"));
  const runtime = join(root, "runtime");
  await mkdir(runtime, { recursive: true });
  const target = join(root, "host-target.txt");
  await writeFile(target, HOST_CONTENT);
  try {
    await link(target, join(runtime, SYSTEM_PROMPT_FILE_NAME));
  } catch {
    t.skip("hard links are not available on this filesystem");
    return;
  }

  await assert.rejects(writeSystemPromptFile("SYSTEM PROMPT TEXT", runtime), /not a plain file/);
  assert.equal(await readFile(target, "utf8"), HOST_CONTENT);
});

test("a relaunch rewrites the regular prompt file an earlier launch left, privately and in place", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "awsf-b11-02-relaunch-"));
  const first = await writeSystemPromptFile("a much longer first system prompt than the second one", runtime);
  const before = await stat(first);

  const second = await writeSystemPromptFile("second prompt", runtime);

  assert.equal(second, join(runtime, SYSTEM_PROMPT_FILE_NAME));
  assert.equal(await readFile(second, "utf8"), "second prompt");
  // Rewritten in place, not deleted and recreated.
  assert.equal((await stat(second)).ino, before.ino);
  if (platform !== "win32") assert.equal((await stat(second)).mode & 0o777, 0o600);
});

test("a relaunch rewrite also tightens a prompt file left with a loose mode", { skip: platform === "win32" }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), "awsf-b11-02-mode-"));
  const slot = join(runtime, SYSTEM_PROMPT_FILE_NAME);
  await writeFile(slot, "old");
  await chmod(slot, 0o644);

  await writeSystemPromptFile("new", runtime);

  assert.equal((await stat(slot)).mode & 0o777, 0o600);
  assert.equal(await readFile(slot, "utf8"), "new");
});

test("the production relaunch writer refuses the planted link and still rewrites a regular file", async () => {
  // The production relaunch writes the prompt through `infra.writeSystemPrompt`;
  // its default IS the exported safe writer, not a look-alike that could drift.
  assert.equal(DEFAULT_INFRASTRUCTURE.writeSystemPrompt, writeSystemPromptFile);
  const { runtime, target } = await plantedRuntime();
  await assert.rejects(DEFAULT_INFRASTRUCTURE.writeSystemPrompt("SYSTEM PROMPT TEXT", runtime), /not a plain file|ELOOP/);
  assert.equal(await readFile(target, "utf8"), HOST_CONTENT);

  const clean = await mkdtemp(join(tmpdir(), "awsf-b11-02-production-"));
  await DEFAULT_INFRASTRUCTURE.writeSystemPrompt("first", clean);
  const path = await DEFAULT_INFRASTRUCTURE.writeSystemPrompt("second", clean);
  assert.equal(await readFile(path, "utf8"), "second");
});
