// Host-owned publication observation and execution. Raw Git output is reduced
// to closed facts or closed failure codes before it leaves this module.
//
// INV-4 gives up the guarantee that no credential is read: publication inherits
// and may invoke the owner's configured helper chain. Credentials returned by
// that chain are never read, held, logged, or journalled. Configured push URLs
// are used transiently for destination observation, never in the push argv or a
// diagnostic/record; AWSF writes no credential configuration or credential file.

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
import { containsCredential } from "../policy/redaction.ts";
import { systemGitRunner, type GitRunner, type GitResult } from "./changes.ts";

export const PUBLISH_BLOCK_CODES = [
  "remote-unknown",
  "remote-unreadable",
  "remote-ambiguous",
  "credentials-required",
  "mirror-configured",
  "git-failure",
] as const;

export type PublishBlockCode = (typeof PUBLISH_BLOCK_CODES)[number];

const PUBLISH_BLOCK_DETAILS: Readonly<Record<PublishBlockCode, string>> = {
  "remote-unknown": "The publication remote is not configured.",
  "remote-unreadable": "The publication remote could not be read.",
  "remote-ambiguous": "A push URL of the publication remote names its host ambiguously; spell it without backslashes or encoded host characters.",
  "credentials-required": "The owner's configured credential helper provided nothing; fix the helper configuration and retry.",
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
  /** `null` when the destination branch will be created. */
  readonly remotePriorSha: string | null;
}

type PublishRefusal = Extract<PublishAuthorization, { readonly decision: "refused" }>;

export type PublishRunResult =
  | PublishRefusal
  | {
      readonly decision: "published";
      readonly outcomes: readonly PublishOutcome[];
    };

// Git treats a remote as a URL only when it spells `scheme://`; anything else
// with a colon before its first slash is the scp-like [user@]host:path form.
const URL_FORM = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

/**
 * The host Git's transport would read: the authority runs to the first `/`,
 * `?` or `#`, and the host follows its last `@`. `undefined` means this reading
 * cannot be made at all.
 */
function strictUrlHost(remoteUrl: string): string | null | undefined {
  const rest = remoteUrl.replace(URL_FORM, "");
  const end = rest.search(/[/?#]/u);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  let hostname: string;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1 || !/^(?::\d*)?$/u.test(hostPort.slice(close + 1))) return undefined;
    hostname = hostPort.slice(0, close + 1);
  } else {
    hostname = hostPort.replace(/:\d*$/u, "");
    if (hostname.includes(":")) return undefined;
  }
  return hostname.length === 0 ? null : hostname.toLowerCase();
}

/**
 * B1-08: WHATWG `URL` and Git's transport do not always read the same host,
 * e.g. `https://allowed\@other/` is `allowed` to WHATWG while Git contacts
 * `other`. A host check that one reader passes and the other contradicts does
 * not constrain the destination, so such a URL is refused rather than guessed.
 */
function resolvedHost(remoteUrl: string): string | null {
  if (remoteUrl.includes("\\")) throw new PublishBlocked("remote-ambiguous");

  if (URL_FORM.test(remoteUrl)) {
    let whatwg: URL;
    try {
      whatwg = new URL(remoteUrl);
    } catch {
      throw new PublishBlocked("remote-ambiguous");
    }
    const whatwgHost = whatwg.hostname.length === 0 ? null : whatwg.hostname;
    if (strictUrlHost(remoteUrl) !== (whatwgHost === null ? null : whatwgHost.toLowerCase())) {
      throw new PublishBlocked("remote-ambiguous");
    }
    return whatwg.protocol === "file:" ? null : whatwgHost;
  }

  // Git's scp-like syntax is not a URL: [user@]host:path. WHATWG would read
  // `host:` as a scheme with no host, so it is not consulted here.
  if (/^[A-Za-z]:\//u.test(remoteUrl)) return null;
  const match = /^(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/\s]+):/u.exec(remoteUrl);
  if (match === null) return null;
  const hostname = match[1]!;
  return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
}

function runObserved(runner: GitRunner, argv: readonly string[], code: PublishBlockCode): GitResult {
  try {
    return runner(argv);
  } catch {
    throw new PublishBlocked(code);
  }
}

function observe(runner: GitRunner, argv: readonly string[], code: PublishBlockCode): GitResult {
  const result = runObserved(runner, argv, code);
  if (result.status !== 0 || result.error !== null) throw new PublishBlocked(code);
  return result;
}

function head(runner: GitRunner): string {
  return observe(runner, ["rev-parse", "HEAD"], "git-failure").stdout.trim();
}

function clean(runner: GitRunner): boolean {
  return observe(runner, ["status", "--porcelain", "--untracked-files=all"], "git-failure").stdout.trim().length === 0;
}

function host(runner: GitRunner, remoteName: string): string | null {
  // B1-09: `--all`, because `git push` writes to every push URL and without
  // it Git prints only the first. Git applies insteadOf/pushInsteadOf before
  // printing, so these are the URLs the push will contact.
  const result = observe(runner, ["remote", "get-url", "--push", "--all", remoteName], "remote-unknown");

  // This is the remote URLs' only lifetime. Only their parsed hostnames survive.
  const remoteUrls = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  if (remoteUrls.length === 0) throw new PublishBlocked("remote-unknown");
  const hosts = remoteUrls.map(resolvedHost);
  // Push URLs on more than one host have no single resolved host. `null` is
  // refused by the remote-host-mismatch row whenever a host is allowlisted.
  return hosts.every((candidate) => candidate === hosts[0]) ? (hosts[0] ?? null) : null;
}

function remoteTip(runner: GitRunner, remoteName: string, branch: string): string | null {
  const destination = observe(runner, ["remote", "get-url", "--push", remoteName], "remote-unreadable");
  const pushUrl = destination.stdout.trim();
  if (pushUrl.length === 0 || /[\r\n]/u.test(pushUrl)) throw new PublishBlocked("remote-unreadable");

  // B1-21: `ls-remote <remoteName>` follows the fetch URL, not the push URL
  // used by `git push <remoteName>`. The destination URL is used only for this
  // observation and is never included in a diagnostic or publication record.
  const result = observe(runner, ["ls-remote", pushUrl, `refs/heads/${branch}`], "remote-unreadable");

  // Measured: an absent branch is empty output at exit 0, so output is the signal.
  const output = result.stdout.trim();
  if (output.length === 0) return null;
  const match = /^([0-9a-f]{40})\s/u.exec(output);
  if (match === null) throw new PublishBlocked("remote-unreadable");
  return match[1]!;
}

function isAncestor(runner: GitRunner, ancestor: string, descendant: string): boolean {
  const result = runObserved(runner, ["merge-base", "--is-ancestor", ancestor, descendant], "git-failure");
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
    remotePriorSha: tip,
  };
}

function executionFailure(result: GitResult): PublishBlocked {
  // stderr is inspected only to select a closed code and is discarded with the
  // result. It never enters the error, a log, or the journal.
  if (/(?:--mirror.*refspec|refspec.*--mirror)/iu.test(result.stderr)) {
    return new PublishBlocked("mirror-configured");
  }
  // With prompting disabled, this diagnosis means the configured helper chain
  // produced nothing and Git had no terminal on which to ask the operator.
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

  const argv = publishArgv(authorization.plan);
  if (containsCredential(argv.join(" "))) throw new PublishBlocked("git-failure");

  let result: GitResult;
  try {
    result = runner(argv);
  } catch {
    throw new PublishBlocked("git-failure");
  }
  if (result.status !== 0 || result.error !== null) throw executionFailure(result);
  return { decision: "published", outcomes: parsePorcelain(result.stdout) };
}
