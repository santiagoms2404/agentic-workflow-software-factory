// Host-owned publication observation and execution. Raw Git output is reduced
// to closed facts or closed failure codes before it leaves this module.

import {
  authorizePublish,
  type PublishAuthorization,
  type PublishRefspec,
  type PublishRemoteFacts,
  type PublishRepositoryFacts,
  type PublishStatusFacts,
} from "../publish/authorize.ts";
import {
  parsePorcelain,
  publishArgv,
  type PublishOutcome,
} from "../publish/argv.ts";
import { systemGitRunner, type GitRunner, type GitResult } from "./changes.ts";

export const PUBLISH_BLOCK_CODES = [
  "remote-unknown",
  "remote-unreadable",
  "credentials-required",
  "mirror-configured",
  "git-failure",
] as const;

export type PublishBlockCode = (typeof PUBLISH_BLOCK_CODES)[number];

const PUBLISH_BLOCK_DETAILS: Readonly<Record<PublishBlockCode, string>> = {
  "remote-unknown": "The publication remote is not configured.",
  "remote-unreadable": "The publication remote could not be read.",
  "credentials-required": "The configured credential helper did not provide credentials.",
  "mirror-configured": "The publication remote is configured as a mirror.",
  "git-failure": "Git could not complete publication.",
};

/** Closed observation and execution failures. Raw process bytes are deliberately absent. */
export class PublishBlocked extends Error {
  readonly code: PublishBlockCode;

  constructor(code: PublishBlockCode) {
    super(PUBLISH_BLOCK_DETAILS[code]);
    this.name = "PublishBlocked";
    this.code = code;
  }
}

export interface ObservedPublishTarget {
  readonly repository: Pick<PublishRepositoryFacts, "headSha" | "checkoutClean">;
  readonly remote: PublishRemoteFacts;
}

type PublishRefusal = Extract<PublishAuthorization, { readonly decision: "refused" }>;

export type PublishRunResult =
  | PublishRefusal
  | {
      readonly decision: "published";
      readonly outcomes: readonly PublishOutcome[];
    };

function resolvedHost(remoteUrl: string): string | null {
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol === "file:") return null;
    return parsed.hostname.length === 0 ? null : parsed.hostname;
  } catch {
    // Git's scp-like syntax is not a URL: [user@]host:path.
    if (/^[A-Za-z]:[\\/]/u.test(remoteUrl)) return null;
    const match = /^(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/\\\s]+):/u.exec(remoteUrl);
    if (match === null) return null;
    const hostname = match[1]!;
    return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  }
}

function head(runner: GitRunner): string {
  let result: GitResult;
  try {
    result = runner(["rev-parse", "HEAD"]);
  } catch {
    throw new PublishBlocked("git-failure");
  }
  if (result.status !== 0 || result.error !== null) throw new PublishBlocked("git-failure");
  return result.stdout.trim();
}

function clean(runner: GitRunner): boolean {
  let result: GitResult;
  try {
    result = runner(["status", "--porcelain"]);
  } catch {
    throw new PublishBlocked("git-failure");
  }
  if (result.status !== 0 || result.error !== null) throw new PublishBlocked("git-failure");
  return result.stdout.trim().length === 0;
}

function host(runner: GitRunner, remoteName: string): string | null {
  let result: GitResult;
  try {
    result = runner(["remote", "get-url", "--push", remoteName]);
  } catch {
    throw new PublishBlocked("remote-unknown");
  }
  if (result.status !== 0 || result.error !== null) throw new PublishBlocked("remote-unknown");

  // This is the remote URL's only lifetime. Only its parsed hostname survives.
  const remoteUrl = result.stdout.trim();
  return resolvedHost(remoteUrl);
}

function remoteTip(runner: GitRunner, remoteName: string, branch: string): string | null {
  let result: GitResult;
  try {
    result = runner(["ls-remote", remoteName, `refs/heads/${branch}`]);
  } catch {
    throw new PublishBlocked("remote-unreadable");
  }
  if (result.status !== 0 || result.error !== null) throw new PublishBlocked("remote-unreadable");

  // Measured: an absent branch is empty output at exit 0, so output is the signal.
  const output = result.stdout.trim();
  if (output.length === 0) return null;
  const match = /^([0-9a-f]{40})\s/u.exec(output);
  if (match === null) throw new PublishBlocked("remote-unreadable");
  return match[1]!;
}

function isAncestor(runner: GitRunner, ancestor: string, descendant: string): boolean {
  let result: GitResult;
  try {
    result = runner(["merge-base", "--is-ancestor", ancestor, descendant]);
  } catch {
    throw new PublishBlocked("git-failure");
  }
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new PublishBlocked("git-failure");
}

/** Observes the exact local and remote facts consumed by the authorization table. */
export function observePublishTarget(
  repository: string,
  remoteName: string,
  branch: string,
  runner = systemGitRunner(repository),
): ObservedPublishTarget {
  const headSha = head(runner);
  const checkoutClean = clean(runner);
  const resolvedRemoteHost = host(runner, remoteName);
  const tip = remoteTip(runner, remoteName, branch);

  return {
    repository: { headSha, checkoutClean },
    remote: {
      name: remoteName,
      branch,
      resolvedHost: resolvedRemoteHost,
      fastForward: tip === null ? null : isAncestor(runner, tip, headSha),
    },
  };
}

function executionFailure(result: GitResult): PublishBlocked {
  if (/(?:--mirror.*refspec|refspec.*--mirror)/iu.test(result.stderr)) {
    return new PublishBlocked("mirror-configured");
  }
  if (/terminal prompts disabled/iu.test(result.stderr)) {
    return new PublishBlocked("credentials-required");
  }
  return new PublishBlocked("git-failure");
}

/** Authorizes exactly once, then executes only the argv derived from that authorization. */
export function runPublish(
  status: PublishStatusFacts,
  repository: PublishRepositoryFacts,
  remote: PublishRemoteFacts,
  refspec: PublishRefspec,
  runner: GitRunner,
): PublishRunResult {
  const authorization = authorizePublish(status, repository, remote, refspec);
  if (authorization.decision === "refused") return authorization;

  let result: GitResult;
  try {
    result = runner(publishArgv(authorization.plan));
  } catch {
    throw new PublishBlocked("git-failure");
  }
  if (result.status !== 0 || result.error !== null) throw executionFailure(result);
  return { decision: "published", outcomes: parsePorcelain(result.stdout) };
}
