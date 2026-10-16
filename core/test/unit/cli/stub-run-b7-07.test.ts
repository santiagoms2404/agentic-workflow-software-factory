// B7-07, B9-06, B7-22 (owner call O7): `awsf run --stub true` wrote the owner's
// end-user journey attestation and, at T2, a host-fabricated review, with no
// owner terminal and no lease, so the T2 land guard passed on a candidate no
// gate, reviewer or owner had seen. Stub mode stays for demos and tests, but it
// can no longer satisfy a real guard: `start --stub true` leaves a persistent
// stub mark, `run --stub true` refuses an attempt without it, everything the
// stub run attests carries stub provenance, and L20 refuses that provenance at
// T2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { landCommand } from "../../../src/cli/commands/land.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { InsufficientEvidence } from "../../../src/state/errors.ts";
import { transition, type TransitionInput } from "../../../src/state/task-machine.ts";
import { k1Request, prepareK1 } from "../../fixtures/k1-preflight.ts";

const PROJECT = "agentic-workflow-software-factory";
const AUTHOR = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const STUB_PREFLIGHT = () => ({ adapter: true, sandbox: true, observability: true });

interface Box {
  readonly repository: string;
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly configPath: string;
  readonly lines: string[];
  readonly errors: string[];
  cli(argv: readonly string[]): Promise<number>;
  close(): void;
}

/** A clean synthetic repository, this checkout's configuration with offline gates, and the CLI bound to both. */
function box(label: string): Box {
  const root = mkdtempSync(join(tmpdir(), `awsf-stub-b7-07-${label}-`));
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repository, "fixture.txt"), "offline fixture\n");
  execFileSync("git", ["-C", repository, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, ...AUTHOR, "commit", "-q", "-m", "test: seed stub fixture"], { stdio: "ignore" });
  mkdirSync(join(repository, "node_modules"));
  writeFileSync(join(repository, "node_modules", "seeded.txt"), "seed\n");
  const source = readFileSync(resolve("awsf.config.yaml"), "utf8");
  const configText = source.replace(/\ngates:\n(?: {2}.*\n)+/u,
    "\ngates:\n  test: { argv: [npm, run, test:unit], timeout_seconds: 600 }\n  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n");
  assert.notEqual(configText, source);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktrees");
  const lines: string[] = [];
  const errors: string[] = [];
  const common = ["--state-root", stateRoot, "--project", PROJECT, "--config", configPath, "--worktree-root", worktreeRoot];
  return {
    repository, stateRoot, worktreeRoot, configPath, lines, errors,
    cli: (argv) => main({
      argv: [...argv, ...common], cwd: repository, env: {},
      writeOut: (line) => lines.push(line), writeError: (line) => errors.push(line),
      get terminal(): never { throw new Error("start and run take no owner terminal"); },
    }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * A T2 simple-sdlc attempt at DRAFT whose K1 records are fresh, so start may
 * prepare it. Written through the dashboard projection the CLI later opens, so
 * the CLI meets a projection that matches the journal; `prepare: true` also
 * takes it to PREPARED the ordinary way, without `--stub`.
 */
async function measuredDraft(b: Box, taskId: string, prepare = false): Promise<string> {
  const projection = createDashboardProjection(b.stateRoot, () => undefined);
  try {
    const created = await newCommand({
      stateRoot: b.stateRoot, project: PROJECT, taskId, repository: b.repository,
      // One request per task: K1 refuses a second live task with the same one.
      request: k1Request(`exercise the stub path for ${taskId}`, "core/src/example.ts"), workflow: "simple-sdlc", tier: 2,
      sessionId: () => `${taskId}-session`, projectRecord: projection.project,
    });
    await prepareK1({ attemptDir: created.attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, projectRecord: projection.project });
    if (prepare) {
      await startCommand({ attemptDir: created.attemptDir, worktreeRoot: b.worktreeRoot, configPath: b.configPath,
        preflight: STUB_PREFLIGHT, projectRecord: projection.project });
    }
    return created.attemptDir;
  } finally { projection.close(); }
}

/** The AWAITING_OWNER -> LANDING request a confirmed, clean T2 landing makes, with the given provenance. */
function landingRequest(candidateSha: string, budget: TransitionInput["budget"], provenance?: string): TransitionInput {
  return {
    from: "AWAITING_OWNER", to: "LANDING", actor: "human", tier: 2, reason: { source: "human" }, interactive: true, budget,
    evidence: {
      candidateSha, gatesPass: true,
      landing: {
        shaDisplayed: candidateSha, summaryDisplayed: "one fixture file", confirmed: true,
        requiredReviewPresent: true, journeyApproved: true, protectedApprovalsValid: true, fastForwardPreflightPasses: true,
        ...(provenance === undefined ? {} : { attestationProvenance: provenance }),
      },
    },
  };
}

test("awsf start --stub true writes a persistent stub mark; a start without --stub writes none", async () => {
  const b = box("mark");
  try {
    const stubbed = await measuredDraft(b, "stubbed");
    assert.equal(await b.cli(["start", "stubbed", "--stub", "true"]), 0, b.errors.join("\n"));
    const prepared = await readAttempt(stubbed);
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.equal(prepared.stub?.startedBy, "awsf start --stub true");
    assert.match(prepared.stub?.at ?? "", /^\d{4}-\d{2}-\d{2}T/u);

    const unmarked = await readAttempt(await measuredDraft(b, "real", true));
    assert.equal(unmarked.lifecycleState, "PREPARED");
    assert.equal(unmarked.stub ?? null, null, "only the stub start marks an attempt");
  } finally { b.close(); }
});

test("awsf run --stub true refuses an attempt that awsf start --stub true did not prepare, and moves nothing", async () => {
  const b = box("refuse");
  try {
    const attemptDir = await measuredDraft(b, "real", true);
    const prepared = await readAttempt(attemptDir);
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.equal(await b.cli(["run", "real", "--stub", "true"]), 1);
    assert.match(b.errors.join("\n"), /was not prepared by awsf start --stub true/u);
    const after = await readAttempt(attemptDir);
    assert.equal(after.lifecycleState, "PREPARED");
    assert.equal(after.revision, prepared.revision, "a refused stub run writes no revision");
    assert.equal(after.journeyApproved, false);
    assert.equal(after.requiredReviewPresent, false);
  } finally { b.close(); }
});

test("the full stub demo still works, and every attestation it writes carries stub provenance", async () => {
  const b = box("demo");
  try {
    const attemptDir = await measuredDraft(b, "demo");
    assert.equal(await b.cli(["start", "demo", "--stub", "true"]), 0, b.errors.join("\n"));
    assert.equal(await b.cli(["run", "demo", "--stub", "true"]), 0, b.errors.join("\n"));
    const status = await readAttempt(attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.match(status.candidateSha ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(status.budget.callsSpent, 0, "no provider was called");
    // The flags the stub writes are now named for what wrote them.
    assert.equal(status.journeyApproved, true);
    assert.equal(status.requiredReviewPresent, true);
    assert.equal(status.attestationProvenance, "stub");
    assert.ok(b.lines.some((line) => line.startsWith("AWAITING_OWNER:")), b.lines.join("\n"));
  } finally { b.close(); }
});

test("the T2 land guard refuses journey and review evidence with stub provenance, and only that", async () => {
  const sha = "a".repeat(40);
  const budget = {
    callsSpent: 0, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
    allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 10,
  } as unknown as TransitionInput["budget"];
  assert.equal(transition(landingRequest(sha, budget)).to, "LANDING", "the same evidence without stub provenance lands");
  assert.throws(() => transition(landingRequest(sha, budget, "stub")), (error: unknown) => {
    assert.ok(error instanceof InsufficientEvidence, String(error));
    assert.equal(error.edge, "L20");
    assert.deepEqual(error.violations, [
      "the T2 review and journey carry \"stub\" provenance; only a recorded review and the owner's journey satisfy L20",
    ]);
    return true;
  });
});

test("awsf land refuses a stub T2 candidate and leaves it AWAITING_OWNER", async () => {
  const b = box("land");
  try {
    const attemptDir = await measuredDraft(b, "land");
    assert.equal(await b.cli(["start", "land", "--stub", "true"]), 0, b.errors.join("\n"));
    assert.equal(await b.cli(["run", "land", "--stub", "true"]), 0, b.errors.join("\n"));
    const before = git(b.repository, "rev-parse", "HEAD");
    await assert.rejects(
      landCommand({ attemptDir, terminal: { interactive: true, write: () => {}, confirm: async () => true } }),
      (error: unknown) => {
        assert.ok(error instanceof InsufficientEvidence, String(error));
        assert.match(error.message, /"stub" provenance/u);
        return true;
      },
    );
    assert.equal((await readAttempt(attemptDir)).lifecycleState, "AWAITING_OWNER");
    assert.equal(git(b.repository, "rev-parse", "HEAD"), before, "the canonical branch did not move");
  } finally { b.close(); }
});

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}
