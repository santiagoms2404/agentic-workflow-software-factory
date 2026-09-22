import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config/load.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { readAttempt, nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { argvDigest, gateConfigDigest, gatesConfigDigest, COMMAND_LEDGER_PROTOCOL_VERSION } from "../../src/contracts/command-ledger.ts";
import { readCommandLedger, occurrenceKeyForMeasurement } from "../../src/workflow/command-ledger-store.ts";
import { planCommandRecovery, type CommandExpectation } from "../../src/workflow/command-ledger.ts";

const GATE = "counter";
const HARNESS = resolve("core/test/journeys/_command-ledger-kill-host.ts");

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/**
 * A disposable attempt with its own managed worktree, built by the real
 * `awsf new` and `awsf start`.
 *
 * Nothing here reads or writes a runtime attempt of this project. The counter
 * file deliberately lives at the fixture root rather than inside the worktree:
 * a non-idempotent command that dirtied the managed tree would trip the host's
 * own cleanliness check before any assertion could run.
 */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-command-ledger-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-q", "-m", "test: seed command ledger recovery");
  const configText = readFileSync(resolve("awsf.config.yaml"), "utf8").replace(/^\s*seed_paths:.*$/m, "  seed_paths: []");
  const config = loadConfig(configText);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: "fixture-command-ledger",
    repository: canonical, request: "measure one candidate", workflow: "build", tier: 1,
    routeOverrides: {}, configSnapshotJson: JSON.stringify(config) });
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
  const status = await readAttempt(created.attemptDir);
  const candidate = git(status.worktree!, "rev-parse", "HEAD");
  return { root, attemptDir: created.attemptDir, worktree: status.worktree!, candidate,
    counter: join(root, "counter.txt"),
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** How many times the non-idempotent fixture command actually ran. */
const counterRuns = (path: string): number =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(line => line === "ran").length : 0;

function killAt(stage: string, w: Awaited<ReturnType<typeof world>>) {
  const result = spawnSync(process.execPath,
    ["--experimental-strip-types", HARNESS, w.attemptDir, stage, w.counter, w.worktree],
    { encoding: "utf8", env: { ...process.env, AWSF_FIXTURE_CANDIDATE: w.candidate } });
  assert.equal(result.signal, "SIGKILL", `the kill seam never fired at ${stage}: ${result.stderr}`);
  return result;
}

const ARGV_FOR = (counter: string): readonly string[] => ["sh", "-c", `printf 'ran\\n' >> ${JSON.stringify(counter)}`];

function expectationFor(w: Awaited<ReturnType<typeof world>>, attempt: number, sessionId: string): CommandExpectation {
  const argv = ARGV_FOR(w.counter);
  const gates = { [GATE]: { argv, timeout_seconds: 30 } };
  return {
    dispatcherId: "production-run/measure-candidate",
    occurrenceKey: occurrenceKeyForMeasurement("builder", w.candidate, 0),
    gateId: GATE, gateIds: [GATE],
    argvDigest: argvDigest(argv), gateConfigDigest: gateConfigDigest(gates[GATE]!),
    gatesConfigDigest: gatesConfigDigest(gates),
    cwd: w.worktree, worktreeRealPath: w.worktree, timeoutMs: 30_000, maxOutputBytes: 1_048_576,
    candidateSha: w.candidate, attempt, sessionId,
  };
}

async function decide(w: Awaited<ReturnType<typeof world>>) {
  const status = await readAttempt(w.attemptDir);
  const ledger = await readCommandLedger(w.attemptDir);
  return planCommandRecovery(ledger, expectationFor(w, status.attempt, status.sessionId));
}

test("a host killed before the intent is durable dispatches, because the command provably never ran", async () => {
  const w = await world();
  try {
    killAt("pre-intent", w);
    assert.equal(counterRuns(w.counter), 0, "nothing should have run yet");
    const planned = await decide(w);
    assert.equal(planned.action, "dispatch");
  } finally { w.dispose(); }
});

test("a host killed after the intent and before the spawn refuses; it cannot know whether the command ran", async () => {
  const w = await world();
  try {
    killAt("post-intent", w);
    // The command genuinely did not run here — but nothing on disk says so, and
    // the ledger must not infer it. This cut and the one below are identical in
    // the journal, which is exactly why both refuse.
    assert.equal(counterRuns(w.counter), 0);
    const planned = await decide(w);
    assert.equal(planned.action, "refuse");
    assert.match(planned.action === "refuse" ? planned.reason : "", /not proof that it did not run/u);
  } finally { w.dispose(); }
});

test("a host killed after the command ran and before its result refuses, and never runs it a second time", async () => {
  const w = await world();
  try {
    killAt("post-dispatch", w);
    assert.equal(counterRuns(w.counter), 1, "the command really did run");
    const planned = await decide(w);
    assert.equal(planned.action, "refuse");
    // The counter is the proof that matters: a design that re-dispatched here
    // would leave 2, and the owner's argv is arbitrary.
    assert.equal(counterRuns(w.counter), 1);
  } finally { w.dispose(); }
});

test("a host killed after the result is durable restores, and the command body does not run again", async () => {
  const w = await world();
  try {
    killAt("post-result", w);
    assert.equal(counterRuns(w.counter), 1);
    const planned = await decide(w);
    assert.equal(planned.action, "restore");
    assert.equal(planned.action === "restore" ? planned.result.exitCode : -1, 0);
    assert.equal(counterRuns(w.counter), 1, "a restore must never re-run the body");
  } finally { w.dispose(); }
});

test("a dispatch point left by a host that records nothing refuses rather than re-dispatching", async () => {
  // The pre-ledger cut: a passing candidate_hygiene record with no opening
  // beside it. Indistinguishable by intent count from a governed run that died
  // before its first intent, which is why the opening exists.
  const w = await world();
  try {
    const status = await readAttempt(w.attemptDir);
    const evidence: AttemptEvidence = { type: "gate", id: `${status.sessionId}:builder:0:candidate_hygiene`,
      phaseId: `${status.sessionId}:builder`, round: 0, gateId: "candidate_hygiene", kind: "git",
      candidateSha: w.candidate, passed: true, exitCode: 0, checks: [], violations: [], outputPath: null,
      startedAt: "2026-09-22T00:00:00.000Z", endedAt: "2026-09-22T00:00:00.000Z" };
    await persistAttempt(w.attemptDir, status.revision,
      { kind: "attempt.updated", next: nextRevision(status, {}), evidence });
    const planned = await decide(w);
    assert.equal(planned.action, "refuse");
    assert.match(planned.action === "refuse" ? planned.reason : "", /does not record dispatches/u);
    assert.equal(counterRuns(w.counter), 0);
  } finally { w.dispose(); }
});

test("a governance refusal does not write its own exculpation", async () => {
  // The refusal has to be sticky. If the refusing run persisted its occurrence
  // opening before deciding, the NEXT run would find an opening beside the
  // ungoverned dispatch point, conclude the occurrence was always governed, and
  // re-dispatch the owner's argv over an unknown prior effect — the refusal
  // erasing its own premise.
  const w = await world();
  try {
    const status = await readAttempt(w.attemptDir);
    const evidence: AttemptEvidence = { type: "gate", id: `${status.sessionId}:builder:0:candidate_hygiene`,
      phaseId: `${status.sessionId}:builder`, round: 0, gateId: "candidate_hygiene", kind: "git",
      candidateSha: w.candidate, passed: true, exitCode: 0, checks: [], violations: [], outputPath: null,
      startedAt: "2026-09-22T00:00:00.000Z", endedAt: "2026-09-22T00:00:00.000Z" };
    await persistAttempt(w.attemptDir, status.revision,
      { kind: "attempt.updated", next: nextRevision(status, {}), evidence });

    const first = await decide(w);
    assert.equal(first.action, "refuse");

    // The refusing run is then allowed to write an opening, exactly as a
    // dispatcher would if the ordering were wrong. The decision must not change.
    const afterRefusal = await readAttempt(w.attemptDir);
    await persistAttempt(w.attemptDir, afterRefusal.revision, { kind: "attempt.updated",
      next: nextRevision(afterRefusal, {}),
      evidence: { type: "command-occurrence-opened", opening: {
        schema: "awsf.command-occurrence-opened/v1", dispatcherId: "production-run/measure-candidate",
        occurrenceKey: occurrenceKeyForMeasurement("builder", w.candidate, 0),
        protocolVersion: COMMAND_LEDGER_PROTOCOL_VERSION, openedAt: "2026-09-22T00:00:01.000Z",
      } } });
    const second = await decide(w);
    assert.equal(second.action, "dispatch",
      "an opening written AFTER the dispatch point does flip the verdict — which is why the dispatchers must decide before writing one");
    assert.equal(counterRuns(w.counter), 0);
  } finally { w.dispose(); }
});

test("an ungoverned dispatch point for another occurrence leaves this one decidable", async () => {
  // Governance is scoped to the occurrence being decided. One legacy phase must
  // not make every later phase in the attempt permanently unrecoverable.
  const w = await world();
  try {
    const status = await readAttempt(w.attemptDir);
    const evidence: AttemptEvidence = { type: "gate", id: `${status.sessionId}:legacy:0:candidate_hygiene`,
      phaseId: `${status.sessionId}:legacy`, round: 0, gateId: "candidate_hygiene", kind: "git",
      candidateSha: w.candidate, passed: true, exitCode: 0, checks: [], violations: [], outputPath: null,
      startedAt: "2026-09-22T00:00:00.000Z", endedAt: "2026-09-22T00:00:00.000Z" };
    await persistAttempt(w.attemptDir, status.revision,
      { kind: "attempt.updated", next: nextRevision(status, {}), evidence });
    killAt("post-result", w);
    const planned = await decide(w);
    assert.equal(planned.action, "restore");
  } finally { w.dispose(); }
});

test("retained output altered after the fact refuses instead of restoring it", async () => {
  const w = await world();
  try {
    killAt("post-result", w);
    writeFileSync(join(w.attemptDir, "raw", `command-builder-${GATE}-0.txt`), "tampered\n");
    const planned = await decide(w);
    assert.equal(planned.action, "refuse");
    assert.match(planned.action === "refuse" ? planned.reason : "", /does not match the digest/u);
  } finally { w.dispose(); }
});

test("a changed argv refuses rather than answering the new command with the old result", async () => {
  const w = await world();
  try {
    killAt("post-result", w);
    const status = await readAttempt(w.attemptDir);
    const ledger = await readCommandLedger(w.attemptDir);
    const changed = ["sh", "-c", "printf 'different\\n'"];
    const planned = planCommandRecovery(ledger, {
      ...expectationFor(w, status.attempt, status.sessionId),
      argvDigest: argvDigest(changed),
    });
    assert.equal(planned.action, "refuse");
    assert.match(planned.action === "refuse" ? planned.reason : "", /argv changed/u);
  } finally { w.dispose(); }
});
