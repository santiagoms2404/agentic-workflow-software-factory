import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { loadConfig } from "../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import type { AwsfConfig } from "../../src/config/schema.ts";
import type { ModelRequest, ProcessSpec } from "../../src/adapters/interface.ts";
import type { CandidateAdoptionEvidence } from "../../src/contracts/candidate-adoption.ts";
import { adoptCommand, type AdoptCommandOptions } from "../../src/cli/commands/adopt.ts";
import { nextRevision, persistAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { cancelCommand } from "../../src/cli/commands/cancel.ts";
import { degradeReviewCommand } from "../../src/cli/commands/degrade-review.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { seedCommand } from "../../src/cli/commands/seed.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { runGit, systemGitRunner } from "../../src/git/changes.ts";
import { HOST_AUTHOR } from "../../src/git/commit.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { journalFilePath, statusFilePath } from "../../src/persistence/platform-paths.ts";
import { inspectSeedSource, validateSeedStartup } from "../../src/workflow/candidate-seed.ts";
import { AUTHORED, INHERITED, SeedAdapter, fakeSeedBroker, fixtureIdentity, seedFixture } from "../fixtures/seeded-continuation.ts";

const PROJECT = "agentic-workflow-software-factory";
const AT = "2026-09-27T00:00:00.000Z";
const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const FOREIGN = ["-c", "user.name=Foreign Writer", "-c", "user.email=foreign@example.com"];
const SAME_PROVIDER_REVIEW = ["reviewer=codex/openai-codex/target-review@high"];

/** The seed fixture's scripted adapter, citing its system prompt the way adoption review requires. */
class ReviewAdapter extends SeedAdapter {
  override buildSpec(request: ModelRequest): ProcessSpec {
    return { ...super.buildSpec(request), argv: ["--append-system-prompt", request.systemPromptPath!] };
  }
}

function git(repository: string, ...argv: string[]): string {
  return runGit(systemGitRunner(repository), argv).trim();
}

function commit(repository: string, path: string, text: string, message: string, identity = OWNER): string {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), text);
  git(repository, "add", path);
  git(repository, ...identity, "commit", "--quiet", "--no-gpg-sign", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function owner(lines: string[] = [], confirm: () => Promise<boolean> = async () => true): OwnerTerminal {
  return { interactive: true, write: (line) => { lines.push(line); }, confirm };
}

/** Every commit object, reachable or not, whose second parent is `candidate`. */
function mergesOf(repository: string, candidate: string): string[] {
  return git(repository, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)")
    .split("\n")
    .filter((line) => line.endsWith(" commit"))
    .map((line) => line.split(" ")[0]!)
    .filter((sha) => git(repository, "rev-list", "--parents", "-n", "1", sha).split(" ")[2] === candidate);
}

function refs(repository: string): string {
  return `${git(repository, "for-each-ref", "--format=%(refname) %(objectname)")}\nHEAD ${git(repository, "rev-parse", "HEAD")}`;
}

function sourceBytes(sourceDir: string): Buffer[] {
  return [readFileSync(journalFilePath(sourceDir)), readFileSync(statusFilePath(sourceDir))];
}

function adoptionOf(evidence: Awaited<ReturnType<typeof readAttemptEvidence>>): CandidateAdoptionEvidence {
  const record = evidence.find((entry) => entry.type === "candidate-adoption");
  if (record?.type !== "candidate-adoption") throw new Error("target records no candidate adoption");
  return record.adoption;
}

function fixtureConfig(): AwsfConfig {
  const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  const config: AwsfConfig = {
    ...loaded,
    runtime: { ...loaded.runtime, seed_paths: [] },
    gates: { test: { argv: ["fixture-test"], timeout_seconds: 1 } },
  };
  // The scripted adapters cannot promise transcript retention.
  config.agents = config.agents.map((agent) => ({ ...agent, harness: { ...agent.harness, interrupted_turn: false } }));
  return config;
}

interface StaleWorld {
  readonly root: string;
  readonly repository: string;
  readonly stateRoot: string;
  readonly sourceDir: string;
  readonly base: string;
  readonly candidate: string;
  /** Canonical HEAD after the advance, or the base when there was none. */
  readonly head: string;
  readonly config: AwsfConfig;
  /** A different owner commit over the candidate, for a source substituted mid-adoption. */
  alternate?: string;
}

/**
 * A sealed source whose exact candidate adds core/src/feature.ts over `base`,
 * with canonical HEAD then advanced by one owner commit the candidate never saw.
 */
async function staleSource(options: {
  readonly advance?: { readonly path: string; readonly text: string } | null;
  readonly foreign?: boolean;
} = {}): Promise<StaleWorld> {
  const root = mkdtempSync(join(tmpdir(), "awsf-stale-prefix-"));
  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  git(root, "init", "--quiet", "-b", "main", repository);
  const base = commit(repository, "README.md", "base\n", "base");
  if (options.foreign === true) commit(repository, "core/src/foreign.ts", "export const foreign = 1;\n", "feat: foreign intermediate", FOREIGN);
  const candidate = commit(repository, "core/src/feature.ts", "export const adopted = true;\n", "feat: sealed candidate");
  git(repository, "checkout", "--quiet", "-B", "main", base);
  const advance = options.advance === undefined ? { path: "docs/canonical.md", text: "canonical advance\n" } : options.advance;
  const head = advance === null ? base : commit(repository, advance.path, advance.text, "docs: advance canonical");
  const sourceDir = join(stateRoot, "projects", PROJECT, "tasks", "stale-source", "1");
  await persistSource(sourceDir, repository, base, candidate);
  return { root, repository, stateRoot, sourceDir, base, candidate, head, config: fixtureConfig() };
}

/**
 * A build-review source whose builder succeeded on one settled call, whose host
 * L7 bound `candidate` over `base`, and which the owner then cancelled.
 */
async function persistSource(sourceDir: string, repository: string, base: string, candidate: string): Promise<void> {
  const initial: AttemptStatus = {
    schema: "awsf/attempt-status/v1", sessionId: "stale-source-session", project: PROJECT,
    taskId: "stale-source", continuesTask: null, groupId: null, planRef: null, attempt: 1, repository, worktree: null,
    workflow: "build-review", tier: 2, request: "source intent never transfers",
    configSnapshotJson: "{}", lifecycleState: "RUNNING", baseSha: base, candidateSha: null, phase: null,
    budget: {
      attempt: 1, callsSpent: 1, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 5,
    },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null, lastActivityAt: AT,
    lastActivity: "builder running", nextAction: "wait", gatesPass: false, requiredReviewPresent: false,
    journeyApproved: false, protectedApprovalsValid: true, process: null, landingApproval: null, blocker: null,
    revision: 1, lastSourceSeq: 1,
  };
  let source = await persistAttempt(sourceDir, null, {
    kind: "attempt.created", next: initial,
    evidence: {
      type: "agent", phaseId: "stale-source-session:builder", agent: "builder", adapterId: "codex",
      provider: "openai-codex", color: null, requestedModel: "source-builder", resolvedModel: "source-builder",
      modelProvenance: "route-attributed", contextWindow: null, usageAuthority: "none",
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, reasoningRelation: "unknown" },
      contextTokens: null, costUsd: null, costAuthority: "unavailable", purpose: "build", at: AT,
    },
  });
  const append = async (kind: "attempt.updated" | "attempt.transitioned", patch: Partial<AttemptStatus>, evidence?: AttemptEvidence) => {
    source = await persistAttempt(sourceDir, source.revision, { kind, next: nextRevision(source, patch), ...(evidence === undefined ? {} : { evidence }) });
  };
  await append("attempt.updated", {}, {
    type: "process", phaseId: "stale-source-session:builder", adapterId: "codex", role: "builder",
    record: { identity: fixtureIdentity, runId: "stale-source-builder", edge: "L4", reservationId: "stale-source-call", command: ["fixture"], cwd: repository },
    status: "EXITED", registeredAt: AT, releasedAt: AT, endedAt: AT, exitCode: 0, exitSignal: null,
  });
  await append("attempt.updated", { candidateSha: candidate }, { type: "phase", phase: {
    phaseId: "stale-source-session:builder", ordinal: 1, key: "builder", name: "builder", kind: "agent", owner: "builder",
    description: "source candidate", status: "SUCCEEDED", correctionCount: 0, maxCorrections: 0,
    errorCode: null, errorMessage: null, startedAt: AT, endedAt: AT, createdAt: AT,
  } });
  await append("attempt.transitioned", { lifecycleState: "GATING", lastActivity: "candidate completed" }, {
    type: "transition", id: "stale-source-l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host",
    edgeId: "L7", reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: AT,
  });
  await append("attempt.updated", { lifecycleState: "CANCELLED", gatesPass: true, lastActivity: "owner cancelled the completed candidate" });
}

interface Spend {
  gates: number;
  readonly prompts: string[];
  readonly lines: string[];
}

function spend(): Spend {
  return { gates: 0, prompts: [], lines: [] };
}

function adoptOptions(
  world: StaleWorld,
  meter: Spend,
  overrides: Partial<AdoptCommandOptions> = {},
  infrastructure: NonNullable<AdoptCommandOptions["infrastructure"]> = {},
): AdoptCommandOptions {
  const targetTaskId = overrides.targetTaskId ?? "integrated";
  return {
    sourceAttemptDir: world.sourceDir, stateRoot: world.stateRoot, targetTaskId,
    request: "adopt the sealed candidate over the advanced canonical HEAD", worktreeRoot: join(world.root, "worktrees"),
    terminal: owner(meter.lines), config: world.config, configPath: resolve("awsf.config.yaml"),
    ...overrides,
    infrastructure: {
      adapterFor: (_entry, id) => new ReviewAdapter(id, meter.prompts),
      createBroker: fakeSeedBroker, sandboxProbe: () => false, now: () => AT,
      sessionId: () => `${targetTaskId}-session`, pidIsLive: () => false,
      runCommand: () => { meter.gates += 1; return { status: 0, stdout: "fresh gate passed\n", stderr: "", error: null }; },
      ...infrastructure,
    },
  };
}

function assertIntegrated(world: { repository: string }, status: AttemptStatus | null, head: string, candidate: string): string {
  const merge = status?.candidateSha ?? "";
  assert.equal(status?.baseSha, head, "the target's base is canonical HEAD");
  assert.deepEqual(git(world.repository, "rev-list", "--parents", "-n", "1", merge).split(" "), [merge, head, candidate],
    "canonical HEAD is the first parent and the exact source candidate the second");
  assert.equal(git(world.repository, "log", "-1", "--format=%an <%ae>|%cn <%ce>", merge), `${HOST_AUTHOR}|${HOST_AUTHOR}`);
  return merge;
}

type SeedWorld = Awaited<ReturnType<typeof seedFixture>>;

function run(attemptDir: string, world: SeedWorld, prompts: string[] = [], writePath?: string) {
  return runProductionCommand({ attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    infrastructure: { adapterFor: (_entry, id) => new SeedAdapter(id, prompts, writePath === undefined ? {} : { writePath }),
      createBroker: fakeSeedBroker, sandboxProbe: () => false } });
}

function start(attemptDir: string, world: SeedWorld) {
  return startCommand({ attemptDir, configPath: world.configPath, worktreeRoot: join(world.root, "targets"),
    preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
}

/** An ordinary seeded continuation of the seed fixture, built to L7 and then cancelled by the owner. */
async function cancelledBuild(world: SeedWorld): Promise<{ readonly sourceDir: string; readonly status: AttemptStatus }> {
  const seeded = await seedCommand(world.seedOptions);
  const sourceDir = seeded.attemptDir!;
  await start(sourceDir, world);
  const built = await run(sourceDir, world);
  assert.equal(built.lifecycleState, "AWAITING_OWNER", built.blocker?.detail);
  const status = (await cancelCommand({ attemptDir: sourceDir, terminal: owner(), cause: "owner", reason: "Stop source attempt" })).status;
  assert.equal(status.lifecycleState, "CANCELLED");
  return { sourceDir, status };
}

/** Adopt a sealed seed-fixture attempt as task `integrated` with scripted gates and review. */
function adoptIntegrated(world: SeedWorld, sourceDir: string, meter: Spend, lines: string[] = [],
  onGate: (cwd: string) => void = () => {}) {
  return adoptCommand({
    sourceAttemptDir: sourceDir, stateRoot: world.stateRoot, targetTaskId: "integrated",
    request: "land the cancelled candidate over the advanced canonical HEAD", worktreeRoot: join(world.root, "targets"),
    terminal: owner(lines), config: world.config, configPath: world.configPath,
    infrastructure: {
      adapterFor: (_entry, id) => new ReviewAdapter(id, meter.prompts), createBroker: fakeSeedBroker, sandboxProbe: () => false,
      now: () => AT, sessionId: () => "integrated-session", pidIsLive: () => false,
      runCommand: (_executable, _argv, command) => {
        meter.gates += 1;
        onGate(command.cwd);
        return { status: 0, stdout: "fresh gate passed\n", stderr: "", error: null };
      },
    },
  });
}

test("a cancelled L7 source integrates over an advanced canonical HEAD, earns fresh gates and review of the merge, and lands by fast-forward", async () => {
  const world = await seedFixture();
  try {
    const { sourceDir, status: cancelled } = await cancelledBuild(world);
    const sourceBase = cancelled.baseSha!;
    const sourceCandidate = cancelled.candidateSha!;
    const selection = { project: world.config.project.slug, taskId: "target", attempt: 1, candidateSha: sourceCandidate };
    await inspectSeedSource(sourceDir, world.repository, selection);

    const head = commit(world.repository, "docs/canonical.md", "canonical advance\n", "docs: advance canonical");
    await assert.rejects(inspectSeedSource(sourceDir, world.repository, selection), /canonical HEAD moved/u, "seed pins stay strict");
    const bytes = sourceBytes(sourceDir);
    const refsBefore = refs(world.repository);

    const meter = spend();
    const lines: string[] = [];
    let gatedHead: string | null = null;
    const adopted = await adoptIntegrated(world, sourceDir, meter, lines, (cwd) => { gatedHead = git(cwd, "rev-parse", "HEAD"); });
    assert.equal(adopted.status?.lifecycleState, "AWAITING_OWNER", adopted.status?.blocker?.detail);
    const merge = assertIntegrated(world, adopted.status, head, sourceCandidate);
    assert.equal(gatedHead, merge, "configured gates ran on the merge");
    assert.match(lines.join("\n"), /Canonical HEAD advanced to [0-9a-f]{40}\. After confirmation the host writes one owner-attributed merge/u);
    assert.equal(git(adopted.status!.worktree!, "rev-parse", "HEAD"), merge);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), head, "adoption moves no canonical ref");

    const evidence = await readAttemptEvidence(adopted.attemptDir!);
    const adoption = adoptionOf(evidence);
    assert.deepEqual({ baseSha: adoption.baseSha, candidateSha: adoption.candidateSha, integration: adoption.integration }, {
      baseSha: sourceBase, candidateSha: sourceCandidate,
      integration: { integrationBaseSha: head, integratedCandidateSha: merge, committedAt: AT },
    });
    // Fresh gates and review measure the integrated diff, never the source's.
    assert.equal(meter.gates, 1);
    const gates = evidence.filter((record) => record.type === "gate");
    assert.ok(gates.length > 0 && gates.every((record) => record.type === "gate" && record.candidateSha === merge));
    const writes = gates.find((record) => record.type === "gate" && record.gateId === "writes_within_globs");
    const items = writes?.type === "gate" ? writes.checks.map((check) => check.item).sort() : [];
    assert.deepEqual(items, [AUTHORED, INHERITED].sort());
    const reviewDiff = readFileSync(join(adopted.attemptDir!, "raw", `review-context-${merge}-ad1.diff`), "utf8");
    assert.ok(reviewDiff.includes(INHERITED) && reviewDiff.includes(AUTHORED));
    assert.equal(reviewDiff.includes("docs/canonical.md"), false);
    assert.equal(meter.prompts.length, 1, "only the fresh review runs; no builder reruns");
    assert.equal(adopted.status?.budget.callsSpent, 1);

    // The source is exact and immutable: no attempt byte and no ref of its own moved.
    assert.deepEqual(sourceBytes(sourceDir), bytes);
    const added = refs(world.repository).split("\n").filter((line) => !refsBefore.split("\n").includes(line));
    assert.deepEqual(added, [`refs/awsf/candidates/${PROJECT}/integrated/1 ${merge}`]);

    await journeyCommand({ attemptDir: adopted.attemptDir!, terminal: owner(), journeyId: "integrated-journey", observedSha: merge, now: () => AT });
    const landed = await landCommand({ attemptDir: adopted.attemptDir!, terminal: owner(), now: () => AT });
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(landed.status.landingApproval?.candidateSha, merge);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), merge);
    assert.equal(git(world.repository, "rev-parse", "HEAD^1"), head, "landing was a fast-forward from the integration base");
    assert.deepEqual(sourceBytes(sourceDir), bytes);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("a cancelled integrated target is itself an exact seed source: its continuation seeds from that merge, runs, and lands by fast-forward", async () => {
  const world = await seedFixture();
  try {
    const { sourceDir, status: original } = await cancelledBuild(world);
    const head = commit(world.repository, "docs/canonical.md", "canonical advance\n", "docs: advance canonical");
    const meter = spend();
    const adopted = await adoptIntegrated(world, sourceDir, meter);
    assert.equal(adopted.status?.lifecycleState, "AWAITING_OWNER", adopted.status?.blocker?.detail);
    const merge = assertIntegrated(world, adopted.status, head, original.candidateSha!);
    const integratedDir = adopted.attemptDir!;
    assert.equal((await cancelCommand({ attemptDir: integratedDir, terminal: owner(), cause: "owner", reason: "Stop integrated attempt" })).status.lifecycleState, "CANCELLED");
    const integratedBytes = sourceBytes(integratedDir);
    const originalBytes = sourceBytes(sourceDir);
    const mergesBefore = mergesOf(world.repository, original.candidateSha!);

    // The selection is the integrated target's exact merge, not its source's candidate.
    const lines: string[] = [];
    const seeded = await seedCommand({ ...world.seedOptions, targetTaskId: "continued", sourceTaskId: "integrated", candidateSha: merge,
      request: "extend the integrated merge", terminal: owner(lines) });
    assert.equal(seeded.confirmed, true);
    const seed = seeded.status?.seed;
    assert.deepEqual({ source: seed?.source.taskId, lifecycle: seed?.source.lifecycle, base: seed?.integrationBaseSha, candidate: seed?.seedCandidateSha },
      { source: "integrated", lifecycle: "CANCELLED", base: head, candidate: merge });
    assert.equal(seeded.status?.continuesTask, "integrated");
    assert.match(lines.join("\n"), new RegExp(`Exact seed: ${merge}\\. Integration base: ${head}\\.`, "u"));

    // Startup and the run revalidate the same binding; the builder adds one commit on the merge.
    await start(seeded.attemptDir!, world);
    const prompts: string[] = [];
    const built = await run(seeded.attemptDir!, world, prompts, "core/src/continued.ts");
    assert.equal(built.lifecycleState, "AWAITING_OWNER", built.blocker?.detail);
    const candidate = built.candidateSha!;
    assert.equal(built.baseSha, head);
    assert.deepEqual(git(world.repository, "rev-list", "--parents", "-n", "1", candidate).split(" "), [candidate, merge],
      "the continuation's own commit has the exact merge as its only parent");
    assert.ok(prompts.some((prompt) => prompt.includes(`"seedCandidateSha":"${merge}"`)), "the builder was told the seed it inherits");
    assert.equal(git(world.repository, "rev-parse", "HEAD"), head, "no run moves canonical HEAD");

    await journeyCommand({ attemptDir: seeded.attemptDir!, terminal: owner(), journeyId: "continued-journey", observedSha: candidate, now: () => AT });
    const landing: string[] = [];
    const landed = await landCommand({ attemptDir: seeded.attemptDir!, terminal: owner(landing), now: () => AT });
    assert.match(landing.join("\n"), new RegExp(`Seeded candidate ${merge}\\. Integration base pinned to ${head}\\.`, "u"));
    assert.match(landing.join("\n"), /Fast-forward meter: canonical ahead 0, behind [1-9][0-9]*/u);
    assert.equal(landed.status.lifecycleState, "LANDED", landed.status.blocker?.detail);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), candidate);
    assert.equal(git(world.repository, "rev-parse", "HEAD^1^1"), head, "landing was a fast-forward from the integration base");

    // Neither sealed attempt was written, and no second merge was made.
    assert.deepEqual(sourceBytes(integratedDir), integratedBytes);
    assert.deepEqual(sourceBytes(sourceDir), originalBytes);
    assert.deepEqual(mergesOf(world.repository, original.candidateSha!), mergesBefore);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("seeding from an integrated target refuses a decline, a source withdrawn during confirmation and a collision, and startup re-reads that source", async () => {
  const world = await seedFixture();
  try {
    const { sourceDir, status: original } = await cancelledBuild(world);
    const head = commit(world.repository, "docs/canonical.md", "canonical advance\n", "docs: advance canonical");
    const adopted = await adoptIntegrated(world, sourceDir, spend());
    assert.equal(adopted.status?.lifecycleState, "AWAITING_OWNER", adopted.status?.blocker?.detail);
    const merge = assertIntegrated(world, adopted.status, head, original.candidateSha!);
    await cancelCommand({ attemptDir: adopted.attemptDir!, terminal: owner(), cause: "owner", reason: "Stop adopted attempt" });
    const options = { ...world.seedOptions, targetTaskId: "continued", sourceTaskId: "integrated", candidateSha: merge, request: "extend the integrated merge" };
    const continued = join(world.stateRoot, "projects", world.config.project.slug, "tasks", "continued");
    const retained = `${sourceDir}.retained`;
    const withdrawn = /integration source target attempt 1: no such sealed attempt beside the target/u;
    const refsBefore = refs(world.repository);

    const declined = await seedCommand({ ...options, terminal: owner([], async () => false) });
    assert.equal(declined.confirmed, false);
    assert.equal(existsSync(continued), false);

    await assert.rejects(seedCommand({ ...options, terminal: owner([], async () => { renameSync(sourceDir, retained); return true; }) }), withdrawn);
    assert.equal(existsSync(continued), false);
    renameSync(retained, sourceDir);

    const seeded = await seedCommand({ ...options, terminal: owner() });
    assert.equal(seeded.confirmed, true);
    await assert.rejects(seedCommand({ ...options, terminal: owner() }), /target already exists/u);

    renameSync(sourceDir, retained);
    const bytes = sourceBytes(seeded.attemptDir!);
    await assert.rejects(start(seeded.attemptDir!, world), withdrawn);
    assert.deepEqual(sourceBytes(seeded.attemptDir!), bytes, "a refused startup writes nothing");
    assert.equal(refs(world.repository), refsBefore);
    renameSync(retained, sourceDir);
    await validateSeedStartup(seeded.status!.seed!, seeded.status!, world.config, world.configPath, seeded.attemptDir!);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("equal-base adoption is unchanged: the source pair is the target pair and no integration is recorded", async () => {
  const world = await staleSource({ advance: null });
  try {
    const meter = spend();
    const result = await adoptCommand(adoptOptions(world, meter, { targetTaskId: "equal-base" }, {
      runCommand: () => { meter.gates += 1; return { status: 1, stdout: "stop before review\n", stderr: "", error: null }; },
    }));
    assert.equal(result.status?.lifecycleState, "BLOCKED");
    assert.equal(result.status?.baseSha, world.base);
    assert.equal(result.status?.candidateSha, world.candidate);
    assert.equal(git(result.status!.worktree!, "rev-parse", "HEAD"), world.candidate);
    assert.equal("integration" in adoptionOf(await readAttemptEvidence(result.attemptDir!)), false);
    assert.equal(meter.lines.some((line) => line.startsWith("Canonical HEAD advanced")), false);
    assert.deepEqual(mergesOf(world.repository, world.candidate), []);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

interface Refusal {
  readonly name: string;
  readonly expected: RegExp | null;
  readonly source?: Parameters<typeof staleSource>[0];
  readonly setup?: (world: StaleWorld) => Promise<void> | void;
  readonly targetTaskId?: string;
  readonly confirm?: (world: StaleWorld) => Promise<boolean>;
  readonly sessionId?: (world: StaleWorld) => string;
  /** The scenario itself moves canonical HEAD or substitutes the source, refs included; the host must still write no target. */
  readonly races?: "canonical" | "source";
  /** The race lands after the merge object was written; it stays an unreferenced object. */
  readonly writesMerge?: boolean;
  readonly preexistingTarget?: boolean;
}

const REFUSALS: readonly Refusal[] = [
  { name: "conflict", source: { advance: { path: "core/src/feature.ts", text: "export const adopted = false;\n" } },
    expected: /cannot be integrated: .*conflicts with canonical HEAD .* in core\/src\/feature\.ts/u },
  { name: "unrelated history", expected: /cannot be integrated: canonical HEAD [0-9a-f]{40} does not descend from the source base/u,
    setup: (world) => {
      git(world.repository, "checkout", "--quiet", "--orphan", "unrelated");
      commit(world.repository, "other.md", "unrelated root\n", "unrelated root");
    } },
  { name: "dirty checkout", expected: /not clean/u, setup: (world) => { writeFileSync(join(world.repository, "stray.txt"), "dirty\n"); } },
  { name: "identity mismatch", source: { foreign: true }, expected: /Foreign Writer <foreign@example\.com>/u },
  { name: "decline", expected: null, confirm: async () => false },
  // A sealed attempt refuses every write, so the race is a substituted source
  // whose exact candidate differs from the one the owner confirmed.
  { name: "source race", races: "source", expected: /sealed source evidence changed after confirmation/u,
    setup: (world) => {
      git(world.repository, "checkout", "--quiet", "--detach", world.candidate);
      world.alternate = commit(world.repository, "core/src/other.ts", "export const other = 1;\n", "feat: a different candidate");
      git(world.repository, "checkout", "--quiet", "main");
    },
    confirm: async (world) => {
      renameSync(world.sourceDir, `${world.sourceDir}.confirmed`);
      await persistSource(world.sourceDir, world.repository, world.base, world.alternate!);
      return true;
    } },
  { name: "canonical race at confirmation", races: "canonical", expected: /canonical HEAD changed after confirmation/u,
    confirm: async (world) => { commit(world.repository, "docs/raced.md", "raced\n", "docs: race"); return true; } },
  { name: "canonical race while the merge is written", races: "canonical", writesMerge: true,
    expected: /canonical HEAD moved to [0-9a-f]{40} while the integration onto [0-9a-f]{40} was written/u,
    sessionId: (world) => { commit(world.repository, "docs/raced.md", "raced\n", "docs: race"); return "raced-session"; } },
  { name: "target collision", preexistingTarget: true, expected: /already exists and is not this pending adoption/u,
    setup: async (world) => {
      await newCommand({ stateRoot: world.stateRoot, project: PROJECT, taskId: "integrated", repository: world.repository,
        request: "an unrelated task already owns this id", workflow: "build-review", tier: 2,
        configSnapshotJson: toConfigSnapshotJson(world.config), now: () => AT, sessionId: () => "colliding-session" });
    } },
  { name: "source collision", targetTaskId: "stale-source", expected: /must be a distinct continuing task/u },
];

for (const scenario of REFUSALS) {
  test(`stale-prefix refusal spends nothing and moves nothing: ${scenario.name}`, async () => {
    const world = await staleSource(scenario.source);
    try {
      await scenario.setup?.(world);
      const targetDir = join(world.stateRoot, "projects", PROJECT, "tasks", scenario.targetTaskId ?? "integrated");
      const targetJournal = scenario.preexistingTarget === true ? readFileSync(journalFilePath(join(targetDir, "1"))) : null;
      const bytes = sourceBytes(world.sourceDir);
      const refsBefore = refs(world.repository);
      const meter = spend();
      const options = adoptOptions(world, meter, {
        ...(scenario.targetTaskId === undefined ? {} : { targetTaskId: scenario.targetTaskId }),
        ...(scenario.confirm === undefined ? {} : { terminal: owner(meter.lines, () => scenario.confirm!(world)) }),
      }, scenario.sessionId === undefined ? {} : { sessionId: () => scenario.sessionId!(world) });

      if (scenario.expected === null) {
        const declined = await adoptCommand(options);
        assert.equal(declined.confirmed, false);
        assert.equal(declined.status, null);
      } else {
        await assert.rejects(adoptCommand(options), scenario.expected);
      }
      assert.equal(meter.gates, 0);
      assert.equal(meter.prompts.length, 0);
      if (targetJournal === null) assert.equal(existsSync(targetDir), scenario.targetTaskId === "stale-source");
      else assert.deepEqual(readFileSync(journalFilePath(join(targetDir, "1"))), targetJournal);
      if (scenario.races !== "source") assert.deepEqual(sourceBytes(world.sourceDir), bytes);
      if (scenario.races === undefined) assert.equal(refs(world.repository), refsBefore);
      assert.equal(git(world.repository, "rev-parse", `${world.candidate}^{commit}`), world.candidate);
      assert.equal(mergesOf(world.repository, world.candidate).length, scenario.writesMerge === true ? 1 : 0);
    } finally {
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("a pending integrated target resumes only its exact recorded merge, without rerunning gates or writing another merge", async () => {
  const world = await staleSource();
  try {
    const meter = spend();
    const options = adoptOptions(world, meter, { targetTaskId: "pending-integrated", routes: SAME_PROVIDER_REVIEW });
    const pending = await adoptCommand(options);
    assert.equal(pending.status?.lifecycleState, "GATING");
    assert.equal(pending.status?.gatesPass, true);
    assert.equal(pending.status?.budget.callsSpent, 0);
    const merge = assertIntegrated(world, pending.status, world.head, world.candidate);
    assert.equal(meter.gates, 1);
    assert.equal(meter.prompts.length, 0);

    await degradeReviewCommand({ attemptDir: pending.attemptDir!, reason: "The owner accepts same-provider review of this merge", terminal: owner(), now: () => AT });
    const lines: string[] = [];
    const resumed = await adoptCommand({ ...options, terminal: owner(lines) });
    assert.equal(resumed.reusedTarget, true);
    assert.equal(resumed.attemptDir, pending.attemptDir);
    assert.equal(resumed.status?.lifecycleState, "AWAITING_OWNER", resumed.status?.blocker?.detail);
    assert.equal(resumed.status?.baseSha, world.head);
    assert.equal(resumed.status?.candidateSha, merge);
    assert.match(lines.join("\n"), new RegExp(`The target holds the host merge ${merge}`, "u"));
    assert.equal(meter.gates, 1, "the resumed target keeps its fresh gate measurement of the merge");
    assert.equal(meter.prompts.length, 1);
    assert.deepEqual(mergesOf(world.repository, world.candidate), [merge]);
    assert.equal(git(world.repository, "rev-parse", "HEAD"), world.head);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

for (const integrated of [true, false]) {
  test(`replay against a canonical HEAD that moved after ${integrated ? "an integrated" : "an equal-base"} pending target is refused at zero spend`, async () => {
    const world = await staleSource(integrated ? {} : { advance: null });
    try {
      const meter = spend();
      const options = adoptOptions(world, meter, { targetTaskId: "pending-replay", routes: SAME_PROVIDER_REVIEW });
      const pending = await adoptCommand(options);
      assert.equal(pending.status?.lifecycleState, "GATING");
      await degradeReviewCommand({ attemptDir: pending.attemptDir!, reason: "The owner accepts same-provider review", terminal: owner(), now: () => AT });
      const merges = mergesOf(world.repository, world.candidate);
      assert.equal(merges.length, integrated ? 1 : 0);
      commit(world.repository, "docs/later.md", "a later canonical advance\n", "docs: advance canonical again");
      const targetBytes = readFileSync(journalFilePath(pending.attemptDir!));

      await assert.rejects(adoptCommand(options), /already exists and is not this pending adoption/u);
      assert.deepEqual(readFileSync(journalFilePath(pending.attemptDir!)), targetBytes);
      assert.equal(meter.gates, 1);
      assert.equal(meter.prompts.length, 0);
      assert.deepEqual(mergesOf(world.repository, world.candidate), merges);
    } finally {
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("cancelling an integrated target leaves its source exact, and a new continuation integrates again and lands", async () => {
  const world = await staleSource();
  try {
    const bytes = sourceBytes(world.sourceDir);
    const meter = spend();
    const first = await adoptCommand(adoptOptions(world, meter, { targetTaskId: "first-integrated" }));
    assert.equal(first.status?.lifecycleState, "AWAITING_OWNER", first.status?.blocker?.detail);
    const firstMerge = assertIntegrated(world, first.status, world.head, world.candidate);
    assert.equal((await cancelCommand({ attemptDir: first.attemptDir!, terminal: owner(), cause: "owner", reason: "Stop first attempt" })).status.lifecycleState, "CANCELLED");
    assert.deepEqual(sourceBytes(world.sourceDir), bytes);

    const second = await adoptCommand(adoptOptions(world, meter, { targetTaskId: "second-integrated" }, { now: () => "2026-09-27T01:00:00.000Z" }));
    assert.equal(second.status?.lifecycleState, "AWAITING_OWNER", second.status?.blocker?.detail);
    const merge = assertIntegrated(world, second.status, world.head, world.candidate);
    assert.notEqual(merge, firstMerge, "each continuation writes and cites its own merge");
    await journeyCommand({ attemptDir: second.attemptDir!, terminal: owner(), journeyId: "second-integrated", observedSha: merge, now: () => AT });
    const landed = await landCommand({ attemptDir: second.attemptDir!, terminal: owner(), now: () => AT });
    assert.equal(landed.status.lifecycleState, "LANDED");
    assert.equal(git(world.repository, "rev-parse", "HEAD"), merge);
    assert.equal(meter.gates, 2);
    assert.equal(meter.prompts.length, 2);
    assert.deepEqual(sourceBytes(world.sourceDir), bytes);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

/** Seed from an adopted target of the synthetic source; `continued` must never be created. */
function seedFrom(world: StaleWorld, sourceTaskId: string, candidateSha: string) {
  return seedCommand({ stateRoot: world.stateRoot, project: PROJECT, repository: world.repository, targetTaskId: "continued",
    sourceTaskId, sourceAttempt: 1, candidateSha, request: "extend the adopted candidate", workflow: "build-review",
    config: world.config, configPath: resolve("awsf.config.yaml"), terminal: owner(), now: () => AT });
}

interface JournalLine {
  event: { evidence?: Record<string, unknown> };
}

/** Forge a target's journal evidence in place; every status revision stays as the host wrote it. */
function rewriteJournal(targetDir: string, change: (records: JournalLine[]) => void): void {
  const path = journalFilePath(targetDir);
  const records = readFileSync(path, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as JournalLine);
  change(records);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function rewriteAdoption(targetDir: string, change: (adoption: CandidateAdoptionEvidence) => void): void {
  rewriteJournal(targetDir, (records) => { change(records[0]!.event.evidence!["adoption"] as CandidateAdoptionEvidence); });
}

function succeededGates(record: JournalLine): boolean {
  const phase = record.event.evidence?.["phase"] as { phaseId?: string; status?: string } | undefined;
  return record.event.evidence?.["type"] === "phase" && phase?.phaseId?.endsWith(":adoption-tests") === true && phase.status === "SUCCEEDED";
}

/** Replace the sealed source with one whose L7 binds a different owner candidate over the same base. */
async function substituteSource(world: StaleWorld): Promise<void> {
  git(world.repository, "checkout", "--quiet", "--detach", world.base);
  world.alternate = commit(world.repository, "core/src/other.ts", "export const other = 1;\n", "feat: a different candidate");
  git(world.repository, "checkout", "--quiet", "main");
  renameSync(world.sourceDir, `${world.sourceDir}.retained`);
  await persistSource(world.sourceDir, world.repository, world.base, world.alternate);
}

test("a cancelled integrated target passes seed inspection on its exact merge and integration base", async () => {
  const world = await staleSource();
  try {
    const adopted = await adoptCommand(adoptOptions(world, spend()));
    const merge = assertIntegrated(world, adopted.status, world.head, world.candidate);
    await cancelCommand({ attemptDir: adopted.attemptDir!, terminal: owner(), cause: "owner", reason: "Stop adopted attempt" });
    const inspected = await inspectSeedSource(adopted.attemptDir!, world.repository, { project: PROJECT, taskId: "integrated", attempt: 1, candidateSha: merge });
    assert.deepEqual({ baseSha: inspected.baseSha, candidateSha: inspected.candidateSha }, { baseSha: world.head, candidateSha: merge });
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});

interface SeedSourceRefusal {
  readonly name: string;
  readonly expected: RegExp;
  readonly source?: Parameters<typeof staleSource>[0];
  /** The fresh adoption gate's exit code; nonzero blocks the target at its gates. */
  readonly gateExit?: number;
  /** Leave an AWAITING_OWNER target uncancelled. */
  readonly live?: boolean;
  readonly tamper?: (adoption: CandidateAdoptionEvidence, world: StaleWorld) => void;
  readonly rewrite?: (records: JournalLine[]) => void;
  readonly setup?: (world: StaleWorld) => Promise<void> | void;
  readonly select?: (world: StaleWorld) => string;
}

const NOT_THE_RECORDED_SOURCE = /integration source stale-source attempt 1: not the exact sealed revision the adoption recorded/u;

const SEED_SOURCE_REFUSALS: readonly SeedSourceRefusal[] = [
  { name: "an equal-base target carries its source's candidate", source: { advance: null },
    expected: /carries its source's candidate unchanged; seed from stale-source attempt 1 instead/u },
  { name: "a target blocked by its fresh gates", gateExit: 1, expected: /never passed its fresh adoption gates/u },
  { name: "a live target", live: true, expected: /not sealed BLOCKED\/CANCELLED/u },
  { name: "the source candidate selected instead of the merge", select: (world) => world.candidate,
    expected: /no exact host-created integration candidate binding/u },
  { name: "a recorded merge that is not the target's candidate",
    tamper: (adoption, world) => { adoption.integration = { ...adoption.integration!, integratedCandidateSha: world.candidate }; },
    expected: /no exact host-created integration candidate binding/u },
  { name: "a recorded merge time whose bytes do not recompute",
    tamper: (adoption) => { adoption.integration = { ...adoption.integration!, committedAt: "2026-09-27T02:00:00.000Z" }; },
    expected: /recorded integration is not the host's exact merge/u },
  { name: "a recorded source pair the merge does not integrate",
    tamper: (adoption, world) => { adoption.candidateSha = world.base; },
    expected: /recorded integration is not the host's exact merge/u },
  { name: "a canonical HEAD that moved after cancellation",
    setup: (world) => { commit(world.repository, "docs/later.md", "later\n", "docs: advance canonical again"); },
    expected: /canonical HEAD moved/u },
  { name: "an adoption record the host never writes",
    tamper: (adoption) => { Object.assign(adoption, { sourceEvidenceCopied: true }); },
    expected: /adoption evidence is not exactly one valid host creation record/u },
  { name: "a replayed second adoption record",
    rewrite: (records) => { records.at(-1)!.event.evidence = records[0]!.event.evidence!; },
    expected: /adoption evidence is not exactly one valid host creation record/u },
  { name: "a gates-pass status whose host phase record is gone",
    rewrite: (records) => { delete records.find(succeededGates)!.event.evidence; },
    expected: /never passed its fresh adoption gates/u },
  { name: "a failed gate record under a succeeded phase",
    rewrite: (records) => { records.find((record) => record.event.evidence?.["gateId"] === "commands_pass")!.event.evidence!["passed"] = false; },
    expected: /never passed its fresh adoption gates/u },
  { name: "a recorded source session that is not the sealed source's",
    tamper: (adoption) => { adoption.sourceSessionId = "forged-session"; }, expected: NOT_THE_RECORDED_SOURCE },
  { name: "a recorded source revision the sealed source does not hold",
    tamper: (adoption) => { adoption.sourceRevision += 1; }, expected: NOT_THE_RECORDED_SOURCE },
  { name: "a substituted source whose L7 binds a different candidate", setup: substituteSource,
    expected: /integration source stale-source attempt 1: no exact host-completed L7 candidate binding/u },
  { name: "a missing source", setup: (world) => { renameSync(world.sourceDir, `${world.sourceDir}.retained`); },
    expected: /integration source stale-source attempt 1: no such sealed attempt beside the target/u },
];

for (const scenario of SEED_SOURCE_REFUSALS) {
  test(`seed refuses an adopted target without creating one: ${scenario.name}`, async () => {
    const world = await staleSource(scenario.source);
    try {
      const meter = spend();
      const exit = scenario.gateExit ?? 0;
      const adopted = await adoptCommand(adoptOptions(world, meter, {}, {
        runCommand: () => { meter.gates += 1; return { status: exit, stdout: "fresh gate\n", stderr: "", error: null }; },
      }));
      const targetDir = adopted.attemptDir!;
      if (adopted.status?.lifecycleState === "AWAITING_OWNER" && scenario.live !== true) await cancelCommand({ attemptDir: targetDir, terminal: owner(), cause: "owner", reason: "Stop target attempt" });
      if (scenario.tamper !== undefined) rewriteAdoption(targetDir, (adoption) => { scenario.tamper!(adoption, world); });
      if (scenario.rewrite !== undefined) rewriteJournal(targetDir, scenario.rewrite);
      await scenario.setup?.(world);
      const selected = scenario.select?.(world) ?? adopted.status!.candidateSha!;
      const bytes = sourceBytes(targetDir);
      const refsBefore = refs(world.repository);
      const merges = mergesOf(world.repository, world.candidate);

      await assert.rejects(seedFrom(world, "integrated", selected), scenario.expected);
      assert.equal(existsSync(join(world.stateRoot, "projects", PROJECT, "tasks", "continued")), false);
      assert.deepEqual(sourceBytes(targetDir), bytes);
      assert.equal(refs(world.repository), refsBefore);
      assert.deepEqual(mergesOf(world.repository, world.candidate), merges);
    } finally {
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}
