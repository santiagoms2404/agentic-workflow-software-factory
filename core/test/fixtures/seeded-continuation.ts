import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { loadConfig } from "../../src/config/load.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, type AttemptStatus } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { isTaskEdgeRegistration, reservationIdOf, type HarnessAdapter, type ModelRequest, type ProcessSpec, type TransportBroker, type BrokerProcessRegistration, type ProcessTransport } from "../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { SeedCommandOptions } from "../../src/cli/commands/seed.ts";

export const AT = "2026-09-01T00:00:00.000Z";
export const INHERITED = "core/src/inherited.ts";
export const AUTHORED = "core/src/authored.ts";
export const fixtureIdentity = { pid: 2147483000, pgid: 2147483000, startIdentity: "fixture-seed-process", startIdentitySource: "fixture" };

export function git(repository: string, ...argv: string[]): string {
  const result = runSystemCommand("git", ["-C", repository, ...argv], {
    timeoutMs: 10_000,
    env: { ...process.env, GIT_AUTHOR_NAME: "Santiago Marin", GIT_AUTHOR_EMAIL: "santiagomarinsuarez@me.com",
      GIT_COMMITTER_NAME: "Santiago Marin", GIT_COMMITTER_EMAIL: "santiagomarinsuarez@me.com" },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error || "fixture Git failed");
  return result.stdout.trim();
}

export async function seedFixture(options: { inherited?: string; sealed?: "BLOCKED" | "CANCELLED"; missingL7?: boolean; unsettled?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "awsf-seed-test-"));
  const repository = join(root, "canonical");
  const stateRoot = join(root, "state");
  git(root, "init", "--quiet", "-b", "main", repository);
  writeFileSync(join(repository, "README.md"), "base\n");
  git(repository, "add", "README.md");
  git(repository, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: initial seed fixture");
  const baseSha = git(repository, "rev-parse", "HEAD");
  const sourceTree = join(root, "source-tree");
  git(repository, "worktree", "add", "--detach", sourceTree, baseSha);
  const inherited = options.inherited ?? INHERITED;
  mkdirSync(dirname(join(sourceTree, inherited)), { recursive: true });
  writeFileSync(join(sourceTree, inherited), "export const inherited = 1;\n");
  git(sourceTree, "add", inherited);
  git(sourceTree, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "feat: inherited fixture change");
  const candidateSha = git(sourceTree, "rev-parse", "HEAD");
  // Seed assurance is exercised with scripted, ephemeral adapters.
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8").replaceAll("interrupted_turn: true", "interrupted_turn: false"));
  config.runtime.seed_paths = [];
  config.gates = { test: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } };
  config.risk.call_ceiling.T2 = 12;
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  for (const path of [...config.agents.flatMap((agent) => [agent.prompt.system, agent.prompt.user]), "prompts/shared/headless-role.md"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(resolve(path)));
  }
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: "source", repository,
    request: "source intent never transfers", workflow: "build-review", tier: 2, configSnapshotJson: toConfigSnapshotJson(config),
    now: () => AT, sessionId: () => "fixture-source-session" });
  let source = created.status;
  const record = { identity: fixtureIdentity, runId: "source-builder", edge: "L4" as const,
    reservationId: "source-paid-call", command: ["fixture"], cwd: sourceTree };
  const update = async (patch: Partial<AttemptStatus>, evidence?: AttemptEvidence) => {
    source = await persistAttempt(created.attemptDir, source.revision, { kind: "attempt.updated", next: nextRevision(source, patch),
      ...(evidence === undefined ? {} : { evidence }) });
  };
  await update({ lifecycleState: "RUNNING", baseSha, worktree: sourceTree, budget: { ...source.budget, callsSpent: 1 } }, {
    type: "process", phaseId: `${source.sessionId}:builder`, adapterId: "codex", role: "builder", record,
    status: "EXITED", registeredAt: AT, releasedAt: AT, endedAt: AT, exitCode: 0, exitSignal: null,
  });
  await update({ candidateSha }, { type: "phase", phase: {
    phaseId: `${source.sessionId}:builder`, ordinal: 2, key: "builder", name: "builder", kind: "agent", owner: "builder",
    description: "fixture candidate", status: "SUCCEEDED", correctionCount: 0, maxCorrections: 0,
    errorCode: null, errorMessage: null, startedAt: AT, endedAt: AT, createdAt: AT,
  } });
  await update({ lifecycleState: "GATING" }, options.missingL7 ? undefined : {
    type: "transition", id: "source-l7", seq: 1, from: "RUNNING", to: "GATING", actor: "host", edgeId: "L7",
    reasonSource: "git", reasonCode: null, reasonDetail: null, spawnSite: false, at: AT,
  });
  await update({ lifecycleState: options.sealed ?? "BLOCKED", budget: { ...source.budget, callsReserved: options.unsettled ? 1 : 0 },
    gatesPass: true, requiredReviewPresent: true, journeyApproved: true, protectedApprovalsValid: true,
    landingApproval: { candidateSha, summary: "source assurance", approvedAt: AT } });
  const lines: string[] = [];
  const seedOptions: SeedCommandOptions = { stateRoot, project: config.project.slug, repository, targetTaskId: "target",
    sourceTaskId: "source", sourceAttempt: 1, candidateSha, request: "add one target-authored change", workflow: "build-review",
    config, configPath, terminal: { interactive: true, write: (line) => { lines.push(line); }, confirm: async () => true }, now: () => AT };
  return { root, repository, sourceTree, stateRoot, baseSha, candidateSha, sourceDir: created.attemptDir,
    source, config, configPath, seedOptions, lines };
}

export function fakeSeedBroker(options: BrokerOptions): TransportBroker {
  return { async startProcess(registration, spec) {
    const record = { identity: fixtureIdentity, runId: registration.runId,
      edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
      ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId,
        phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
      reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd };
    if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
    await options.register(record);
    const spent = options.ledger.spendOnGo(reservationIdOf(registration));
    await options.onSpent?.(record, spent);
    return { runId: registration.runId, identity: fixtureIdentity, stdout: (async function* () {})(), stderr: (async function* () {})(),
      exit: Promise.resolve({ code: 0, signal: null }), cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }) };
  } };
}

export class SeedAdapter implements HarnessAdapter {
  readonly id: string;
  readonly prompts: string[];
  readonly dropInstruction: boolean;
  readonly writePath: string;
  constructor(id: string, prompts: string[], options: { dropInstruction?: boolean; writePath?: string } = {}) {
    this.id = id; this.prompts = prompts; this.dropInstruction = options.dropInstruction ?? false; this.writePath = options.writePath ?? AUTHORED;
  }
  async isAvailable() { return { status: "available" as const }; }
  async getModelInfo(model: string) {
    return { adapter: this.id, provider: this.id === "codex" ? "openai-codex" : "anthropic", requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none" as const,
      usageAuthority: "none" as const, costAuthority: "unavailable" as const };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "fixture", argv: [], cwd: request.cwd, env: request.env, stdin: this.dropInstruction ? "lost instruction" : request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration, signal: AbortSignal): AsyncIterable<NormalizedEvent> {
    this.prompts.push(request.prompt);
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const reviewing = registration.role === "reviewer";
    const documenting = registration.role === "documenter";
    const planning = registration.role === "planner";
    const path = documenting ? "docs/target.md" : this.writePath;
    if (!reviewing && !planning) {
      mkdirSync(dirname(join(request.cwd, path)), { recursive: true });
      writeFileSync(join(request.cwd, path), documenting ? "Target behavior documentation.\n" : "export const authored = 2;\n");
    }
    const payload = planning ? {
      schema: "awsf.plan-output/v1", producerStatus: "success", summary: "target plan", artifacts: [], notesForNextPhase: "implement target source",
      goals: ["extend the seed"], nonGoals: ["source assurance reuse"],
      implementationSteps: [{ id: "target-change", title: "add bounded source", files: [AUTHORED], acceptanceCriteria: ["configured gates pass"] }],
      testStrategy: ["host gates"], risks: [], openQuestions: [],
    } : documenting ? {
      schema: "awsf.document-output/v1", producerStatus: "success", summary: "target documentation", artifacts: [], notesForNextPhase: "fresh final tests",
      changedFiles: [path], documentedAreas: [{ subject: "target behavior", documentPath: path }], proposedCommitMessage: "docs: describe target behavior",
      runReport: { path: "reports/seed-target.md", markdown: "# Seed target\n\nDocumented the target behavior.\n" },
    } : reviewing ? {
      schema: "awsf.review-output/v1", producerStatus: "success", summary: "fresh target review", artifacts: [], notesForNextPhase: "owner journey",
      verdict: "accept", reviewedSha: git(request.cwd, "rev-parse", "HEAD"), findings: [], limitations: [{ detail: "scripted fixture", affectedFiles: [] }],
    } : { schema: "awsf.build-output/v1", producerStatus: "success", summary: "target-authored change", artifacts: [{ path: this.writePath, kind: "source", description: "target source" }],
      notesForNextPhase: "fresh tests", changedFiles: [this.writePath], implementationNotes: ["inherited bytes preserved"], commandsRun: [], proposedCommitMessage: "feat: target-authored fixture change" };
    const base = { runId: registration.runId, hostAt: AT, providerAt: null };
    yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
    yield { ...base, seq: 2, kind: "model.resolved", adapter: this.id, provider: this.id === "codex" ? "openai-codex" : "anthropic", requestedModel: request.model, resolvedModel: request.model, provenance: "route-attributed" };
    yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(payload) };
    yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
  }
}
