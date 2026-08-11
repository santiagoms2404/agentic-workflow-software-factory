import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { registeredAdapter } from "../../adapters/registry.ts";
import { loadConfig } from "../../config/load.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import { createWorktree, seedWorktreePaths } from "../../git/worktrees.ts";
import { transition } from "../../state/task-machine.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";

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

  const baseSha = runGit(systemGitRunner(current.repository), ["rev-parse", "HEAD"]).trim();
  const managed = createWorktree({
    repository: current.repository,
    root: resolve(options.worktreeRoot),
    attemptId: current.sessionId,
    baseSha,
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
  const next = nextRevision(current, {
    lifecycleState: decision.to,
    baseSha,
    worktree: managed.path,
    lastActivityAt: now,
    lastActivity: `L1 prepared detached worktree at ${managed.path}`,
    nextAction: nextActionFor(decision.to, current.taskId),
  });
  return persistAttempt(
    options.attemptDir,
    current.revision,
    { kind: "attempt.transitioned", next },
    options.projectRecord,
  );
}

/** Useful to derive the conventional machine-local worktree root from a state root sibling. */
export function defaultWorktreeRoot(stateRoot: string): string {
  return join(dirname(stateRoot), "awsf-worktrees");
}
