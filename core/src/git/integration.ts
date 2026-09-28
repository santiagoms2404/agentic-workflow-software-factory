// Host-owned stale-prefix integration. When canonical HEAD has advanced past a
// sealed candidate's recorded base, the host may carry that exact candidate
// over the new HEAD as one two-parent merge object: canonical HEAD first, the
// untouched source candidate second. Nothing here resolves a conflict, moves a
// ref, touches an index or checkout, or rewrites either parent. Anything other
// than a clean divergence from exactly the recorded base is refused, never
// repaired.
//
// Planning asks `git merge-tree --write-tree`, which stores the merged tree as
// unreferenced objects and nothing else. The merge commit is written only after
// the owner confirms, and its bytes are fixed by the plan and one recorded
// timestamp, so resume and replay can recompute and compare them exactly.

import { runSystemCommand } from "../execution/transport-broker.ts";
import { GitCommandFailed, runGit, systemGitRunner, type GitRunner } from "./changes.ts";
import { HOST_AUTHOR } from "./commit.ts";

export class IntegrationRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "IntegrationRefused";
  }
}

export interface IntegrationPlan {
  readonly sourceBaseSha: string;
  readonly sourceCandidateSha: string;
  /** Canonical HEAD: the merge's first parent and the target's base. */
  readonly integrationBaseSha: string;
  /** The conflict-free merged tree. */
  readonly treeSha: string;
}

export interface IntegrationRecord {
  readonly integrationBaseSha: string;
  readonly integratedCandidateSha: string;
  /** The author and committer date the merge object carries. */
  readonly committedAt: string;
}

const OBJECT_ID = /^[0-9a-f]{40}$/u;

function owner(): { readonly name: string; readonly email: string } {
  const match = /^(.+) <([^<>]+)>$/u.exec(HOST_AUTHOR);
  if (match === null) throw new Error(`host author ${JSON.stringify(HOST_AUTHOR)} is not "name <email>"`);
  return { name: match[1]!, email: match[2]! };
}

function isAncestor(runner: GitRunner, ancestor: string, descendant: string): boolean {
  const argv = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = runner(argv);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new GitCommandFailed(argv, result);
}

/**
 * Decide whether the exact source candidate carries cleanly over canonical HEAD.
 *
 * The one admitted shape: canonical HEAD strictly descends from the source
 * base, and the base is the only merge base of HEAD and the candidate. That
 * refuses unrelated history, a rewound HEAD, a HEAD that already holds part or
 * all of the candidate, and criss-cross histories alike.
 */
export function planIntegration(
  repository: string,
  pair: { readonly sourceBaseSha: string; readonly sourceCandidateSha: string; readonly integrationBaseSha: string },
  runner: GitRunner = systemGitRunner(repository),
): IntegrationPlan {
  const { sourceBaseSha: base, sourceCandidateSha: candidate, integrationBaseSha: head } = pair;
  for (const sha of [base, candidate, head]) {
    if (!OBJECT_ID.test(sha)) throw new IntegrationRefused(`${JSON.stringify(sha)} is not an exact 40-hex commit`);
  }
  if (head === base) throw new IntegrationRefused("canonical HEAD is the source base; there is nothing to integrate");
  if (!isAncestor(runner, base, head)) {
    throw new IntegrationRefused(`canonical HEAD ${head} does not descend from the source base ${base}`);
  }
  const basesArgv = ["merge-base", "--all", head, candidate];
  const bases = runner(basesArgv);
  if (bases.status !== 0 && bases.status !== 1) throw new GitCommandFailed(basesArgv, bases);
  const found = bases.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (found.length !== 1 || found[0] !== base) {
    throw new IntegrationRefused(
      `canonical HEAD ${head} and candidate ${candidate} do not diverge from exactly the source base ${base} (merge bases: ${found.join(", ") || "none"})`,
    );
  }
  const mergeArgv = ["merge-tree", "--write-tree", "--no-messages", "--name-only", `--merge-base=${base}`, head, candidate];
  const merged = runner(mergeArgv);
  const lines = merged.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (merged.status === 1) {
    throw new IntegrationRefused(
      `candidate ${candidate} conflicts with canonical HEAD ${head} in ${lines.slice(1).join(", ") || "an unnamed path"}; no conflict is resolved`,
    );
  }
  if (merged.status !== 0) throw new GitCommandFailed(mergeArgv, merged);
  const tree = lines[0] ?? "";
  if (!OBJECT_ID.test(tree)) throw new IntegrationRefused(`git merge-tree returned no tree: ${JSON.stringify(merged.stdout)}`);
  if (tree === runGit(runner, ["rev-parse", `${head}^{tree}`]).trim()) {
    throw new IntegrationRefused(`candidate ${candidate} changes nothing over canonical HEAD ${head}`);
  }
  return Object.freeze({ sourceBaseSha: base, sourceCandidateSha: candidate, integrationBaseSha: head, treeSha: tree });
}

function gitDate(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new IntegrationRefused(`integration time ${JSON.stringify(at)} is not a timestamp`);
  return `${String(Math.floor(ms / 1_000))} +0000`;
}

/** Names Git objects only: a commit never encodes which task or attempt made it. */
export function integrationMessage(plan: IntegrationPlan): string {
  return `merge: integrate candidate ${plan.sourceCandidateSha} onto ${plan.integrationBaseSha}`;
}

/** The exact bytes `git cat-file commit` must return for this plan's merge. */
function expectedCommit(plan: IntegrationPlan, committedAt: string): string {
  const { name, email } = owner();
  const stamp = `${name} <${email}> ${gitDate(committedAt)}`;
  return `tree ${plan.treeSha}\nparent ${plan.integrationBaseSha}\nparent ${plan.sourceCandidateSha}\n` +
    `author ${stamp}\ncommitter ${stamp}\n\n${integrationMessage(plan)}\n`;
}

/**
 * Prove a recorded merge is exactly the host's merge for this plan: same tree,
 * canonical HEAD first and the source candidate second, owner author and
 * committer, recorded date, fixed message, no signature or extra header.
 */
export function verifyIntegrationCommit(
  repository: string,
  plan: IntegrationPlan,
  record: IntegrationRecord,
  runner: GitRunner = systemGitRunner(repository),
): void {
  const sha = record.integratedCandidateSha;
  if (record.integrationBaseSha !== plan.integrationBaseSha) {
    throw new IntegrationRefused(`recorded integration base ${record.integrationBaseSha} is not canonical HEAD ${plan.integrationBaseSha}`);
  }
  if (!OBJECT_ID.test(sha)) throw new IntegrationRefused(`${JSON.stringify(sha)} is not an exact 40-hex commit`);
  const raw = runner(["cat-file", "commit", sha]);
  if (raw.status !== 0) throw new IntegrationRefused(`integrated candidate ${sha} is not a commit in this repository`);
  if (raw.stdout !== expectedCommit(plan, record.committedAt)) {
    throw new IntegrationRefused(
      `integrated candidate ${sha} is not the host's exact merge of ${plan.sourceCandidateSha} onto ${plan.integrationBaseSha}`,
    );
  }
}

/** Write the plan's merge commit object. No ref, index or checkout moves. */
export function writeIntegrationCommit(repository: string, plan: IntegrationPlan, committedAt: string): IntegrationRecord {
  const { name, email } = owner();
  const date = gitDate(committedAt);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // Pinned rather than inherited: a session's own Git identity must never reach
  // a commit (AGENTS.md invariant 11), and a fixed date makes the bytes replayable.
  Object.assign(env, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
  });
  const argv = ["-C", repository, "commit-tree", "--no-gpg-sign", plan.treeSha,
    "-p", plan.integrationBaseSha, "-p", plan.sourceCandidateSha, "-m", integrationMessage(plan)];
  const result = runSystemCommand("git", argv, { timeoutMs: 30_000, env });
  if (result.status !== 0) throw new GitCommandFailed(argv, result);
  const record = { integrationBaseSha: plan.integrationBaseSha, integratedCandidateSha: result.stdout.trim(), committedAt };
  verifyIntegrationCommit(repository, plan, record);
  return Object.freeze(record);
}
