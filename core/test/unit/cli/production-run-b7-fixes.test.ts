import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { AdapterError, type BrokerProcessRegistration, type ModelRequest, type TransportBroker } from "../../../src/adapters/interface.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import {
  isReviewTransportFailure,
  type ProductionInfrastructure,
  prepareResumeInstruction,
  protectedSandboxAvailable,
  ProductionRouteUnavailable,
  type RecoveryInspection,
  resumeProductionCommand,
  runProductionCommand,
  slugifyPlanStem,
} from "../../../src/cli/commands/production-run.ts";
import { ContinuityStore } from "../../../src/execution/continuity-store.ts";
import { continuityFilePath } from "../../../src/persistence/platform-paths.ts";
import { proveCommand } from "../../../src/cli/commands/prove.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { ReviewOutput } from "../../../src/contracts/review-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { sealPlanTicketSelection } from "../../../src/cli/commands/ticket-selection.ts";
import { PROVING_GROUND_DIR } from "../../../src/workflow/prove/bind.ts";
import { AT, box, commit, draft, git, OWNER, prepare, ReplayStub, start } from "../../fixtures/trap-world.ts";

class SuccessStub extends ReplayStub {
  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: AT, providerAt: null };
    yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
    const path = "core/src/example.ts";
    mkdirSync(dirname(join(request.cwd, path)), { recursive: true });
    writeFileSync(join(request.cwd, path), "export const example = 1;\n");
    const output: BuildOutput = {
      schema: "awsf.build-output/v1",
      producerStatus: "success",
      summary: "Implemented the requested example.",
      artifacts: [],
      notesForNextPhase: "Review the candidate.",
      changedFiles: [path],
      implementationNotes: [],
      commandsRun: [],
      proposedCommitMessage: "feat: add example",
    };
    yield {
      ...base,
      seq: 2,
      kind: "model.resolved",
      adapter: this.id,
      provider: (await this.getModelInfo(request.model)).provider,
      requestedModel: request.model,
      resolvedModel: request.model,
      provenance: "stream-authoritative",
    };
    yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(output) };
    yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
  }
}

class ProveReviewStub extends ReplayStub {
  override buildSpec(request: ModelRequest) {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false as const };
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: AT, providerAt: null };
    yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
    const headSha = git(request.cwd, "rev-parse", "HEAD");
    const output: ReviewOutput = {
      schema: "awsf.review-output/v1",
      producerStatus: "success",
      verdict: "accept",
      reviewedSha: headSha,
      findings: [],
      limitations: [],
      summary: "Clean candidate.",
      artifacts: [],
      notesForNextPhase: "Accepted.",
    };
    yield {
      ...base,
      seq: 2,
      kind: "model.resolved",
      adapter: this.id,
      provider: "anthropic",
      requestedModel: request.model,
      resolvedModel: request.model,
      provenance: "stream-authoritative",
    };
    yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(output) };
    yield {
      ...base,
      seq: 4,
      kind: "usage",
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" },
    };
    yield { ...base, seq: 5, kind: "run.completed", exitCode: 0 };
  }
}

test("B7-11: slugifyPlanStem normalizes task id to valid plan stem", () => {
  assert.equal(slugifyPlanStem("TASK-123"), "task-123");
  assert.equal(slugifyPlanStem("My Task ID 123!"), "my-task-id-123");
  assert.equal(slugifyPlanStem("---leading-trailing---"), "leading-trailing");
  assert.equal(slugifyPlanStem("foo__bar"), "foo-bar");
  assert.equal(slugifyPlanStem(""), "plan");
  assert.equal(slugifyPlanStem("   "), "plan");
  assert.equal(slugifyPlanStem("---"), "plan");
  assert.equal(slugifyPlanStem("@#$%"), "plan");
});

test("B7-13: isReviewTransportFailure treats ProductionRouteUnavailable as not a transport retry", () => {
  const routeError = new ProductionRouteUnavailable("reviewer", "route is disabled or undeclared");
  assert.equal(isReviewTransportFailure(routeError), false);

  const transportError = new AdapterError("claude", "E_BACKEND_FAILURE", "network reset");
  assert.equal(isReviewTransportFailure(transportError), true);

  const refusalError = new AdapterError("claude", "E_QUOTA_EXHAUSTED", "model quota exhausted");
  assert.equal(isReviewTransportFailure(refusalError), false);

  const genericError = new Error("something went wrong");
  assert.equal(isReviewTransportFailure(genericError), false);
});

test("B7-14: seed commit re-use in prove replay when worktree HEAD is already the seed commit", async () => {
  const b = box();
  try {
    const patchPath = join(b.repository, PROVING_GROUND_DIR, "probe-01.patch");
    mkdirSync(dirname(patchPath), { recursive: true });
    writeFileSync(patchPath, "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n Synthetic replay.\n+seeded\n");
    const itemPath = join(b.repository, PROVING_GROUND_DIR, "probe-01.json");
    const baseSha = git(b.repository, "rev-parse", "HEAD");
    writeFileSync(
      itemPath,
      JSON.stringify({
        schema: "awsf.proving-ground-item/v1",
        id: "probe-01",
        kind: "review",
        taskClass: "evidence-heavy-defect-review",
        role: "reviewer",
        baseSha,
        request: "Report the seeded defect.",
        seed: { patch: `${PROVING_GROUND_DIR}/probe-01.patch`, defectClass: "off-by-one", expected: [{ file: "README.md", lineStart: 2, lineEnd: 2 }] },
      }),
    );
    commit(b.repository, "test: add prove item");

    const prove = await proveCommand({
      stateRoot: b.stateRoot,
      project: b.config.project.slug,
      taskId: "prove-task",
      repository: b.repository,
      itemId: "probe-01",
      arm: "claude/anthropic/claude:opus@high",
      repetition: 1,
      reason: "verify prove replay seed reuse",
      terminal: OWNER,
      config: b.config,
    });
    assert.equal(prove.confirmed, true);

    const attemptDir = join(b.stateRoot, "projects", b.config.project.slug, "tasks", "prove-task", "1");
    await start(b, attemptDir);

    const status = await readAttempt(attemptDir);
    const worktree = status.worktree!;
    const seedMessage = "Report the seeded defect.";
    writeFileSync(join(worktree, "README.md"), "Synthetic replay.\nseeded\n");
    git(worktree, "add", "README.md");
    git(worktree, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", seedMessage);

    const result = await runProductionCommand({
      attemptDir,
      stateRoot: b.stateRoot,
      config: b.config,
      configPath: b.configPath,
      projectRecord: b.projection.project,
      infrastructure: {
        ...b.infrastructure,
        sandboxProbe: (executable: string) => executable === "bwrap",
        adapterFor: (_entry: unknown, id: string) => new ProveReviewStub(id),
      },
    });

    if (result.lifecycleState !== "AWAITING_OWNER") {
      console.log("PROVE RESULT:", result.lifecycleState, result.blocker, result.lastActivity);
    }
    assert.equal(result.lifecycleState, "AWAITING_OWNER");
  } finally {
    b.close();
  }
});

test("B7-16 & B7-26: GATING error handling distinguishes projection failure from non-projection failure", async () => {
  const b1 = box();
  try {
    const created = await draft(b1);
    await prepare(b1, created.attemptDir);
    await start(b1, created.attemptDir);

    const projectionStatus = await runProductionCommand({
      attemptDir: created.attemptDir,
      stateRoot: b1.stateRoot,
      config: b1.config,
      configPath: b1.configPath,
      projectRecord: b1.projection.project,
      infrastructure: {
        ...b1.infrastructure,
        adapterFor: (_entry: unknown, id: string) => new SuccessStub(id),
      },
      assertAdvancement: () => {
        throw new Error("sqlite-projection-failed: projection lagged behind");
      },
    });

    assert.equal(projectionStatus.lifecycleState, "GATING", "B7-26: projection failure holds at GATING");
    assert.equal(projectionStatus.blocker?.code, "sqlite-projection-failed");
    assert.match(projectionStatus.lastActivity, /advancement held at GATING/);
  } finally {
    b1.close();
  }

  const b2 = box();
  try {
    const created = await draft(b2);
    await prepare(b2, created.attemptDir);
    await start(b2, created.attemptDir);

    await assert.rejects(
      runProductionCommand({
        attemptDir: created.attemptDir,
        stateRoot: b2.stateRoot,
        config: b2.config,
        configPath: b2.configPath,
        projectRecord: b2.projection.project,
        infrastructure: {
          ...b2.infrastructure,
          adapterFor: (_entry: unknown, id: string) => new SuccessStub(id),
        },
        assertAdvancement: () => {
          throw new Error("unexpected gate execution abort");
        },
      }),
      /unexpected gate execution abort/,
      "B7-16: non-projection error in GATING throws rather than holding at GATING or masking as projection failure",
    );
  } finally {
    b2.close();
  }
});

test("B7-17: prepareResumeInstruction appends planAuthorSuffix for PLAN_AUTHOR_OUTPUT_SCHEMA_ID", async () => {
  const b = box();
  try {
    const plan = "spine";
    const project = b.config.project.slug;
    const projectDir = join(b.stateRoot, "projects", project);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "placement.yaml"),
      `version: awsf.placement/v1\nproject: ${project}\nrepositories:\n  fixture:\n    path: ${b.repository}\n`,
    );

    writeFileSync(
      join(b.repository, "awsf.project.yaml"),
      `version: awsf.project/v1\nproject:\n  slug: ${project}\nrepositories:\n  fixture:\n    role: plan\n    default_branch: main\nplans:\n  root: specs\n  format: awsf-plan-html/v1\n  default: ${plan}\n`,
    );
    mkdirSync(join(b.repository, "specs", "tickets", plan), { recursive: true });
    writeFileSync(join(b.repository, "specs", `${plan}.html`), '<h3><code class="status">[]</code> Milestone M1: Spine</h3>\n');
    const ticketBody = "---\nid: W01\ntitle: Spine ticket\nmilestone: M1\nstate: todo\ndepends_on: []\n---\n# W01\n";
    writeFileSync(join(b.repository, "specs", "tickets", plan, "W01.md"), ticketBody);
    commit(b.repository, "test: register spine plan");

    const ticketSelection = await sealPlanTicketSelection(
      { repository: b.repository, stateRoot: b.stateRoot, project, stem: plan },
      ["W01"],
    );

    mkdirSync(join(b.root, "prompts", "plan-author"), { recursive: true });
    writeFileSync(join(b.root, "prompts/plan-author/system.md"), readFileSync(resolve("prompts/plan-author/system.md")));
    writeFileSync(join(b.root, "prompts/plan-author/user.md"), readFileSync(resolve("prompts/plan-author/user.md")));

    const planner = b.config.agents.find((agent) => agent.name === "planner")!;
    const authorRole = {
      ...planner,
      name: "plan-author",
      purpose: "Author new plan sets in session output only",
      prompt: { system: "prompts/plan-author/system.md", user: "prompts/plan-author/user.md" },
      tools: { profile: "managed-worker" as const, allow: ["read", "grep", "find", "ls", "edit", "write"] },
      writes: [],
    };
    const configWithAuthor = {
      ...b.config,
      workflows: { enabled: [...b.config.workflows.enabled, "plan-author"] },
      agents: [...b.config.agents, authorRole],
    };

    const created = await newCommand({
      stateRoot: b.stateRoot,
      project,
      taskId: "plan-author-task",
      repository: b.repository,
      request: "Author the spine plan",
      workflow: "plan-author",
      tier: 2,
      planRef: plan,
      ticketSelection,
      configSnapshotJson: JSON.stringify(configWithAuthor),
    });

    const status = await readAttempt(created.attemptDir);
    const inspected = {
      checkpoint: { prefix: ["request"] },
      status,
      envelopes: new Map(),
      instructions: [],
    } as unknown as RecoveryInspection;
    const instructionPlan = await prepareResumeInstruction(
      {
        attemptDir: created.attemptDir,
        stateRoot: b.stateRoot,
        config: configWithAuthor,
        configPath: b.configPath,
      },
      inspected,
    );

    assert.ok(instructionPlan.originalPrompt.includes("Host-sealed spine selection:"));
    assert.ok(instructionPlan.originalPrompt.includes("Write plan.html, build-prompts.md and tickets.json here only."));
    assert.ok(instructionPlan.originalPrompt.includes(join(created.attemptDir, "private", "plan-author")));

    const buildTask = await draft(b);
    const buildStatus = await readAttempt(buildTask.attemptDir);
    const buildInspected = {
      checkpoint: { prefix: ["request"] },
      status: buildStatus,
      envelopes: new Map(),
      instructions: [],
    } as unknown as RecoveryInspection;
    const buildPlan = await prepareResumeInstruction(
      {
        attemptDir: buildTask.attemptDir,
        stateRoot: b.stateRoot,
        config: b.config,
        configPath: b.configPath,
      },
      buildInspected,
    );
    assert.equal(buildPlan.originalPrompt.includes("Host-sealed spine selection:"), false);
  } finally {
    b.close();
  }
});

test("B7-25: persistEnvelope allows overwriting when envelope exists from interrupted attempt without record in storedEnvelopes", async () => {
  const b = box();
  try {
    const created = await draft(b);
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);

    const staleEnvelopePath = join(created.attemptDir, "envelopes", "builder-0.json");
    mkdirSync(dirname(staleEnvelopePath), { recursive: true });
    writeFileSync(staleEnvelopePath, JSON.stringify({ stale: true }));

    const status = await runProductionCommand({
      attemptDir: created.attemptDir,
      stateRoot: b.stateRoot,
      config: b.config,
      configPath: b.configPath,
      projectRecord: b.projection.project,
      infrastructure: {
        ...b.infrastructure,
        adapterFor: (_entry: unknown, id: string) => new SuccessStub(id),
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(existsSync(staleEnvelopePath), true);
    const written = JSON.parse(readFileSync(staleEnvelopePath, "utf8"));
    assert.equal(written.schemaId, "awsf.build-output/v1");
    assert.equal(written.stale, undefined);
  } finally {
    b.close();
  }
});

test("B7-29: the protected-grant sandbox check asks the injected runCommand, not the host", { skip: process.platform !== "linux" }, () => {
  const asked: string[] = [];
  const seam = (status: number) => ({
    runCommand: (executable: string, argv: readonly string[]) => {
      asked.push(`${executable} ${argv.join(" ")}`);
      return { status } as unknown as ReturnType<ProductionInfrastructure["runCommand"]>;
    },
  }) as unknown as Pick<ProductionInfrastructure, "runCommand" | "sandboxProbe">;

  assert.equal(protectedSandboxAvailable(seam(1)), false, "an injected seam that reports bwrap absent is believed");
  assert.deepEqual(asked, ["bwrap --version"]);
  assert.equal(protectedSandboxAvailable(seam(0)), true, "an injected seam that reports bwrap present is believed");
  assert.deepEqual(asked, ["bwrap --version", "bwrap --version"]);
  const probed = { ...seam(1), sandboxProbe: (executable: string) => executable === "bwrap" } as Pick<ProductionInfrastructure, "runCommand" | "sandboxProbe">;
  assert.equal(protectedSandboxAvailable(probed), true, "an explicit sandbox probe answers without a command");
  assert.equal(asked.length, 2, "the probe answered, so no command ran");
});

test("B7-30 & B7-35: persistEnvelope refuses before writing raw bytes, and makes bytes durable before journaling", () => {
  const source = readFileSync(resolve("core/src/cli/commands/production-run.ts"), "utf8");
  const start = source.indexOf("const persistEnvelope = async");
  const end = source.indexOf("const persistGate = async");
  assert.ok(start >= 0 && end > start, "persistEnvelope is present in its closure");
  const body = source.slice(start, end);

  const refusal = body.indexOf("immutable envelope already exists");
  const rawWrite = body.indexOf("writeFile(rawAbsolute");
  assert.ok(refusal >= 0 && rawWrite >= 0 && refusal < rawWrite, "B7-30: the refusal precedes the raw write that would replace an earlier reply's bytes");

  const journal = body.indexOf('persist("attempt.updated"');
  for (const target of ["fsyncPath(rawAbsolute)", "fsyncPath(dirname(rawAbsolute))", "fsyncPath(envelopePath)", "fsyncPath(dirname(envelopePath))"]) {
    const at = body.indexOf(target);
    assert.ok(at >= 0 && at < journal, `B7-35: ${target} runs before the envelope journal record cites its digest`);
  }
});

/** Drives a tier-1 build with the success stub to its owner stop. */
async function runToOwner(b: ReturnType<typeof box>) {
  const created = await draft(b);
  await prepare(b, created.attemptDir);
  await start(b, created.attemptDir);
  const status = await runProductionCommand({
    attemptDir: created.attemptDir,
    stateRoot: b.stateRoot,
    config: b.config,
    configPath: b.configPath,
    projectRecord: b.projection.project,
    infrastructure: {
      ...b.infrastructure,
      adapterFor: (_entry: unknown, id: string) => new SuccessStub(id),
    },
  });
  return { created, status };
}

test("B7-31: agent envelopes take the injected clock, as host envelopes and the journal do", async () => {
  const b = box();
  try {
    const { created, status } = await runToOwner(b);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    const envelope = JSON.parse(readFileSync(join(created.attemptDir, "envelopes", "builder-0.json"), "utf8"));
    assert.equal(envelope.createdAt, AT, "the agent envelope must carry the pinned clock, not the wall clock");
  } finally {
    b.close();
  }
});

test("B7-32: a landing below T2 records its journey as not approved, since no journey happened", async () => {
  const b = box();
  try {
    const { created, status } = await runToOwner(b);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.tier, 1);
    assert.equal(status.journeyApproved, false, "the journey flag is never assumed true without a journey");
    assert.equal((await readAttempt(created.attemptDir)).journeyApproved, false);
  } finally {
    b.close();
  }
});

test("B7-33: resume under a config that no longer defines a retained phase's agent refuses by name, not with a TypeError", async () => {
  const world = box();
  try {
    const created = await draft(world);
    const storeDir = join(world.root, "synthetic-session-store");
    mkdirSync(storeDir);
    const store = new ContinuityStore({ path: continuityFilePath(created.attemptDir), newSessionId: () => "synthetic-session" });
    await store.open({ phaseId: "builder", adapter: "pi-codex", provider: "openai-codex",
      model: world.config.agents.find(agent => agent.name === "builder")!.model, storeDir });
    const renamed = { ...world.config, agents: world.config.agents.map(agent => agent.name === "builder" ? { ...agent, name: "builder-renamed" } : agent) };

    let failure: unknown;
    try {
      await resumeProductionCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot, config: renamed,
        configPath: world.configPath, reason: "inspect retained continuity", terminal: OWNER,
        projectRecord: world.projection.project, infrastructure: world.infrastructure });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error, "resume must refuse");
    assert.equal(failure instanceof TypeError, false, `refused with a TypeError: ${String(failure)}`);
    assert.match(failure.message, /configuration, request, recipe or prompts changed/);
  } finally {
    world.close();
  }
});
