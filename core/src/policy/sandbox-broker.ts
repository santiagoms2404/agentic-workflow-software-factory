import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProcessSpec } from "../adapters/interface.ts";
import {
  assertClean,
  captureChangeSet,
  changedPaths,
  systemGitRunner,
  type ChangeSetFingerprint,
  type GitRunner,
} from "../git/changes.ts";
import { runSystemCommand } from "../execution/transport-broker.ts";
import {
  resolvePermissionProfile,
  type PermissionProfile,
} from "./permission-profiles.ts";
import { enforcePathPolicy } from "./path-policy.ts";

export const SANDBOX_BADGE_STATES = ["os-enforced", "tool-policy", "unavailable"] as const;
export type SandboxBadge = (typeof SANDBOX_BADGE_STATES)[number];

export interface SandboxGrant {
  readonly badge: SandboxBadge;
  readonly mechanism: "linux-bwrap" | "adapter-tool-policy" | "none";
  readonly writableRoots: readonly string[];
  readonly spec: ProcessSpec;
}

export interface SandboxRequest {
  readonly canonicalRepository: string;
  readonly worktree: string;
  readonly sessionRuntime: string;
  /**
   * The root of AWSF's machine-local state tree, masked inside the namespace.
   *
   * Required, not optional: a phase that forgot to supply it would silently run
   * with every other attempt's private material readable, which is exactly the
   * exposure the mask exists to remove.
   */
  readonly stateRoot: string;
  readonly writes: readonly string[];
  readonly platform?: NodeJS.Platform;
}

export type SandboxProbe = (executable: string) => boolean;

function hostProbe(executable: string): boolean {
  const result = runSystemCommand(executable, ["--version"], 5_000);
  return result.status === 0;
}

function physical(path: string): string {
  return existsSync(path) ? realpathSync.native(path) : resolve(path);
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** Q8 plus layer seven: execution and runtime roots are disjoint from the canonical checkout. */
export function assertSandboxRoots(request: Omit<SandboxRequest, "writes" | "platform">): void {
  const roots = {
    canonicalRepository: request.canonicalRepository,
    worktree: request.worktree,
    sessionRuntime: request.sessionRuntime,
    stateRoot: request.stateRoot,
  };
  for (const [name, path] of Object.entries(roots)) {
    if (!isAbsolute(path)) throw new Error(`${name} must be an absolute machine-local path`);
  }
  const canonical = physical(request.canonicalRepository);
  const worktree = physical(request.worktree);
  const runtime = physical(request.sessionRuntime);
  if (inside(worktree, canonical) || inside(canonical, worktree)) {
    throw new Error("the canonical repository and managed worktree must be disjoint");
  }
  if (inside(worktree, runtime) || inside(runtime, worktree)) {
    throw new Error("session runtime and the managed worktree must be disjoint writable roots");
  }
  if (inside(canonical, runtime)) {
    throw new Error("session runtime may not make part of the canonical repository writable");
  }
}

function bwrapSpec(spec: ProcessSpec, request: SandboxRequest): ProcessSpec {
  const worktreeBind = request.writes.length === 0 ? "--ro-bind" : "--bind";
  return {
    executable: "bwrap",
    argv: [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--share-net",
      "--ro-bind", "/", "/",
      // The whole host filesystem is readable above; `writes: []` confines
      // WRITES and confines reads not at all. A profile carrying a model-driven
      // `Read` that can name an absolute path therefore reaches every other
      // attempt's directory and this attempt's own `private/` — including the
      // continuity locator, whose 0600 is protection against other users, not
      // against a process running as the owner. bwrap applies binds in argv
      // ORDER, so an empty tmpfs over the state root here, before the runtime
      // bind below, hides all of it while leaving this phase's own writable
      // runtime intact. The order is asserted by the descriptor test.
      "--tmpfs", request.stateRoot,
      "--proc", "/proc",
      "--dev", "/dev",
      worktreeBind, request.worktree, request.worktree,
      "--bind", request.sessionRuntime, request.sessionRuntime,
      "--ro-bind", request.canonicalRepository, request.canonicalRepository,
      "--chdir", spec.cwd,
      "--",
      spec.executable,
      ...spec.argv,
    ],
    cwd: request.worktree,
    // Host /tmp is read-only in the namespace. Provider scratch belongs to the
    // always-writable attempt runtime, never to an ambient machine directory.
    env: { ...spec.env, TMPDIR: request.sessionRuntime },
    stdin: spec.stdin,
    shell: false,
  };
}

/**
 * Produces the launch descriptor and the exact tri-state surfaced later by
 * SandboxBadge. Darwin is deliberately not guessed from Linux; T27 verifies
 * its machine and a later port may add Seatbelt there.
 */
export function grantSandbox(
  spec: ProcessSpec,
  request: SandboxRequest,
  probe: SandboxProbe = hostProbe,
): SandboxGrant {
  assertSandboxRoots(request);
  const platform = request.platform ?? process.platform;
  if (platform === "linux" && probe("bwrap")) {
    return Object.freeze({
      badge: "os-enforced",
      mechanism: "linux-bwrap",
      writableRoots: Object.freeze([
        ...(request.writes.length === 0 ? [] : [physical(request.worktree)]),
        physical(request.sessionRuntime),
      ]),
      spec: bwrapSpec(spec, request),
    });
  }
  const toolPolicy = platform === "linux";
  return Object.freeze({
    badge: toolPolicy ? "tool-policy" : "unavailable",
    mechanism: toolPolicy ? "adapter-tool-policy" : "none",
    writableRoots: Object.freeze([physical(request.sessionRuntime)]),
    spec,
  });
}

export interface PermissionSessionRequest extends SandboxRequest {
  readonly profile: string;
  readonly tools: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly git?: GitRunner;
  readonly sandboxProbe?: SandboxProbe;
}

export interface PermissionResult {
  readonly changedPaths: readonly string[];
  readonly sandboxBadge: SandboxBadge;
}

/**
 * The seven layers as one host-owned lifecycle. There is intentionally no
 * correction callback: `enforce()` either returns once or throws one terminal
 * PermissionBreach naming the complete offending set.
 */
export class PermissionSession {
  readonly profile: PermissionProfile;
  readonly before: ChangeSetFingerprint;
  readonly sandboxBadge: SandboxBadge;
  readonly #request: PermissionSessionRequest;
  readonly #git: GitRunner;
  readonly #osEnforced: boolean;

  constructor(request: PermissionSessionRequest) {
    assertSandboxRoots(request);
    this.#request = request;
    this.#git = request.git ?? systemGitRunner(request.worktree);
    this.profile = resolvePermissionProfile(request.profile, request.tools, request.writes);
    assertClean(request.worktree, "before", this.#git);
    this.before = captureChangeSet(request.worktree, this.#git);
    const linux = request.platform === "linux" || (request.platform === undefined && process.platform === "linux");
    this.#osEnforced = linux && (request.sandboxProbe ?? hostProbe)("bwrap");
    this.sandboxBadge = linux ? (this.#osEnforced ? "os-enforced" : "tool-policy") : "unavailable";
  }

  sandbox(spec: ProcessSpec): SandboxGrant {
    return grantSandbox(spec, this.#request, () => this.#osEnforced);
  }

  enforce(): PermissionResult {
    const after = captureChangeSet(this.#request.worktree, this.#git);
    const mutations = changedPaths(this.before, after);
    enforcePathPolicy(mutations, {
      writes: this.profile.writes,
      protectedPaths: this.#request.protectedPaths,
    });
    return Object.freeze({ changedPaths: mutations, sandboxBadge: this.sandboxBadge });
  }
}

export function openPermissionSession(request: PermissionSessionRequest): PermissionSession {
  return new PermissionSession(request);
}
