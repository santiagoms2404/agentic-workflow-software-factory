// Pure publication authorization facts and refusal vocabulary.
//
// This file decides WHETHER a publication may happen, never HOW to perform
// one. Every field is a value somebody else already observed; this layer never
// reads a clock, touches I/O, or goes and looks.

import type { TaskState } from "../state/task-machine.ts";
import { SHA_PATTERN } from "../contracts/test-output.ts";

const _SHA = new RegExp(SHA_PATTERN);

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
