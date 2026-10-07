// Synthetic repositories only. This is a replay fixture, not T03's trap/mutant harness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { isTaskEdgeRegistration, reservationIdOf, type Availability, type HarnessAdapter, type BrokerProcessRegistration, type ModelInfo, type ModelRequest, type TransportBroker } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { loadConfig } from "../../../src/config/load.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import { resolveExecutable, type BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { k1Request, prepareK1 } from "../../fixtures/k1-preflight.ts";

export const AT = "2026-10-07T12:00:00Z";
export const OWNER = { interactive: true, write: () => {}, confirm: async () => true };
export function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}
export function commit(repository: string, message = "test: synthetic replay base"): string {
  git(repository, "add", ".");
  git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}
export function box(configure: (config: AwsfConfig) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "awsf-seed-replay-"));
  const repository = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", repository]);
  writeFileSync(join(repository, "README.md"), "Synthetic replay.\n");
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  commit(repository);
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  config.runtime.seed_paths = [];
  for (const agent of config.agents) agent.harness.interrupted_turn = false;
  // Explicitly discard journeys as every synthetic config copying shipped gates does.
  delete config.gates.journeys;
  delete config.gates.typecheck;
  delete config.gates.lint;
  config.gates.test = { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 };
  configure(config);
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  for (const agent of config.agents) {
    for (const path of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), readFileSync(resolve(path)));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md")));
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktrees");
  const projection = createDashboardProjection(stateRoot);
  const calls: BrokerProcessRegistration[] = [];
  const adapters: ReplayStub[] = [];
  const infrastructure = {
    adapterFor: (_entry: unknown, id: string) => {
      const adapter = new ReplayStub(id);
      adapters.push(adapter);
      return adapter;
    },
    createBroker: (options: BrokerOptions): TransportBroker => ({
      async startProcess(registration, spec) {
        const record = {
          identity: { pid: 4242, pgid: 4242, startIdentity: "synthetic:4242", startIdentitySource: "fixture" },
          runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
          ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId,
            workflowId: registration.workflowId, phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal,
            adapterId: registration.adapterId, role: registration.role } } : {}),
          reservationId: reservationIdOf(registration),
          command: [spec.executable === "bwrap" ? resolveExecutable("bwrap", spec.env) : spec.executable, ...spec.argv], cwd: spec.cwd,
        };
        if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
        await options.register(record);
        calls.push(registration);
        const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
        await options.onSpent?.(record, reservation);
        return { runId: registration.runId, identity: record.identity,
          stdout: (async function* () {})(), stderr: (async function* () {})(), exit: Promise.resolve({ code: 0, signal: null }),
          cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }) };
      },
    }),
    sandboxProbe: () => false,
    now: () => AT,
  };
  return { root, repository, stateRoot, worktreeRoot, config, configPath, projection, calls, adapters, infrastructure,
    close() { projection.close(); rmSync(root, { recursive: true, force: true }); } };
}
export type Box = ReturnType<typeof box>;

// Scripted stub routes follow production-runner.test.ts: preserve the exact
// selected adapter/provider metadata and spend only through the recording GO
// broker. No route falls back, and no provider CLI is invoked.
export class ReplayStub implements HarnessAdapter {
  launches = 0;
  readonly id: string;
  constructor(id: string) { this.id = id; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model,
      contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none",
      usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest) {
    return { executable: "synthetic-provider", argv: request.systemPromptPath === undefined ? [] : ["--append-system-prompt", request.systemPromptPath],
      cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false as const };
  }
  async *parse(): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.launches++;
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "run.failed", seq: 2, runId: registration.runId, hostAt: AT, providerAt: null,
      errorCode: "E_BACKEND_FAILURE", message: "synthetic stop after GO" };
  }
}

export async function draft(b: Box, request = k1Request("replay a sealed seed", "core/src/example.ts"), workflow = "build", shift = false) {
  let selection;
  if (shift) {
    const path = "specs/tickets/synthetic/T01.md";
    const text = "---\nid: T01\ntitle: Write the forbidden plan\nmilestone: M1\nstate: todo\ndepends_on: []\n---\n# T01\n\n## Build prompt\n\n```\nWrite specs/synthetic.html.\n```\n";
    mkdirSync(dirname(join(b.repository, path)), { recursive: true });
    writeFileSync(join(b.repository, path), text);
    commit(b.repository);
    selection = sealShiftManifest({ plan: "synthetic", milestones: ["M1"], tickets: [{ id: "T01", path, digest: ticketFileDigest(Buffer.from(text)) }] });
  }
  return newCommand({ stateRoot: b.stateRoot, project: b.config.project.slug, taskId: "synthetic-seed", repository: b.repository,
    request, workflow, tier: workflow === "build" ? 1 : 2, configSnapshotJson: toConfigSnapshotJson(b.config),
    projectRecord: b.projection.project, ...(selection === undefined ? {} : { shift: selection }) });
}
export async function prepare(b: Box, attemptDir: string, options: Partial<Parameters<typeof prepareK1>[0]> = {}) {
  return prepareK1({ attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot, projectRecord: b.projection.project, ...options });
}
export async function start(b: Box, attemptDir: string) {
  return startCommand({ attemptDir, configPath: b.configPath, worktreeRoot: b.worktreeRoot,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: b.projection.project });
}
export async function run(b: Box, attemptDir: string, infrastructure = b.infrastructure) {
  return runProductionCommand({ attemptDir, stateRoot: b.stateRoot, config: b.config, configPath: b.configPath,
    projectRecord: b.projection.project, infrastructure });
}
export async function update(b: Box, attemptDir: string, changes: Partial<AttemptStatus>) {
  const status = await readAttempt(attemptDir);
  return persistAttempt(attemptDir, status.revision, { kind: "attempt.updated", next: nextRevision(status, changes) }, b.projection.project);
}
export function assertCalled(b: Box, status: AttemptStatus, before = 0) {
  assert.equal(b.calls.length, before + 1, `exactly one synthetic GO was reached: ${JSON.stringify(status.blocker)}`);
  assert.equal(status.budget.callsReserved, 0, "the synthetic call settled");
  assert.equal(status.budget.callsSpent, before + 1);
  assert.equal(b.adapters.reduce((n, a) => n + a.launches, 0), before + 1);
}
