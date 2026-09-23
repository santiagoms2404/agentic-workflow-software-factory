import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registeredAdapter } from "../../adapters/registry.ts";
import { loadConfig } from "../../config/load.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import { createWorktree, seedWorktreePaths } from "../../git/worktrees.ts";
import { transition } from "../../state/task-machine.ts";
import { callCeilingsOf } from "../../state/tiers.ts";
import { correctionsFundableFor, minimumCallsFor, workflowRecipe } from "../../workflow/catalog.ts";
import { composePromptBundle } from "../../workflow/prompt-composition.ts";
import { correctionHeadroom } from "./workflows.ts";
import { verifiedTargetSeed, validateSeedStartup } from "../../workflow/candidate-seed.ts";
import { parseVisualBinding, recordVisualBinding, verifyVisualReferences, type VerifiedVisualReferences } from "../../workflow/visual-references.ts";
import type { VisualReferenceBinding } from "../../contracts/visual-references.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

export { defaultWorktreeRoot } from "../../persistence/platform-paths.ts";

export interface StartPreflight {
  readonly adapter: boolean;
  readonly sandbox: boolean;
  readonly observability: boolean;
}

export interface StartCommandOptions {
  readonly attemptDir: string;
  /** Outside both the repository and state root. */
  readonly worktreeRoot: string;
  readonly configPath?: string;
  readonly preflight?: (status: AttemptStatus) => Promise<StartPreflight> | StartPreflight;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
  /**
   * Owner launch context: a machine-local visual-reference binding file. It is
   * verified before any side effect and recorded before PREPARED, so an attempt
   * started with it can never run its bound phases without it.
   */
  readonly visualReferences?: string;
}

async function defaultPreflight(status: AttemptStatus, configPath: string): Promise<StartPreflight> {
  const config = loadConfig(await readFile(configPath, "utf8"));
  const selected = registeredAdapter(config.adapters, config.routing.default_worker);
  // A fixture route deliberately cannot be manufactured from committed config:
  // its executable is a test-owned absolute path. Tests inject that preflight;
  // production refuses rather than calling an unbound fixture "available".
  const adapter = selected !== null && (await selected.isAvailable()).status === "available";
  // The policy layer may truthfully expose tool-policy when an OS sandbox is
  // absent. Native Windows write-capable runs remain blocked by the later
  // permission broker; preparation itself does not invent an OS guarantee.
  return { adapter, sandbox: true, observability: true };
}

async function validateConfiguredPrompts(
  configPath: string,
  config: ReturnType<typeof loadConfig>,
  workflow: string,
): Promise<void> {
  const recipe = workflowRecipe(workflow);
  if (recipe === null) throw new Error(`workflow ${JSON.stringify(workflow)} has no shipped recipe`);
  const agents = new Map(config.agents.map((agent) => [agent.name, agent]));
  const checked = new Set<string>();
  for (const phase of recipe.phases) {
    if (phase.kind !== "agent" || checked.has(phase.owner)) continue;
    checked.add(phase.owner);
    const agent = agents.get(phase.owner);
    if (agent === undefined) {
      throw new Error(`workflow ${JSON.stringify(workflow)} requires configured agent ${JSON.stringify(phase.owner)}`);
    }
    await composePromptBundle({ configPath, agent });
  }
}

async function validateCanonicalRepository(repository: string): Promise<void> {
  const expected = await realpath(repository);
  const git = systemGitRunner(repository);
  const observed = await realpath(runGit(git, ["rev-parse", "--show-toplevel"]).trim());
  if (observed !== expected) {
    throw new Error(`attempt repository ${JSON.stringify(repository)} resolves to ${JSON.stringify(expected)}, but Git identifies ${JSON.stringify(observed)} as its top level`);
  }
  if (runGit(git, ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
    throw new Error(`attempt repository ${JSON.stringify(repository)} is not a Git working tree`);
  }
}

async function blockDraft(
  options: StartCommandOptions,
  current: AttemptStatus,
  detail: string,
): Promise<void> {
  const decision = transition({
    from: "DRAFT",
    to: "BLOCKED",
    actor: "host",
    tier: current.tier,
    reason: { source: "record", code: "preflight-failed", detail },
    interactive: false,
    budget: current.budget,
  });
  const at = (options.now ?? ((): string => new Date().toISOString()))();
  await persistAttempt(
    options.attemptDir,
    current.revision,
    {
      kind: "attempt.transitioned",
      next: nextRevision(current, {
        lifecycleState: decision.to,
        lastActivityAt: at,
        lastActivity: detail,
        nextAction: nextActionFor(decision.to, current.taskId),
        blocker: { code: "preflight-failed", detail, ahead: null, behind: null },
      }),
    },
    options.projectRecord,
  );
}

/** Materialize and persist L1. Provider launch remains the workflow host's L4. */
export async function startCommand(options: StartCommandOptions): Promise<AttemptStatus> {
  const current = await readAttempt(options.attemptDir);
  if (current.lifecycleState !== "DRAFT") {
    // Ask the ordered machine before config, worktree, or Git side effects. No
    // non-DRAFT -> PREPARED edge is legal, so evidence cannot be reached.
    transition({
      from: current.lifecycleState,
      to: "PREPARED",
      actor: "host",
      tier: current.tier,
      reason: { source: "git" },
      interactive: false,
      budget: current.budget,
    });
    throw new Error("unreachable start authorization");
  }
  const configPath = resolve(options.configPath ?? join(current.repository, "awsf.config.yaml"));
  const config = loadConfig(await readFile(configPath, "utf8"));
  if (config.project.slug !== current.project) {
    throw new Error(`config project ${config.project.slug} does not match attempt project ${current.project}`);
  }
  if (!config.workflows.enabled.includes(current.workflow)) {
    throw new Error(`workflow ${current.workflow} is not enabled by ${configPath}`);
  }
  const recipe = workflowRecipe(current.workflow);
  if (recipe === null) throw new Error(`workflow ${JSON.stringify(current.workflow)} has no shipped recipe`);
  // Zero cost, and deliberately BEFORE the worktree and BEFORE any adapter is
  // contacted. It also deliberately does NOT block the DRAFT: `awsf raise` is
  // legal on a live attempt and terminal on a BLOCKED one, so blocking here
  // would seal away the one remedy the message names.
  const ceiling = current.budget.ceiling ?? callCeilingsOf(config.risk.call_ceiling);
  const headroom = correctionHeadroom(config, recipe, ceiling);
  if (headroom.unfundable) {
    throw new Error(
      `workflow ${JSON.stringify(current.workflow)} declares a correction round on ${String(headroom.coldCorrectingPhases.length)} cold phase(s) ` +
        `(${headroom.coldCorrectingPhases.join(", ")}) that this attempt cannot fund: ` +
        `${String(minimumCallsFor(recipe))} provider call(s) are required and the ceiling is ` +
        `${String(minimumCallsFor(recipe) + correctionsFundableFor(recipe, ceiling))}, ` +
        `so corrections fundable = ${String(correctionsFundableFor(recipe, ceiling))}. ` +
        `The first envelope defect would be terminal on its first occurrence. ` +
        `Run \`awsf raise ${current.taskId} --calls ${String(headroom.callsNeeded)} --reason "<why>"\` and start again; ` +
        `the attempt stays DRAFT and no call has been spent.`,
    );
  }
  if (recipe.tier !== current.tier) {
    const detail = `workflow ${JSON.stringify(current.workflow)} requires --tier T${recipe.tier}; attempt recorded T${current.tier}`;
    await blockDraft(options, current, detail);
    throw new Error(detail);
  }
  try {
    await validateCanonicalRepository(current.repository);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await blockDraft(options, current, detail);
    throw error;
  }
  // Production validates every configured prompt path and its physical
  // containment before creating a worktree or contacting an adapter. Tests may
  // inject the complete preflight seam and therefore own this check themselves.
  if (options.preflight === undefined) {
    try {
      await validateConfiguredPrompts(configPath, config, current.workflow);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await blockDraft(options, current, detail);
      throw error;
    }
  }

  // Verified BEFORE the worktree exists and without blocking the DRAFT: a bad
  // binding is fixed by editing the owner's file and running start again.
  let visual: { readonly binding: VisualReferenceBinding; readonly verified: VerifiedVisualReferences } | null = null;
  if (options.visualReferences !== undefined) {
    const binding = parseVisualBinding(await readFile(resolve(options.visualReferences), "utf8"));
    const verified = await verifyVisualReferences(binding, {
      planRef: current.planRef,
      agentPhases: recipe.phases.filter((phase) => phase.kind === "agent").map((phase) => phase.id),
    });
    visual = { binding, verified };
  }

  const seed = await verifiedTargetSeed(options.attemptDir, current);
  if (seed !== null) await validateSeedStartup(seed, current, config, configPath, options.attemptDir);
  const baseSha = seed?.integrationBaseSha ?? runGit(systemGitRunner(current.repository), ["rev-parse", "HEAD"]).trim();
  const managed = createWorktree({
    repository: current.repository,
    root: resolve(options.worktreeRoot),
    attemptId: current.sessionId,
    baseSha: seed?.seedCandidateSha ?? baseSha,
  });
  try {
    await seedWorktreePaths({
      repository: current.repository,
      worktree: managed.path,
      seedPaths: config.runtime.seed_paths,
      protectedPaths: config.policy.protected_paths,
    });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const decision = transition({
      from: current.lifecycleState,
      to: "BLOCKED",
      actor: "host",
      tier: current.tier,
      reason: { source: "git", code: "preflight-failed", detail },
      interactive: false,
      budget: current.budget,
    });
    const failedAt = (options.now ?? ((): string => new Date().toISOString()))();
    const blocked = nextRevision(current, {
      lifecycleState: decision.to,
      baseSha,
      worktree: managed.path,
      lastActivityAt: failedAt,
      lastActivity: detail,
      nextAction: nextActionFor(decision.to, current.taskId),
      blocker: { code: "preflight-failed", detail, ahead: null, behind: null },
    });
    await persistAttempt(
      options.attemptDir,
      current.revision,
      { kind: "attempt.transitioned", next: blocked },
      options.projectRecord,
    );
    throw error;
  }
  const preflight = await (options.preflight ?? ((status) => defaultPreflight(status, configPath)))(current);
  let prepared = current;
  if (visual !== null) {
    await recordVisualBinding(options.attemptDir, visual.binding);
    const at = (options.now ?? ((): string => new Date().toISOString()))();
    prepared = await persistAttempt(options.attemptDir, current.revision, {
      kind: "attempt.updated",
      next: nextRevision(current, { lastActivityAt: at, lastActivity: `bound ${String(visual.verified.bound.frames.length)} visual reference(s) to ${visual.binding.phases.join(", ")}` }),
      evidence: { type: "visual-references-bound", bound: visual.verified.bound, at },
    }, options.projectRecord);
  }
  const decision = transition({
    from: current.lifecycleState,
    to: "PREPARED",
    actor: "host",
    tier: current.tier,
    reason: { source: "git" },
    interactive: false,
    budget: current.budget,
    evidence: {
      worktreeCreated: true,
      configValid: true,
      baseSha,
      preflight,
    },
  });
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  const next = nextRevision(prepared, {
    lifecycleState: decision.to,
    baseSha,
    worktree: managed.path,
    lastActivityAt: now,
    lastActivity: `L1 prepared detached worktree at ${managed.path}`,
    nextAction: nextActionFor(decision.to, current.taskId),
  });
  return persistAttempt(
    options.attemptDir,
    prepared.revision,
    { kind: "attempt.transitioned", next },
    options.projectRecord,
  );
}
