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

/** Decides the first applicable truth-table row without observing or mutating anything. */
export function authorizePublish(
  status: PublishStatusFacts,
  repository: PublishRepositoryFacts,
  remote: PublishRemoteFacts,
  refspec: PublishRefspec,
): PublishAuthorization {
  if (status.lifecycleState !== "LANDED") {
    return refused("not-landed");
  }
  if (status.landingApproval === null) {
    return refused("no-landing-approval");
  }
  if (status.landingApproval.candidateSha !== status.candidateSha) {
    return refused("approval-not-candidate");
  }
  if (status.candidateSha === null || !_SHA.test(status.candidateSha)) {
    return refused("malformed-candidate");
  }
  if (repository.headSha !== status.candidateSha) {
    return refused("head-not-at-candidate");
  }
  if (!repository.checkoutClean) {
    return refused("dirty-checkout");
  }
  if (!repository.allow.remotes.includes(remote.name)) {
    return refused("remote-not-allowlisted");
  }
  if (!repository.allow.branches.includes(remote.branch)) {
    return refused("branch-not-allowlisted");
  }
  if (repository.allow.host !== undefined && remote.resolvedHost !== repository.allow.host) {
    return refused("remote-host-mismatch");
  }
  if (refspec.forced) {
    return refused("force-refspec");
  }
  // Measured against a bare remote: an all-zeros source deleted the branch at exit 0.
  if (refspec.deleting || refspec.source === "" || refspec.source === ZERO_SHA) {
    return refused("delete-refspec");
  }
  if (refspec.source !== status.candidateSha) {
    return refused("inexact-source");
  }
  if (refspec.destination !== `refs/heads/${remote.branch}`) {
    return refused("destination-not-declared-branch");
  }
  // An absent ref is a creation: ls-remote returns empty stdout at exit 0.
  if (remote.fastForward === false) {
    return refused("non-fast-forward");
  }

  return {
    decision: "authorized",
    plan: {
      remoteName: remote.name,
      branch: remote.branch,
      sha: status.candidateSha,
      [AUTHORIZED_PUBLISH_PLAN]: true,
    },
  };
}
