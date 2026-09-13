// Host-owned, local-only landing primitives. This module never decides WHO may
// land; the CLI's single L20 call site does that before any mutation reaches
// this boundary.

import { runGit, systemGitRunner, type GitRunner } from "./changes.ts";

export type LandingBlockCode =
  | "non-fast-forward"
  | "dirty-canonical-tree"
  | "git-failure"
  | "ambiguous-recovery";

export interface Divergence {
  /** Commits present only on canonical HEAD. */
  readonly ahead: number;
  /** Commits present only on the candidate. */
  readonly behind: number;
}

export interface LandingInspection extends Divergence {
  readonly headSha: string;
  readonly candidateSha: string;
  readonly clean: boolean;
  readonly fastForwardPossible: boolean;
  readonly summary: string;
}

export interface LandingOutcome extends Divergence {
  readonly headSha: string;
  readonly candidateSha: string;
  readonly checkoutClean: boolean;
}

export class LandingBlocked extends Error {
  readonly code: LandingBlockCode;
  readonly ahead: number | null;
  readonly behind: number | null;

  constructor(code: LandingBlockCode, detail: string, counts?: Partial<Divergence>) {
    const ahead = counts?.ahead ?? null;
    const behind = counts?.behind ?? null;
    const meter = ahead === null || behind === null ? "" : ` (ahead ${ahead}, behind ${behind})`;
    super(`${detail}${meter}`);
    this.name = "LandingBlocked";
    this.code = code;
    this.ahead = ahead;
    this.behind = behind;
  }
}

function parseCounts(text: string): Divergence {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(text);
  if (match === null) throw new Error(`git returned unreadable ahead/behind counts: ${JSON.stringify(text)}`);
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

function clean(runner: GitRunner): boolean {
  return runGit(runner, ["status", "--porcelain"]).trim().length === 0;
}

function head(runner: GitRunner): string {
  return runGit(runner, ["rev-parse", "HEAD"]).trim();
}

function summary(runner: GitRunner, candidateSha: string): string {
  const subject = runGit(runner, ["show", "--no-patch", "--format=%s", candidateSha]).trim();
  const stat = runGit(runner, ["diff", "--stat", "HEAD.." + candidateSha]).trim();
  return stat.length === 0 ? subject : `${subject}\n${stat}`;
}

function isAncestor(runner: GitRunner, ancestor: string, descendant: string): boolean {
  const result = runner(["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(result.error ?? (result.stderr.trim() || "git merge-base failed"));
}

/** A read-only snapshot shown to the owner and repeated after LANDING is durable. */
export function inspectLanding(
  repository: string,
  candidateSha: string,
  runner = systemGitRunner(repository),
  seedPin?: { readonly integrationBaseSha: string; readonly recovering?: boolean },
): LandingInspection {
  try {
    const headSha = head(runner);
    if (seedPin !== undefined && headSha !== seedPin.integrationBaseSha && !(seedPin.recovering === true && headSha === candidateSha)) {
      throw new LandingBlocked("git-failure", `seed-base-changed: seeded target requires canonical HEAD ${seedPin.integrationBaseSha}, found ${headSha}`);
    }
    // Resolves annotated names and rejects an absent object before it is shown.
    const exactCandidate = runGit(runner, ["rev-parse", `${candidateSha}^{commit}`]).trim();
    if (exactCandidate !== candidateSha) {
      throw new Error(`candidate resolved to ${exactCandidate}, not the recorded SHA ${candidateSha}`);
    }
    const counts = parseCounts(runGit(runner, ["rev-list", "--left-right", "--count", `HEAD...${candidateSha}`]));
    return {
      ...counts,
      headSha,
      candidateSha,
      clean: clean(runner),
      fastForwardPossible: headSha === candidateSha || isAncestor(runner, headSha, candidateSha),
      summary: summary(runner, candidateSha),
    };
  } catch (error) {
    if (error instanceof LandingBlocked) throw error;
    throw new LandingBlocked("git-failure", error instanceof Error ? error.message : String(error));
  }
}

function assertPreflight(inspection: LandingInspection): void {
  if (!inspection.clean) {
    throw new LandingBlocked("dirty-canonical-tree", "canonical checkout is dirty", inspection);
  }
  if (!inspection.fastForwardPossible) {
    throw new LandingBlocked("non-fast-forward", "candidate is not a descendant of canonical HEAD", inspection);
  }
}

function verify(
  repository: string,
  candidateSha: string,
  counts: Divergence,
  runner: GitRunner,
): LandingOutcome {
  const headSha = head(runner);
  const checkoutClean = clean(runner);
  if (headSha !== candidateSha) {
    throw new LandingBlocked(
      "git-failure",
      `canonical HEAD is ${headSha}, expected approved candidate ${candidateSha}`,
      counts,
    );
  }
  if (!checkoutClean) {
    throw new LandingBlocked("dirty-canonical-tree", "canonical checkout became dirty during landing", counts);
  }
  return { ...counts, headSha, candidateSha, checkoutClean };
}

/** Re-check, fast-forward locally, then prove exact HEAD and cleanliness. */
export function completeLanding(
  repository: string,
  candidateSha: string,
  runner = systemGitRunner(repository),
  seedPin?: { readonly integrationBaseSha: string; readonly recovering?: boolean },
): LandingOutcome {
  let inspection: LandingInspection;
  try {
    inspection = inspectLanding(repository, candidateSha, runner, seedPin);
    assertPreflight(inspection);
    if (inspection.headSha !== candidateSha) {
      runGit(runner, ["merge", "--ff-only", "--no-edit", candidateSha]);
    }
    return verify(repository, candidateSha, inspection, runner);
  } catch (error) {
    if (error instanceof LandingBlocked) throw error;
    throw new LandingBlocked("git-failure", error instanceof Error ? error.message : String(error));
  }
}

/**
 * A durable LANDING record proves the exact candidate was already approved.
 * Recovery may finish only when reality has one interpretation: already at the
 * candidate, or still clean and fast-forwardable to it. Everything else blocks.
 */
export function recoverLanding(
  repository: string,
  candidateSha: string,
  runner = systemGitRunner(repository),
  seedPin?: { readonly integrationBaseSha: string },
): LandingOutcome {
  try {
    return completeLanding(repository, candidateSha, runner, seedPin === undefined ? undefined : { ...seedPin, recovering: true });
  } catch (error) {
    if (error instanceof LandingBlocked) {
      if (error.code === "non-fast-forward" || error.code === "dirty-canonical-tree") throw error;
      throw new LandingBlocked("ambiguous-recovery", error.message, {
        ...(error.ahead === null ? {} : { ahead: error.ahead }),
        ...(error.behind === null ? {} : { behind: error.behind }),
      });
    }
    throw new LandingBlocked("ambiguous-recovery", error instanceof Error ? error.message : String(error));
  }
}
