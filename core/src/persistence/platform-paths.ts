// Where AWSF's durable state lives on disk, per platform — Q3/Q6.
//
// Q3: a fresh `awsf` namespace, not a reuse of MAW's layout. Q6: macOS gets
// `~/Library/Application Support/awsf` (the platform convention), everywhere
// else falls back to the XDG state layout, and `$XDG_STATE_HOME` is honored
// on every platform the moment it is explicitly set — shell-config purists
// lose nothing on macOS, and Linux/other platforms need no override at all.
//
// Pure path arithmetic: nothing here touches the filesystem.

import { homedir } from "node:os";
import { dirname, join } from "node:path";

const NAMESPACE = "awsf";

/**
 * The root of AWSF's machine-local state tree.
 *
 * `env` and `platformName` are parameters (not read from `process` directly)
 * so platform resolution is testable for all three platforms from any one.
 */
export function resolveStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
): string {
  const xdgStateHome = env.XDG_STATE_HOME;
  if (xdgStateHome !== undefined && xdgStateHome.trim().length > 0) {
    return join(xdgStateHome, NAMESPACE);
  }

  if (platformName === "darwin") {
    return join(homedir(), "Library", "Application Support", NAMESPACE);
  }

  if (platformName === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData === undefined || localAppData.trim().length === 0) {
      throw new Error("%LOCALAPPDATA% is not set; cannot resolve the awsf state root on Windows");
    }
    return join(localAppData, NAMESPACE);
  }

  // XDG default for everything else, per the Base Directory spec.
  return join(homedir(), ".local", "state", NAMESPACE);
}

/**
 * The attempt directory, per the Ownership section's storage tree:
 * `<state-root>/projects/<project>/tasks/<task>/<attempt>/`.
 */
export function attemptDir(stateRoot: string, project: string, task: string, attempt: string): string {
  return join(stateRoot, "projects", project, "tasks", task, attempt);
}

/** The machine-local placement document for one project. */
export function placementFilePath(stateRoot: string, slug: string): string {
  return join(stateRoot, "projects", slug, "placement.yaml");
}

/** The conventional machine-local worktree root is a sibling of the state root. */
export function defaultWorktreeRoot(stateRoot: string): string {
  return join(dirname(stateRoot), "awsf-worktrees");
}

export function journalFilePath(attempt: string): string {
  return join(attempt, "journal.jsonl");
}

export function statusFilePath(attempt: string): string {
  return join(attempt, "status.json");
}

/** `private/continuity.json`, mode 0600 — provider session identity, host-private. */
export function continuityFilePath(attempt: string): string {
  return join(attempt, "private", "continuity.json");
}

/** `raw/<run-id>.jsonl` — the private, unredacted provider stream capture. */
export function rawStreamFilePath(attempt: string, runId: string): string {
  return join(attempt, "raw", `${runId}.jsonl`);
}

/** The attempt's exclusive lock file. */
export function lockFilePath(attempt: string): string {
  return join(attempt, "attempt.lock");
}
