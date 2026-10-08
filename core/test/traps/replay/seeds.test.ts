import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { StartPreflightRefused } from "../../../src/cli/commands/start.ts";
import { reworkCommand } from "../../../src/cli/commands/rework.ts";
import { SEEDS, type Seed } from "../../../src/traps/seeds.ts";
import { k1Request, refusals } from "../../fixtures/k1-preflight.ts";
import { OWNER, box, draft, git, prepare, start, update, type Box } from "./fixture.ts";
import { launchEnvironmentRefusal } from "../../fixtures/launch-environment.ts";
import { runStartQuota } from "../../fixtures/run-start-quota.ts";
import { shiftTicketPathRefusal } from "../../fixtures/shift-ticket-paths.ts";
import { placementRefusal } from "../../fixtures/missing-placement.ts";
import { adoptionRefusal, baselineRefusal, continuityRefusal, laterGrantRefusal } from "../../fixtures/trap-remainder.ts";

async function assertNoCall(b: Box, attemptDir: string, lifecycleState = "DRAFT") {
  const status = await readAttempt(attemptDir);
  assert.equal(status.lifecycleState, lifecycleState);
  assert.equal(status.budget.callsReserved, 0);
  assert.equal(status.budget.callsSpent, 0);
  assert.equal(b.calls.length, 0);
  assert.equal(b.adapters.reduce((n, adapter) => n + adapter.launches, 0), 0);
  if (lifecycleState === "DRAFT") assert.equal(status.worktree, null);
}

async function k1(seed: Seed) {
  const b = box();
  try {
    const request = seed.replay === "protected-paths"
      ? k1Request("read core/src/execution/transport-broker.ts before deciding whether to change it", "core/src/example.ts")
      : k1Request("replay DrvFs mode storage", "core/src/example.ts");
    const created = await draft(b, request);
    await prepare(b, created.attemptDir);
    if (seed.replay === "git-storage") {
      const common = git(b.repository, "rev-parse", "--path-format=absolute", "--git-common-dir");
      for (const path of [join(common, "HEAD"), join(common, "config"), b.worktreeRoot]) chmodSync(path, 0o777);
    }
    await assert.rejects(start(b, created.attemptDir), StartPreflightRefused);
    const record = (await refusals(created.attemptDir)).at(-1)!;
    assert.equal(record.refusal, "field-failed");
    assert.equal(record.field, seed.replay);
    assert.match(record.reason, seed.replay === "protected-paths" ? /protected.*unclassified/u : /DrvFs/u);
    await assertNoCall(b, created.attemptDir);
    assert.ok(readdirSync(b.worktreeRoot).every(name => name.startsWith("awsf-baseline-")));
  } finally { b.close(); }
}

test("S27 partial refusal: its original one-line request cannot prepare a shift", async () => {
  const b = box();
  try {
    const created = await draft(b, "Run the selected milestone and change its plan", "shift", true);
    const prepared = await prepare(b, created.attemptDir);
    assert.equal(prepared.record.fields.find(field => field.id === "request-shape")!.passed, false);
    await assert.rejects(start(b, created.attemptDir), StartPreflightRefused);
    assert.equal((await refusals(created.attemptDir)).at(-1)!.refusal, "field-failed");
    await assertNoCall(b, created.attemptDir);
  } finally { b.close(); }
});

async function interruptedStart() {
  const b = box();
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    const tree = join(b.worktreeRoot, created.status.sessionId);
    mkdirSync(tree);
    writeFileSync(join(tree, "retained.txt"), "interrupted seeding evidence\n");
    await assert.rejects(start(b, created.attemptDir), { name: "AttemptWorktreeExists" });
    assert.equal(readFileSync(join(tree, "retained.txt"), "utf8"), "interrupted seeding evidence\n");
    await assertNoCall(b, created.attemptDir);
  } finally { b.close(); }
}

async function configuration() {
  const b = box();
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    const prepared = await start(b, created.attemptDir);
    await update(b, created.attemptDir, { lifecycleState: "AWAITING_OWNER", candidateSha: prepared.baseSha });
    const changed = structuredClone(b.config);
    changed.observability.poll_ms += 1;
    await assert.rejects(reworkCommand({ attemptDir: created.attemptDir, stateRoot: b.stateRoot,
      config: changed, configPath: b.configPath, defect: "remove duplicate whitespace in core/src/example.ts", terminal: OWNER,
      infrastructure: b.infrastructure }), { name: "ProductionConfigSnapshotMismatch" });
    await assertNoCall(b, created.attemptDir, "AWAITING_OWNER");
  } finally { b.close(); }
}

async function cwd() {
  const b = box();
  try {
    const created = await draft(b);
    assert.equal(created.status.repository, b.repository);
    await assertNoCall(b, created.attemptDir);
    // G07 has no predicate measuring the caller's intent and is not a stop.
  } finally { b.close(); }
}

const REPLAYS: Record<string, (seed: Seed) => Promise<void>> = {
  "protected-paths": k1, "git-storage": k1, launch: async () => { await launchEnvironmentRefusal(); },
  quota: async () => { await runStartQuota({ id: "TR-14", condition: "exhausted" }); }, shift: () => shiftTicketPathRefusal(),
  configuration, continuity: continuityRefusal, "interrupted-start": interruptedStart, cwd,
  baseline: baselineRefusal, "later-grant": laterGrantRefusal, adoption: adoptionRefusal,
  placement: () => placementRefusal(),
};
for (const seed of SEEDS.filter(seed => seed.replay !== null)) {
  test(`${seed.id}: ${seed.outcome} — ${seed.replay}`, async () => {
    const replay = REPLAYS[seed.replay!];
    assert.ok(replay, `missing replay for ${seed.id}`);
    await replay(seed);
  });
}

test("every refusal has a registered replay and no gap remains", () => {
  assert.equal(SEEDS.filter(seed => seed.outcome === "gap").length, 0);
  const candidates = SEEDS.filter(seed => seed.outcome === "refused");
  assert.equal(candidates.length, 14);
  for (const seed of candidates) assert.ok(seed.replay && REPLAYS[seed.replay], seed.id);
});
