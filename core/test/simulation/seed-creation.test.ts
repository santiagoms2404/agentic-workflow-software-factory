import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { seedCommand } from "../../src/cli/commands/seed.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { seedFixture } from "../fixtures/seeded-continuation.ts";

// These are isolated crash-cut stores. No retained factory attempt is opened.
test("seed creation journal survives a missing status projection without becoming an ordinary task", async () => {
  const world = await seedFixture();
  const created = await seedCommand({ ...world.seedOptions, instruction: "Retain the inherited behavior." });
  const dir = created.attemptDir!;
  const before = readFileSync(join(dir, "journal.jsonl"));
  // The on-disk cut after durable creation append but before status replacement.
  unlinkSync(join(dir, "status.json"));
  await assert.rejects(startCommand({ attemptDir: dir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) }), /no attempt status/);
  await assert.rejects(newCommand({ stateRoot: world.stateRoot, project: world.config.project.slug, taskId: "target", repository: world.repository,
    request: "cannot overwrite seed", workflow: "build-review", tier: 2 }), /already has attempt/);
  assert.deepEqual(readFileSync(join(dir, "journal.jsonl")), before);
  const event = JSON.parse(before.toString("utf8")).event;
  assert.equal(event.evidence.type, "candidate-seed");
  assert.equal(event.next.seed.ownerAmendment.text, "Retain the inherited behavior.");
  assert.equal(event.next.worktree, null);
});

test("a concurrent seed creation cannot claim the same target while confirmation is pending", async () => {
  const world = await seedFixture();
  let entered!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { entered = resolve; });
  const confirmed = new Promise<void>((resolve) => { release = resolve; });
  const first = seedCommand({ ...world.seedOptions, terminal: { ...world.seedOptions.terminal, confirm: async () => {
    entered(); await confirmed; return true;
  } } });
  await pending;
  const second = await seedCommand(world.seedOptions);
  const bytes = readFileSync(join(second.attemptDir!, "journal.jsonl"));
  release();
  await assert.rejects(first, /target already exists/);
  assert.deepEqual(readFileSync(join(second.attemptDir!, "journal.jsonl")), bytes);
});

test("worktree collision after seed creation is a refusal that retains existing bytes", async () => {
  const world = await seedFixture();
  const created = await seedCommand(world.seedOptions);
  const root = join(world.root, "targets");
  // createWorktree owns the exact session-id directory and must never adopt it.
  const path = join(root, created.status!.sessionId);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "partial.txt"), "retained foreign bytes");
  await assert.rejects(startCommand({ attemptDir: created.attemptDir!, configPath: world.configPath, worktreeRoot: root,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) }));
  assert.equal(readFileSync(join(path, "partial.txt"), "utf8"), "retained foreign bytes");
});
