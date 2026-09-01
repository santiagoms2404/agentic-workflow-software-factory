// The offline design-to-plan world, factored out of `design-to-plan-route.test.ts`
// so W11's five-stage journey extends it rather than growing a second harness.
//
// Everything here is offline by construction: the adapter is a `StubAdapter`
// subclass that yields canned envelopes without letting the fixture provider
// process start, and the broker is a fake that registers a launch and spends
// the reservation without spawning anything. No case built on this module
// contacts a provider, opens a socket, or spends quota.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";

import { StubAdapter } from "../../../src/adapters/stub.ts";
import type {
  BrokerProcessRegistration,
  ModelRequest,
  ProcessTransport,
  TransportBroker,
} from "../../../src/adapters/interface.ts";
import { isTaskEdgeRegistration, reservationIdOf } from "../../../src/adapters/interface.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { toConfigSnapshotJson } from "../../../src/config/effective-config.ts";
import type { ArchitectureReviewOutput } from "../../../src/contracts/architecture-review-output.ts";
import type { DesignOutput } from "../../../src/contracts/design-output.ts";
import type { DesignPlanOutput } from "../../../src/contracts/design-plan-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import type { AttemptProjector } from "../../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { raiseCommand } from "../../../src/cli/commands/raise.ts";
import { correctionHeadroom } from "../../../src/cli/commands/workflows.ts";
import { workflowRecipe } from "../../../src/workflow/catalog.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { startCommand } from "../../../src/cli/commands/start.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { writePlacement } from "../../../src/registry/placement.ts";

export const STUB_PROVIDER = resolve("core/test/fixtures/providers/stub/stub-provider.mjs");
export const REQUEST = "Make design claims traceable into rendered tickets.";
export const STEM = "generated-plan";

/** The three roles `design-to-plan` reaches; the default fixture routing set. */
export const DESIGN_TO_PLAN_ROLES = ["designer", "architecture-reviewer", "planner"] as const;

export function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** Records every provider actually contacted, so a quiet route is observed. */
export class RouteLog {
  readonly providers: string[] = [];
  readonly launches: string[] = [];
}

export interface FixtureConfigOptions {
  /** Roles rerouted onto the stub adapter. Defaults to `DESIGN_TO_PLAN_ROLES`. */
  readonly roles?: readonly string[];
  /** Project slug the fixture runs under. Defaults to the committed slug. */
  readonly slug?: string;
}

export function fixtureConfig(options: FixtureConfigOptions = {}): AwsfConfig {
  const loaded = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  const fixtureRoles = new Set<string>(options.roles ?? DESIGN_TO_PLAN_ROLES);
  return {
    ...loaded,
    project: options.slug === undefined ? loaded.project : { ...loaded.project, slug: options.slug },
    runtime: { ...loaded.runtime, seed_paths: [] },
    agents: loaded.agents.map((agent) => fixtureRoles.has(agent.name)
      ? {
          ...agent,
          model: "stub/success",
          thinking: "none" as const,
          harness: { adapter: "stub", continuity: "none" as const },
        }
      : agent),
    gates: {},
  };
}

/** Copies each role's committed prompt pair beside a fixture configuration. */
export function installPrompts(configDir: string, roles: readonly string[] = DESIGN_TO_PLAN_ROLES): void {
  for (const role of roles) {
    for (const kind of ["system", "user"] as const) {
      const destination = join(configDir, "prompts", role, `${kind}.md`);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(`prompts/${role}/${kind}.md`), "utf8"));
    }
  }
  const shared = join(configDir, "prompts", "shared", "headless-role.md");
  mkdirSync(dirname(shared), { recursive: true });
  writeFileSync(shared, readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
}

export function design(): DesignOutput {
  return {
    schema: "awsf.design-output/v1",
    producerStatus: "success",
    summary: "Designed a traceable plan spine.",
    artifacts: [],
    notesForNextPhase: "Review every declared design claim.",
    answeredRequest: REQUEST,
    components: [{ name: "plan renderer", responsibility: "Render one synchronized plan and ticket set." }],
    decisions: [{ id: "D-1", statement: "Render plan documents from one validated envelope." }],
    invariants: [{ id: "INV-1", statement: "Every rendered ticket mirrors its plan task." }],
    acceptanceCriteria: [{
      id: "AC-1",
      statement: "The rendered plan and ticket set pass the ticket-plan-sync fence.",
      verifiedBy: "Run the ticket-plan-sync assertions.",
    }],
    openQuestions: [],
  };
}

export function review(blocked: boolean): ArchitectureReviewOutput {
  return {
    schema: "awsf.architecture-review-output/v1",
    producerStatus: "success",
    summary: blocked ? "Found one blocking architecture defect." : "Reviewed the traceable plan spine.",
    artifacts: [],
    notesForNextPhase: blocked ? "Return the design to its owner." : "Carry the reviewed spine into planning.",
    reviewedDesign: design().summary,
    verdict: blocked ? "concern" : "accept",
    findings: [{
      id: "F1",
      severity: blocked ? "high" : "medium",
      subject: "AC-1",
      title: blocked ? "Blocking coverage gap" : "Keep coverage explicit",
      detail: blocked
        ? "The proposed rendering path does not prove every declaration is served."
        : "The rendered set must retain an explicit coverage assertion.",
      evidence: blocked ? "blocking-review-evidence" : "ticket-plan-sync includes COVERAGE and MIRROR",
    }],
    limitations: ["Did not execute a provider or inspect a live subscription."],
  };
}

export function plan(): DesignPlanOutput {
  return {
    schema: "awsf.design-plan-output/v1",
    producerStatus: "success",
    summary: "Plan the synchronized rendered set.",
    artifacts: [],
    notesForNextPhase: "Render the plan, prompt, and ticket from this envelope.",
    milestones: [{ id: "M1", title: "Synchronized output" }],
    steps: [{
      id: "T01",
      title: "Render the synchronized plan set",
      milestone: "M1",
      files: ["specs/generated-plan.html", "specs/tickets/generated-plan/T01.md"],
      serves: ["INV-1", "AC-1"],
      dependsOn: [],
      buildPrompt: "Render the plan and verify its ticket-plan synchronization.",
    }],
    testStrategy: ["Run the ticket-plan-sync assertions against the rendered set."],
    risks: [{ risk: "A renderer copy can drift.", mitigation: "Render every copy from the same envelope." }],
    openQuestions: [],
  };
}

export interface CannedStubOptions {
  /** Written only if the fixture provider process actually runs, which it must not. */
  readonly sideEffectPath: string;
  readonly responses: readonly EnvelopeBase[];
  readonly log?: RouteLog;
  /** Lets a caller apply a scripted envelope's claimed effect to its worktree. */
  readonly onResponse?: (response: EnvelopeBase) => void;
}

export class CannedStubAdapter extends StubAdapter {
  readonly requests: ModelRequest[] = [];
  readonly #responses: EnvelopeBase[];
  readonly #log: RouteLog | null;
  readonly #onResponse: ((response: EnvelopeBase) => void) | null;

  constructor(options: CannedStubOptions) {
    super({ providerPath: STUB_PROVIDER, sideEffectPath: options.sideEffectPath });
    this.#responses = [...options.responses];
    this.#log = options.log ?? null;
    this.#onResponse = options.onResponse ?? null;
  }

  get responsesRemaining(): number {
    return this.#responses.length;
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    this.#log?.providers.push("stub");
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.#log?.launches.push("stub");
    this.requests.push(request);
    const response = this.#responses.shift();
    if (response === undefined) throw new Error("the route requested an unplanned fixture call");
    this.#onResponse?.(response);
    const at = "2026-08-24T00:00:00.000Z";
    yield {
      kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, requestedModel: request.model,
    };
    yield {
      kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null,
      adapter: this.id, provider: "stub", requestedModel: request.model,
      resolvedModel: "stub-model-1", provenance: "stream-authoritative",
    };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(response) };
    yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

export function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec): Promise<ProcessTransport> {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" as const },
        runId: registration.runId,
        edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? {
          phase: {
            taskSessionId: registration.taskSessionId,
            workflowId: registration.workflowId,
            phaseId: registration.phaseId,
            phaseOrdinal: registration.phaseOrdinal,
            adapterId: registration.adapterId,
            role: registration.role,
          },
        } : {}),
        reservationId: reservationIdOf(registration),
        command: [spec.executable, ...spec.argv],
        cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId,
        identity: record.identity,
        stdout: (async function* () {})(),
        stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

export interface PrepareTaskInput {
  readonly stateRoot: string;
  readonly project: string;
  readonly taskId: string;
  readonly repository: string;
  readonly request: string;
  readonly workflow: string;
  readonly tier: 1 | 2;
  readonly worktreeRoot: string;
  readonly configPath: string;
  readonly configSnapshotJson: string;
  readonly projectRecord: AttemptProjector;
}

export interface PreparedTask {
  readonly attemptDir: string;
  readonly sessionId: string;
  readonly worktree: string;
}

/** `newCommand` then `startCommand`: one task minted at DRAFT and prepared at L1. */
/**
 * Grant the one call `awsf start` now refuses to proceed without.
 *
 * `scout`, `plan` and `design-to-plan` need exactly as many provider calls as
 * their tier ceiling allows, so every correction round they declare is
 * unfundable and `start` refuses. A fixture that wants to drive them takes the
 * owner's own remedy — which is also what proves the remedy works.
 */
export async function fundCorrections(
  attemptDir: string,
  config: AwsfConfig,
  workflow: string,
  projectRecord?: AttemptProjector,
): Promise<void> {
  const recipe = workflowRecipe(workflow);
  if (recipe === null) return;
  const headroom = correctionHeadroom(config, recipe);
  if (!headroom.unfundable) return;
  await raiseCommand({
    attemptDir,
    calls: headroom.callsNeeded,
    reason: `fixture funds ${String(headroom.callsNeeded)} cold correction on ${workflow}`,
    terminal: { interactive: true, write: () => {}, confirm: async () => true },
    ...(projectRecord === undefined ? {} : { projectRecord }),
  });
}

export async function prepareTask(input: PrepareTaskInput): Promise<PreparedTask> {
  const created = await newCommand({
    stateRoot: input.stateRoot,
    project: input.project,
    taskId: input.taskId,
    repository: input.repository,
    request: input.request,
    workflow: input.workflow,
    tier: input.tier,
    configSnapshotJson: input.configSnapshotJson,
    projectRecord: input.projectRecord,
  });
  await fundCorrections(
    created.attemptDir,
    loadConfig(readFileSync(input.configPath, "utf8")),
    input.workflow,
    input.projectRecord,
  );
  const prepared = await startCommand({
    attemptDir: created.attemptDir,
    worktreeRoot: input.worktreeRoot,
    configPath: input.configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    projectRecord: input.projectRecord,
  });
  assert.notEqual(prepared.worktree, null);
  return {
    attemptDir: created.attemptDir,
    sessionId: created.status.sessionId,
    worktree: prepared.worktree!,
  };
}

export interface World {
  readonly root: string;
  readonly canonical: string;
  readonly stateRoot: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly attemptDir: string;
  readonly sessionId: string;
  readonly worktree: string;
  readonly projection: ReturnType<typeof createDashboardProjection>;
}

/** A seeded plan repository, a written placement, and one prepared design-to-plan task. */
export async function world(): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "awsf-design-to-plan-route-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  mkdirSync(canonical, { recursive: true });
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "fixture plan repository\n");
  writeFileSync(join(canonical, "awsf.project.yaml"), [
    "version: awsf.project/v1",
    "",
    "project:",
    "  slug: agentic-workflow-software-factory",
    "",
    "repositories:",
    "  fixture:",
    "    role: plan",
    "    default_branch: main",
    "    gates: {}",
    "",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
    "  default: generated-plan",
    "",
  ].join("\n"));
  git(canonical, "add", "README.md", "awsf.project.yaml");
  git(
    canonical,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", "test: seed design route",
  );

  const config = fixtureConfig();
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, stringify(config));
  installPrompts(root);

  await writePlacement(stateRoot, config.project.slug, {
    version: "awsf.placement/v1",
    project: config.project.slug,
    repositories: { fixture: { path: canonical } },
    worktree_root: join(root, "worktrees"),
  });
  const projection = createDashboardProjection(stateRoot);
  const prepared = await prepareTask({
    stateRoot,
    project: config.project.slug,
    taskId: STEM,
    repository: canonical,
    request: REQUEST,
    workflow: "design-to-plan",
    tier: 1,
    worktreeRoot: join(root, "worktrees"),
    configPath,
    configSnapshotJson: toConfigSnapshotJson(config),
    projectRecord: projection.project,
  });
  return {
    root,
    canonical,
    stateRoot,
    config,
    configPath,
    attemptDir: prepared.attemptDir,
    sessionId: prepared.sessionId,
    worktree: prepared.worktree,
    projection,
  };
}
