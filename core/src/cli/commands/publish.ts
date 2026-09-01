// `awsf publish` — the seventh owner act, and the one act whose Git mutation
// cannot be taken back.
//
// It follows `land.ts` in shape (locate, display, one confirmation, one
// authorization) and INVERTS its ordering on purpose. `land` makes `LANDING`
// durable BEFORE Git moves, because a local fast-forward is recoverable and a
// durable approval is what recovery replays. A push is not undoable, so nothing
// here may claim a publication before the remote has performed one: the push
// runs first and the `L27` transition records what the remote actually did.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseEnvelope } from "../../contracts/parse-envelope.ts";
import {
  PUBLISH_OUTPUT_KIND,
  PUBLISH_OUTPUT_SCHEMA_ID,
} from "../../contracts/publish-output.ts";
import { wrapEnvelope } from "../../contracts/stored-envelope.ts";
import { systemGitRunner, type GitRunner } from "../../git/changes.ts";
import { observePublishTarget, runPublish } from "../../git/publish.ts";
import type { PublishOutcome } from "../../publish/argv.ts";
import {
  publishVerdict,
  type PublishRefusalCode,
  type PublishRemoteFacts,
  type PublishRepositoryFacts,
  type PublishStatusFacts,
} from "../../publish/authorize.ts";
import { parseRefspec } from "../../publish/refspec.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import type { ProjectCatalog } from "../../registry/catalog-schema.ts";
import { readPlacement } from "../../registry/placement.ts";
import type { Placement } from "../../registry/placement-schema.ts";
import {
  transition,
  type Actor,
  type TransitionResult,
} from "../../state/task-machine.ts";
import type { OwnerTerminal } from "../tty.ts";
import {
  nextActionFor,
  nextRevision,
  persistAttempt,
  readAttempt,
  type AttemptAdvancementGuard,
  type AttemptProjector,
  type AttemptStatus,
} from "./attempt.ts";
import { SealedAttempt } from "../../persistence/attempt-lock.ts";
import { readAttemptEvidence } from "./review-record.ts";
import { writeRunReport } from "../../observability/run-report.ts";

type PublishPolicy = NonNullable<ProjectCatalog["repositories"][string]["publish"]>;

export interface PublishCommandOptions {
  readonly attemptDir: string;
  readonly stateRoot: string;
  readonly terminal: OwnerTerminal;
  readonly actor?: Actor;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
  readonly assertAdvancement?: AttemptAdvancementGuard;
  /** Defaults to the first remote the catalog allowlists for this repository. */
  readonly remoteName?: string;
  /** Defaults to the first branch the catalog allowlists for this repository. */
  readonly branch?: string;
  /** Test seam. Production always spawns the host runner for the attempt repository. */
  readonly gitRunner?: GitRunner;
  /** Crash-injection boundary: the remote has moved and `PUBLISHED` is not yet durable. */
  readonly afterPushed?: (outcomes: readonly PublishOutcome[]) => Promise<void> | void;
}

export type PublishCommandResult =
  /** No `publish` block, so nothing was observed and no Git process was spawned. */
  | { readonly outcome: "unpublishable"; readonly detail: string }
  | { readonly outcome: "declined" }
  | { readonly outcome: "refused"; readonly code: PublishRefusalCode; readonly detail: string }
  | {
      readonly outcome: "published";
      readonly status: AttemptStatus;
      readonly outcomes: readonly PublishOutcome[];
    };

/**
 * THE single production authorization call for LANDED -> PUBLISHED. Actor and
 * TTY checks deliberately remain inside transition(), where steps 7 and 8 keep
 * their required order ahead of evidence.
 */
function authorizePublication(
  status: AttemptStatus,
  actor: Actor,
  interactive: boolean,
  confirmed: boolean,
  preflightPasses: boolean,
): TransitionResult {
  return transition({
    from: status.lifecycleState,
    to: "PUBLISHED",
    actor,
    tier: status.tier,
    reason: { source: "human", detail: "awsf publish" },
    interactive,
    budget: status.budget,
    evidence: {
      candidateSha: status.candidateSha ?? "",
      landing: {
        shaDisplayed: status.candidateSha ?? "",
        summaryDisplayed: status.landingApproval?.summary ?? "",
        confirmed,
        requiredReviewPresent: status.requiredReviewPresent,
        journeyApproved: status.journeyApproved,
        protectedApprovalsValid: status.protectedApprovalsValid,
        fastForwardPreflightPasses: preflightPasses,
      },
    },
  });
}

async function readCatalogAt(repository: string): Promise<ProjectCatalog | null> {
  try {
    return loadCatalog(await readFile(join(repository, "awsf.project.yaml"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readPlacementFor(stateRoot: string, project: string): Promise<Placement | null> {
  try {
    return await readPlacement(stateRoot, project);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Which catalog entry the attempt's repository IS. Registered projects answer
 * this from their machine-local placement, in the idiom `composeProduction-
 * DesignContext` already uses. A self-placed single-repository project never
 * registers one, and there the sole declared repository is the only candidate.
 * Anything else is unanswerable, and an unanswerable repository is not
 * publishable — guessing between two policies is exactly the mistake the
 * allowlist exists to prevent.
 */
function repositoryIdFor(catalog: ProjectCatalog, placement: Placement | null, repository: string): string | null {
  const declared = Object.keys(catalog.repositories);
  const placed = placement === null
    ? undefined
    : Object.entries(placement.repositories)
      .find(([id, entry]) => declared.includes(id) && resolve(entry.path) === resolve(repository));
  if (placed !== undefined) return placed[0];
  return declared.length === 1 ? declared[0] ?? null : null;
}

async function publishPolicyFor(status: AttemptStatus, stateRoot: string): Promise<PublishPolicy | null> {
  const catalog = await readCatalogAt(status.repository);
  if (catalog === null) return null;
  const id = repositoryIdFor(catalog, await readPlacementFor(stateRoot, status.project), status.repository);
  return id === null ? null : catalog.repositories[id]?.publish ?? null;
}

function statusFacts(status: AttemptStatus): PublishStatusFacts {
  return {
    lifecycleState: status.lifecycleState,
    candidateSha: status.candidateSha,
    landingApproval: status.landingApproval === null
      ? null
      : { candidateSha: status.landingApproval.candidateSha },
  };
}

function updateKind(remote: PublishRemoteFacts): string {
  if (remote.fastForward === null) return "creation — the branch does not exist on the remote";
  return remote.fastForward ? "fast-forward" : "NOT a fast-forward";
}

function display(
  terminal: OwnerTerminal,
  candidateSha: string,
  remote: PublishRemoteFacts,
  rows: readonly { readonly code: PublishRefusalCode; readonly passed: boolean }[],
): string[] {
  // The remote URL is never read here and never displayed. `observePublishTarget`
  // reduces it to a hostname inside the Git boundary and this command never sees it.
  const lines = [
    `Revision: ${candidateSha}`,
    `Remote: ${remote.name}`,
    `Branch: ${remote.branch}`,
    `Update: ${updateKind(remote)}`,
    "Authorization rows:",
    ...rows.map((row, index) =>
      `  ${String(index + 1).padStart(2, " ")} ${row.code.padEnd(32, " ")} ${row.passed ? "pass" : "REFUSES"}`),
  ];
  lines.forEach((line) => terminal.write(line));
  return lines;
}

export async function publishCommand(options: PublishCommandOptions): Promise<PublishCommandResult> {
  const current = await readAttempt(options.attemptDir);
  // PUBLISHED is sealed before policy resolution or Git observation. A repeat
  // publish therefore has the persistence boundary's refusal and cannot reach
  // the argv site.
  if (current.lifecycleState === "PUBLISHED") throw new SealedAttempt("PUBLISHED");
  const actor = options.actor ?? "human";

  // BEFORE any observation: a repository the catalog declares no policy for
  // never spawns Git at all. Reading a catalog and a placement is filesystem
  // work; the first Git process of this command is the one below it.
  const policy = await publishPolicyFor(current, options.stateRoot);
  if (policy === null) {
    return {
      outcome: "unpublishable",
      detail: `Publication refused: the catalog for ${current.repository} declares no publish policy for this repository.`,
    };
  }

  // Preserve the transition's rejection order before even read-only Git I/O, as
  // `land.ts` does. A wrong actor, a non-interactive human, or an attempt that
  // has not landed must hear the state complaint rather than an observation
  // complaint that sits below it.
  if (current.lifecycleState !== "LANDED" || actor !== "human" || !options.terminal.interactive) {
    authorizePublication(current, actor, options.terminal.interactive, false, false);
    throw new Error("unreachable publication authorization");
  }

  const remoteName = options.remoteName ?? policy.remotes[0]!;
  const branch = options.branch ?? policy.branches[0]!;
  const runner = options.gitRunner ?? systemGitRunner(current.repository);
  const observed = observePublishTarget(current.repository, remoteName, branch, runner);
  const candidateSha = current.candidateSha ?? "";
  const repository: PublishRepositoryFacts = {
    ...observed.repository,
    allow: {
      remotes: policy.remotes,
      branches: policy.branches,
      ...(policy.host === undefined ? {} : { host: policy.host }),
    },
  };
  // The refspec is parsed rather than assumed, so the rows that judge it read
  // the same shape `publishArgv` will construct from the authorized plan.
  const refspec = parseRefspec(`${candidateSha}:refs/heads/${branch}`);
  const facts = statusFacts(current);
  const rows = publishVerdict(facts, repository, observed.remote, refspec);
  const terminalLines = display(options.terminal, candidateSha, observed.remote, rows);

  const refusing = rows.find((row) => !row.passed);
  if (refusing !== undefined) {
    // The same fourteen rows `authorizePublish` reads, so this refusal and the
    // one the push path would return cannot disagree. Nothing is confirmed,
    // pushed, transitioned or journalled.
    return { outcome: "refused", code: refusing.code, detail: refusing.detail };
  }

  const disclosureLines = [
    "Cost: 0 provider calls. This performs one non-force, non-delete Git push of the displayed revision and invalidates no gate.",
    "The remote update cannot be rolled back by AWSF. Confirming seals this attempt as PUBLISHED, so no different revision or destination can be chosen on it.",
  ];
  disclosureLines.forEach((line) => options.terminal.write(line));
  terminalLines.push(...disclosureLines);
  const confirmed = await options.terminal.confirm(`Publish exact revision ${candidateSha} to ${remoteName}/${branch}?`);
  if (!confirmed) return { outcome: "declined" };

  // Before the irreversible act, not after it: a projection that cannot record
  // the publication must stop the command while there is still nothing to record.
  options.assertAdvancement?.(current.sessionId, "PUBLISHED");

  const run = runPublish(facts, repository, observed.remote, refspec, runner);
  if (run.decision === "refused") return { outcome: "refused", code: run.code, detail: run.detail };
  await options.afterPushed?.(run.outcomes);

  // THE RESIDUAL, named because a push has no rollback: if the push above
  // succeeds and the persist below fails, the remote is ahead of the journal
  // and the attempt is still LANDED. Nothing is undone — inventing a revert
  // push would be a second unapproved mutation, not a repair. This is handled
  // the way `recoverLanding` handles its own residual, by leaving exactly one
  // honest interpretation: rerun `awsf publish` on the same revision. The
  // observation then reports the remote already at the candidate, the same
  // fourteen rows authorize, the push reports `already-current`, and this
  // transition completes.
  const decision = authorizePublication(current, actor, true, true, observed.repository.checkoutClean);
  const now = (options.now ?? ((): string => new Date().toISOString()))();
  const published = nextRevision(current, {
    lifecycleState: decision.to,
    lastActivityAt: now,
    lastActivity: `L27 published ${candidateSha} to ${remoteName}/${branch}: ${run.outcomes.join(", ") || "no ref update reported"}`,
    nextAction: nextActionFor(decision.to, current.taskId),
    blocker: null,
  });
  const result = { outcome: "published" as const, status: published, outcomes: run.outcomes };
  const output = {
    schema: PUBLISH_OUTPUT_SCHEMA_ID,
    producerStatus: "success" as const,
    summary: published.lastActivity,
    artifacts: [],
    notesForNextPhase: "",
    kind: PUBLISH_OUTPUT_KIND,
    terminalLines,
    result,
    // status.json uses this exact JSON.stringify call, with no trailing newline.
    finalStatusBytes: JSON.stringify(published),
  };
  const parsed = parseEnvelope(JSON.stringify(output), PUBLISH_OUTPUT_SCHEMA_ID);
  if (!parsed.valid) {
    throw new Error(`invalid ${PUBLISH_OUTPUT_SCHEMA_ID}: ${parsed.violations.map((violation) => `${violation.path || "/"} ${violation.message}`).join("; ")}`);
  }
  const phaseId = `${current.sessionId}:publish`;
  const envelope = wrapEnvelope({
    envelopeId: `${phaseId}:0`,
    sessionId: current.sessionId,
    phaseId: "publish",
    correctionRound: 0,
    agent: "host",
    schemaId: PUBLISH_OUTPUT_SCHEMA_ID,
    createdAt: now,
    // The canonical raw payload is on the same final journal row. No duplicate
    // artifact can be written after PUBLISHED seals the attempt.
    rawOutputPath: "journal.jsonl",
  }, parsed);
  const status = await persistAttempt(
    options.attemptDir,
    current.revision,
    {
      kind: "attempt.transitioned",
      next: published,
      evidence: {
        type: "publish",
        remote: remoteName,
        branch,
        publishedSha: candidateSha,
        outcome: run.outcomes[0] ?? "fault",
        remotePriorSha: observed.remotePriorSha,
        at: now,
        phaseId,
        envelope,
      },
    },
    options.projectRecord,
  );
  await refreshRunReport(options.attemptDir, status);
  return { outcome: "published", status, outcomes: run.outcomes };
}

/**
 * Keep the readable projection level with the record this act just moved.
 *
 * A projection is disposable and Git plus the journal remain authoritative, so
 * this is deliberately last and deliberately cheap. It is not optional: a
 * report naming a superseded candidate while `awsf status` calls it current is
 * how an owner reads the wrong review of the wrong change.
 */
async function refreshRunReport(attemptDir: string, status: AttemptStatus): Promise<void> {
  await writeRunReport(attemptDir, status, await readAttemptEvidence(attemptDir));
}
