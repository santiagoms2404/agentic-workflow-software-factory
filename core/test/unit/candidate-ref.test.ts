import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistAttempt, nextRevision, readAttempt } from "../../src/cli/commands/attempt.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import type { AcceptedPhase } from "../../src/contracts/phase-recovery.ts";
import {
  CANDIDATE_REF_STATES,
  CandidateRefConflict,
  candidateRefName,
  readCandidateRef,
  writeCandidateRef,
} from "../../src/git/candidate-ref.ts";
import { runGit, systemGitRunner, type GitRunner } from "../../src/git/changes.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { compileShift } from "../../src/workflow/shift/compile.ts";
import { shiftTicketCandidates } from "../../src/workflow/shift/bind.ts";
import { relRepo, repoRoot, walkFiles } from "./meta/_walk.ts";

// W17 M4 task 12. Git behaviour is tested in throwaway repositories created by
// `git init`, never against this one.

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const SUBJECT = { project: "fixture-project", taskId: "fixture-shift", attempt: 1 } as const;

interface Repo {
  readonly root: string;
  readonly git: GitRunner;
  readonly base: string;
  /** A commit no ref, reflog entry or worktree holds, the way a sealed candidate is held today. */
  readonly commit: (parent: string, message: string) => string;
}

function repo(): Repo {
  const root = mkdtempSync(join(tmpdir(), "awsf-candidate-ref-"));
  const git = systemGitRunner(root);
  runGit(git, ["init", "-q", "-b", "main"]);
  runGit(git, [...OWNER, "commit", "-q", "--allow-empty", "-m", "test: base"]);
  const base = runGit(git, ["rev-parse", "HEAD"]).trim();
  const tree = runGit(git, ["rev-parse", "HEAD^{tree}"]).trim();
  const commit = (parent: string, message: string): string =>
    runGit(git, [...OWNER, "commit-tree", tree, "-p", parent, "-m", message]).trim();
  return { root, git, base, commit };
}

const exists = (git: GitRunner, sha: string): boolean => git(["cat-file", "-e", `${sha}^{commit}`]).status === 0;

/** The most aggressive collection Git offers: reflogs expired, every unreachable object pruned now. */
function prune(git: GitRunner): void {
  runGit(git, ["-c", "gc.reflogExpire=now", "-c", "gc.reflogExpireUnreachable=now", "-c", "gc.pruneExpire=now",
    "gc", "--quiet", "--aggressive", "--prune=now"]);
  runGit(git, ["prune", "--expire=now"]);
}

test("the ref is created, is not a branch, and re-running the write on the same SHA is idempotent", () => {
  const { root, git, base, commit } = repo();
  try {
    const candidate = commit(base, "T01");
    const ref = candidateRefName(SUBJECT);
    assert.equal(ref, "refs/awsf/candidates/fixture-project/fixture-shift/1");
    assert.equal(readCandidateRef(root, SUBJECT, git), null);

    assert.equal(writeCandidateRef(root, SUBJECT, candidate, git), "created");
    assert.equal(runGit(git, ["rev-parse", "--verify", ref]).trim(), candidate);
    assert.equal(readCandidateRef(root, SUBJECT, git), candidate);

    // Not a branch: nothing under refs/heads, nothing a branch listing shows,
    // and the checked-out branch did not move.
    assert.equal(runGit(git, ["for-each-ref", "refs/heads"]).trim().split("\n").length, 1);
    assert.equal(runGit(git, ["branch", "--all", "--format=%(refname)"]).trim(), "refs/heads/main");
    assert.equal(runGit(git, ["symbolic-ref", "HEAD"]).trim(), "refs/heads/main");
    assert.equal(runGit(git, ["rev-parse", "main"]).trim(), base);

    // Idempotent: the same write again changes nothing, and still one ref.
    assert.equal(writeCandidateRef(root, SUBJECT, candidate, git), "unchanged");
    assert.equal(writeCandidateRef(root, SUBJECT, candidate, git), "unchanged");
    assert.equal(runGit(git, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/awsf"]).trim(), `${ref} ${candidate}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the ref advances only to a descendant, and is never moved off a candidate it holds", () => {
  const { root, git, base, commit } = repo();
  try {
    const first = commit(base, "candidate");
    const reworked = commit(first, "owner rework on the same head");
    const unrelated = commit(base, "a candidate that does not descend from the held one");
    assert.equal(writeCandidateRef(root, SUBJECT, first, git), "created");
    assert.equal(writeCandidateRef(root, SUBJECT, reworked, git), "advanced");
    assert.equal(readCandidateRef(root, SUBJECT, git), reworked);

    assert.throws(() => writeCandidateRef(root, SUBJECT, unrelated, git), CandidateRefConflict);
    assert.throws(() => writeCandidateRef(root, SUBJECT, first, git), CandidateRefConflict, "moving back to an ancestor is refused too");
    assert.equal(readCandidateRef(root, SUBJECT, git), reworked, "a refused write leaves the ref where it was");

    assert.throws(() => writeCandidateRef(root, SUBJECT, "HEAD", git), /not a full object id/u);
    assert.throws(() => writeCandidateRef(root, SUBJECT, "f".repeat(40), git), /rev-parse/u, "an object this repository lacks is refused");
    assert.throws(() => candidateRefName({ ...SUBJECT, taskId: "a..b" }), /cannot name a candidate ref/u);
    assert.throws(() => candidateRefName({ ...SUBJECT, taskId: "x.lock" }), /cannot name a candidate ref/u);
    assert.throws(() => candidateRefName({ ...SUBJECT, attempt: 0 }), /cannot name a candidate ref/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const held of [true, false]) {
  test(`a sealed shift's candidate ${held ? "survives an aggressive prune with the ref" : "is pruned without the ref"}`, () => {
    const { root, git, base, commit } = repo();
    try {
      // Three tickets, each one's commit on the last: the shape one shift leaves.
      const t01 = commit(base, "T01");
      const t02 = commit(t01, "T02");
      const t03 = commit(t02, "T03");
      const tickets = [t01, t02, t03];
      for (const sha of tickets) assert.ok(exists(git, sha), "each candidate exists before the collection");
      if (held) writeCandidateRef(root, SUBJECT, t03, git);

      prune(git);

      // The tip ref alone reaches every ticket's commit; without it, none survives.
      assert.deepEqual(tickets.map((sha) => exists(git, sha)), [held, held, held]);
      assert.ok(exists(git, base));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("every transition to the owner gate or a seal writes the ref, and no Git failure refuses the transition", async () => {
  const { root, git, base, commit } = repo();
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-candidate-ref-state-"));
  try {
    assert.deepEqual(CANDIDATE_REF_STATES, ["AWAITING_OWNER", "BLOCKED", "CANCELLED", "PUBLISHED"]);
    const created = await newCommand({ stateRoot, project: SUBJECT.project, taskId: SUBJECT.taskId, repository: root,
      request: "keep the candidate", workflow: "build", tier: 1 });
    const t01 = commit(base, "T01");
    const tip = commit(t01, "T02");

    // RUNNING is not a seal: the worktree still holds the head.
    const running = nextRevision(created.status, { lifecycleState: "RUNNING", candidateSha: t01 });
    await persistAttempt(created.attemptDir, 1, { kind: "attempt.transitioned", next: running });
    assert.equal(readCandidateRef(root, SUBJECT, git), null);

    const waiting = nextRevision(running, { lifecycleState: "AWAITING_OWNER", candidateSha: tip });
    await persistAttempt(created.attemptDir, running.revision, { kind: "attempt.transitioned", next: waiting });
    assert.equal(readCandidateRef(root, SUBJECT, git), tip, "an unattended run's candidate is kept while it waits for the owner");

    const cancelled = nextRevision(waiting, { lifecycleState: "CANCELLED" });
    await persistAttempt(created.attemptDir, waiting.revision, { kind: "attempt.transitioned", next: cancelled });
    assert.equal(readCandidateRef(root, SUBJECT, git), tip);
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "CANCELLED");

    // A candidate Git cannot resolve, and a repository that is not one, still seal.
    for (const [taskId, repository, candidateSha] of [["missing-object", root, "f".repeat(40)], ["no-repository", stateRoot, tip]] as const) {
      const other = await newCommand({ stateRoot, project: SUBJECT.project, taskId, repository, request: "seal anyway", workflow: "build", tier: 1 });
      const blocked = nextRevision(other.status, { lifecycleState: "BLOCKED", candidateSha });
      await persistAttempt(other.attemptDir, 1, { kind: "attempt.transitioned", next: blocked });
      assert.equal((await readAttempt(other.attemptDir)).lifecycleState, "BLOCKED");
      assert.equal(readCandidateRef(root, { ...SUBJECT, taskId }, git), null);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("every ticket's own candidate SHA is projected against its ticket id from the accepted prefix", () => {
  const ids = ["T11", "T12", "T13"];
  const bodies = new Map(ids.map((id) => [id, Buffer.from([
    "---", `id: ${id}`, `title: "Ticket ${id}"`, "milestone: M4", "state: todo", "depends_on: []", "---",
    `# ${id}`, "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```", `TASK ${id}. Build it.`, "```", "",
  ].join("\n"), "utf8")] as const));
  const manifest = sealShiftManifest({ plan: "fixture-shift", milestones: ["M4"],
    tickets: ids.map((id) => ({ id, path: `specs/tickets/fixture-shift/${id}.md`, digest: ticketFileDigest(bodies.get(id)!) })) });
  const recipe = compileShift(manifest, bodies, { prompts: { builder: "builder", reviewer: "reviewer" } });
  const sha = (n: number): string => String(n).repeat(40);
  // What acceptPhase records: each accepted phase carries the attempt's
  // candidate at that point, so a brief and a gate phase repeat the last build's.
  const running = [null, sha(1), sha(1), sha(1), sha(2), sha(2), sha(2)];
  const prefix: AcceptedPhase[] = running.map((candidateSha, index) => ({
    phaseKey: recipe.phases[index]!.id, ordinal: index + 1, envelopeId: `envelope-${String(index)}`,
    envelopeDigest: "0".repeat(64), round: 0, candidateSha,
  }));

  assert.deepEqual(shiftTicketCandidates(recipe.phases, prefix), [
    { ticketId: "T11", candidateSha: sha(1) },
    { ticketId: "T12", candidateSha: sha(2) },
    { ticketId: "T13", candidateSha: null },
  ], "a ticket whose build is not accepted has no candidate yet");
});

test("invariant 8's scans sweep candidate-ref.ts with no exemption added", () => {
  const module = "core/src/git/candidate-ref.ts";
  assert.ok(walkFiles(join(repoRoot(), "core", "src")).map(relRepo).includes(module), "no-destructive-paths walks every core/src file, this one included");
  for (const fence of ["no-destructive-paths.test.ts", "no-land-route.test.ts"]) {
    const text = readFileSync(join(repoRoot(), "core", "test", "unit", "meta", fence), "utf8");
    assert.doesNotMatch(text, /candidate[-_]ref|refs\/awsf|exempt|allow(?:ed|list)/iu, `${fence} names no exemption`);
  }
  // The write's own shape: no delete flag, no batch that could carry one, and
  // every update-ref names the value it expects to replace.
  const source = readFileSync(join(repoRoot(), module), "utf8");
  assert.doesNotMatch(source, /"(?:-d|--delete|--stdin|--no-deref)"/u);
  const updates = source.match(/"update-ref"[^\]]*\]/gu) ?? [];
  assert.equal(updates.length, 2);
  for (const update of updates) assert.match(update, /"update-ref", ref, candidate, (?:""|held)\]$/u);
});
