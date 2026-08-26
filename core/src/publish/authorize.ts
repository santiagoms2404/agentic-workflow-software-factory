// Pure publication authorization facts and refusal vocabulary.
//
// This file decides WHETHER a publication may happen, never HOW to perform
// one. Every field is a value somebody else already observed; this layer never
// reads a clock, touches I/O, or goes and looks.

import type { TaskState } from "../state/task-machine.ts";
import { SHA_PATTERN } from "../contracts/test-output.ts";

const _SHA = new RegExp(SHA_PATTERN);
const ZERO_SHA = "0".repeat(40);
const AUTHORIZED_PUBLISH_PLAN: unique symbol = Symbol("authorized-publish-plan");

export interface PublishStatusFacts {
  readonly lifecycleState: TaskState;
  readonly candidateSha: string | null;
  readonly landingApproval: {
    readonly candidateSha: string;
  } | null;
}

export interface PublishRepositoryFacts {
  readonly headSha: string;
  readonly checkoutClean: boolean;
  readonly allow: {
    readonly remotes: readonly string[];
    readonly branches: readonly string[];
    readonly host?: string;
  };
}

export interface PublishRemoteFacts {
  readonly name: string;
  readonly branch: string;
  readonly resolvedHost: string | null;
  readonly fastForward: boolean | null;
}

export interface PublishRefspec {
  readonly source: string;
  readonly destination: string;
  readonly forced: boolean;
  readonly deleting: boolean;
}

export const PUBLISH_REFUSAL_ORDER = [
  "not-landed",
  "no-landing-approval",
  "approval-not-candidate",
  "malformed-candidate",
  "head-not-at-candidate",
  "dirty-checkout",
  "remote-not-allowlisted",
  "branch-not-allowlisted",
  "remote-host-mismatch",
  "force-refspec",
  "delete-refspec",
  "inexact-source",
  "destination-not-declared-branch",
  "non-fast-forward",
] as const;

export type PublishRefusalCode = (typeof PUBLISH_REFUSAL_ORDER)[number];

const PUBLISH_REFUSAL_DETAILS: Readonly<Record<PublishRefusalCode, string>> = {
  "not-landed": "The attempt has not landed.",
  "no-landing-approval": "The landed revision has no recorded human approval.",
  "approval-not-candidate": "The approved revision does not match the candidate.",
  "malformed-candidate": "The candidate is not a valid commit SHA.",
  "head-not-at-candidate": "The repository HEAD is not at the candidate.",
  "dirty-checkout": "The repository checkout is not clean.",
  "remote-not-allowlisted": "The remote is not allowlisted for publication.",
  "branch-not-allowlisted": "The branch is not allowlisted for publication.",
  "remote-host-mismatch": "The resolved remote host does not match the allowlist.",
  "force-refspec": "The publication refspec requests a forced update.",
  "delete-refspec": "The publication refspec requests branch deletion.",
  "inexact-source": "The publication source is not the exact candidate.",
  "destination-not-declared-branch": "The publication destination is not the declared branch.",
  "non-fast-forward": "The publication would not be a fast-forward update.",
};

export interface AuthorizedPublishPlan {
  readonly remoteName: string;
  readonly branch: string;
  readonly sha: string;
  readonly [AUTHORIZED_PUBLISH_PLAN]: true;
}

export type PublishAuthorization =
  | {
    readonly decision: "authorized";
    readonly plan: AuthorizedPublishPlan;
  }
  | {
    readonly decision: "refused";
    readonly code: PublishRefusalCode;
    readonly detail: string;
  };

function refused(code: PublishRefusalCode): PublishAuthorization {
  return { decision: "refused", code, detail: PUBLISH_REFUSAL_DETAILS[code] };
}

/** The four already-observed records every row reads, and nothing else. */
interface PublishFacts {
  readonly status: PublishStatusFacts;
  readonly repository: PublishRepositoryFacts;
  readonly remote: PublishRemoteFacts;
  readonly refspec: PublishRefspec;
}

export interface PublishVerdictRow {
  readonly code: PublishRefusalCode;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * One predicate per refusal code, declared in `PUBLISH_REFUSAL_ORDER`'s order.
 * The decision and the fourteen-row verdict shown to the owner both read THIS
 * table, so a displayed row and the refusal that follows it cannot disagree.
 *
 * Rows below the first violation are still evaluated for display, and some of
 * them read a field an earlier row has not yet vouched for. That is why the
 * ORDER decides and a row's own finding never does.
 */
const PUBLISH_ROW_PASSES: Readonly<Record<PublishRefusalCode, (facts: PublishFacts) => boolean>> = {
  "not-landed": ({ status }) => status.lifecycleState === "LANDED",
  "no-landing-approval": ({ status }) => status.landingApproval !== null,
  "approval-not-candidate": ({ status }) => status.landingApproval?.candidateSha === status.candidateSha,
  "malformed-candidate": ({ status }) => status.candidateSha !== null && _SHA.test(status.candidateSha),
  "head-not-at-candidate": ({ status, repository }) => repository.headSha === status.candidateSha,
  "dirty-checkout": ({ repository }) => repository.checkoutClean,
  "remote-not-allowlisted": ({ repository, remote }) => repository.allow.remotes.includes(remote.name),
  "branch-not-allowlisted": ({ repository, remote }) => repository.allow.branches.includes(remote.branch),
  "remote-host-mismatch": ({ repository, remote }) =>
    repository.allow.host === undefined || remote.resolvedHost === repository.allow.host,
  "force-refspec": ({ refspec }) => !refspec.forced,
  // Measured against a bare remote: an all-zeros source deleted the branch at exit 0.
  "delete-refspec": ({ refspec }) => !refspec.deleting && refspec.source !== "" && refspec.source !== ZERO_SHA,
  "inexact-source": ({ status, refspec }) => refspec.source === status.candidateSha,
  "destination-not-declared-branch": ({ remote, refspec }) => refspec.destination === `refs/heads/${remote.branch}`,
  // An absent ref is a creation: ls-remote returns empty stdout at exit 0.
  "non-fast-forward": ({ remote }) => remote.fastForward !== false,
};

/**
 * Every row's finding, for display before the owner is asked to confirm. It
 * returns no plan and authorizes nothing — `authorizePublish` remains the only
 * way to obtain one.
 */
export function publishVerdict(
  status: PublishStatusFacts,
  repository: PublishRepositoryFacts,
  remote: PublishRemoteFacts,
  refspec: PublishRefspec,
): readonly PublishVerdictRow[] {
  const facts: PublishFacts = { status, repository, remote, refspec };
  return Object.freeze(PUBLISH_REFUSAL_ORDER.map((code) => Object.freeze({
    code,
    passed: PUBLISH_ROW_PASSES[code](facts),
    detail: PUBLISH_REFUSAL_DETAILS[code],
  })));
}

/** Decides the first applicable truth-table row without observing or mutating anything. */
export function authorizePublish(
  status: PublishStatusFacts,
  repository: PublishRepositoryFacts,
  remote: PublishRemoteFacts,
  refspec: PublishRefspec,
): PublishAuthorization {
  const facts: PublishFacts = { status, repository, remote, refspec };
  for (const code of PUBLISH_REFUSAL_ORDER) {
    if (!PUBLISH_ROW_PASSES[code](facts)) return refused(code);
  }

  // Row 4 proved the candidate is a 40-hex object id. This restates the table's
  // own finding for the type system rather than checking the same fact twice.
  const sha = status.candidateSha!;
  return {
    decision: "authorized",
    plan: {
      remoteName: remote.name,
      branch: remote.branch,
      sha,
      [AUTHORIZED_PUBLISH_PLAN]: true,
    },
  };
}
