// The ref that keeps an attempt's candidate reachable once the host stops
// holding it. `createWorktree` checks every candidate out on a detached HEAD,
// so without this ref a candidate is reachable only through its worktree and a
// reflog entry, and a pruning collection may take it once both are gone.
//
// One ref per attempt, at the tip. A shift's tickets commit one after another
// on the same head, so every earlier ticket's commit is an ancestor of the tip
// and this one ref reaches all of them. No branch is written: the namespace
// sits outside refs/heads, so no branch listing shows it and no checkout moves
// it.
//
// Written, never overwritten and never removed (AGENTS.md invariant 8). A write
// creates the ref, finds it already naming the candidate, or advances it to a
// descendant under a compare-and-swap. A ref naming anything else is refused,
// so no candidate this ref has held can become unreachable through it.
import { SEALED_STATES, type TaskState } from "../state/task-machine.ts";
import { GitCommandFailed, runGit, systemGitRunner, type GitRunner } from "./changes.ts";

export const CANDIDATE_REF_NAMESPACE = "refs/awsf/candidates";

/**
 * The states at which the host stops holding the candidate: the owner gate,
 * where an unattended run waits for a person, and every sealed state.
 */
export const CANDIDATE_REF_STATES: readonly TaskState[] = Object.freeze(["AWAITING_OWNER", ...SEALED_STATES]);

export interface CandidateRefSubject {
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
}

export type CandidateRefWrite = "created" | "unchanged" | "advanced";

export class CandidateRefConflict extends Error {
  readonly ref: string;
  readonly held: string;
  readonly candidate: string;
  constructor(ref: string, held: string, candidate: string) {
    super(`${ref} holds ${held}, which ${candidate} does not descend from; moving it would leave ${held} unreachable through it, so it is left where it is`);
    this.name = "CandidateRefConflict";
    this.ref = ref;
    this.held = held;
    this.candidate = candidate;
  }
}

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** `refs/awsf/candidates/<project>/<taskId>/<attempt>`, refused for any component Git would not accept. */
export function candidateRefName(subject: CandidateRefSubject): string {
  for (const [label, value] of [["project", subject.project], ["task id", subject.taskId]] as const) {
    if (!COMPONENT.test(value) || value.includes("..") || value.endsWith(".lock")) {
      throw new Error(`${label} ${JSON.stringify(value)} cannot name a candidate ref component`);
    }
  }
  if (!Number.isInteger(subject.attempt) || subject.attempt < 1) {
    throw new Error(`attempt ${String(subject.attempt)} cannot name a candidate ref component`);
  }
  return `${CANDIDATE_REF_NAMESPACE}/${subject.project}/${subject.taskId}/${String(subject.attempt)}`;
}

/** The commit the attempt's candidate ref names, or null when there is none. */
export function readCandidateRef(
  repository: string,
  subject: CandidateRefSubject,
  runner: GitRunner = systemGitRunner(repository),
): string | null {
  const argv = ["rev-parse", "--verify", "--quiet", `${candidateRefName(subject)}^{commit}`];
  const result = runner(argv);
  if (result.status === 0) return result.stdout.trim();
  if (result.status === 1 && result.stdout.trim() === "") return null;
  throw new GitCommandFailed(argv, result);
}

/**
 * Points the attempt's candidate ref at `candidateSha`. Repeating the write for
 * the same commit changes nothing, and a candidate that descends from the one
 * already held (an owner rework on the same head) advances it. Every update
 * names the value it expects to replace, the empty value for a ref that must
 * not exist yet, so a concurrent writer fails the write rather than being
 * overwritten.
 */
export function writeCandidateRef(
  repository: string,
  subject: CandidateRefSubject,
  candidateSha: string,
  runner: GitRunner = systemGitRunner(repository),
): CandidateRefWrite {
  const ref = candidateRefName(subject);
  if (!OBJECT_ID.test(candidateSha)) throw new Error(`candidate ${JSON.stringify(candidateSha)} is not a full object id`);
  const candidate = runGit(runner, ["rev-parse", "--verify", `${candidateSha}^{commit}`]).trim();
  const held = readCandidateRef(repository, subject, runner);
  if (held === candidate) return "unchanged";
  if (held === null) {
    runGit(runner, ["-c", "core.fsync=all", "update-ref", ref, candidate, ""]);
    return "created";
  }
  const argv = ["merge-base", "--is-ancestor", held, candidate];
  const descends = runner(argv);
  if (descends.status === 1) throw new CandidateRefConflict(ref, held, candidate);
  if (descends.status !== 0) throw new GitCommandFailed(argv, descends);
  runGit(runner, ["-c", "core.fsync=all", "update-ref", ref, candidate, held]);
  return "advanced";
}
