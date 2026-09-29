import { assertProtectedOutput } from "../workflow/protected-grants.ts";
import { protectedWriteContext, type ProtectedFilesCapability } from "../contracts/protected-capability.ts";
import { existsSync, lstatSync, readlinkSync, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ProcessSpec, SandboxConfinement } from "../adapters/interface.ts";
import {
  assertClean,
  captureChangeSet,
  changedPaths,
  systemGitRunner,
  type ChangeSetFingerprint,
  type GitRunner,
} from "../git/changes.ts";
import { ExecutableNotFound, resolveExecutable, runSystemCommand } from "../execution/transport-broker.ts";
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
  /**
   * Host-provisioned inputs the phase may read and never write — today only
   * delivered visual references. Each is re-bound read-only AFTER the state
   * root mask, so under bwrap it is the one extra part of the state tree the
   * phase can see. Without an OS sandbox nothing makes it read-only; the host
   * detects a replacement by digest instead of preventing it.
   */
  readonly readOnlyRoots?: readonly string[];
  /**
   * The provider CLI's own state directory, when it cannot start without
   * writing there (`HarnessAdapter.providerWritableRoots`). Bound writable,
   * and only when it exists: the one host path outside the attempt a phase
   * may write. It may never overlap the worktree, the canonical checkout or
   * the state root, so it can never unmask another attempt.
   */
  readonly providerWritableRoots?: readonly string[];
  /**
   * The provider CLI's exact start and auth files
   * (`HarnessAdapter.providerReadableRoots`), bound read-only under `worktree`
   * confinement and only when they exist. Ignored under `host`, where the
   * whole host is already readable and the argv must not move.
   */
  readonly providerReadableRoots?: readonly string[];
  /**
   * `host` (the default) binds the whole filesystem read-only and masks the
   * state root. `worktree` binds no host root, so the canonical checkout, other
   * worktrees and every CLI transcript store are absent rather than merely
   * unwritable. A prove replay's agent runs under it (W18 task 18). It has no
   * tool-policy fallback: without bwrap the grant refuses.
   */
  readonly confinement?: SandboxConfinement;
  readonly platform?: NodeJS.Platform;
}

export type SandboxProbe = (executable: string) => boolean;

/**
 * `worktree` confinement asked for where no OS sandbox exists. A tool policy
 * cannot stand in: the T12 C7 probes read the corpus by absolute path through
 * both adapters' policies, and what a CLI's policy allows depends on the home
 * directory it starts in.
 */
export class WorktreeConfinementUnavailable extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`worktree confinement needs the Linux bwrap sandbox, and this ${platform} host has none; ` +
      "no tool policy can stand in for it");
    this.name = "WorktreeConfinementUnavailable";
  }
}

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
  const canonicalState = physical(request.stateRoot);
  for (const [label, roots] of [["provider state root", request.providerWritableRoots], ["provider start file", request.providerReadableRoots]] as const) {
    for (const root of roots ?? []) {
      if (!isAbsolute(root)) throw new Error(`${label}s must be absolute machine-local paths`);
      const provider = physical(root);
      for (const [name, other] of [["managed worktree", worktree], ["canonical repository", canonical], ["state root", canonicalState]] as const) {
        if (inside(other, provider) || inside(provider, other)) {
          throw new Error(`a ${label} may not overlap the ${name}`);
        }
      }
    }
  }
  for (const root of request.readOnlyRoots ?? []) {
    if (!isAbsolute(root)) throw new Error("read-only input roots must be absolute machine-local paths");
    const input = physical(root);
    if (inside(worktree, input) || inside(input, worktree) || inside(runtime, input) || inside(input, runtime)) {
      throw new Error("read-only input roots must be disjoint from the managed worktree and the writable session runtime");
    }
  }
}

/** The provider roots that exist; a missing one is not created, and not bound. */
function providerRoots(request: SandboxRequest): readonly string[] {
  return (request.providerWritableRoots ?? []).filter((root) => existsSync(root));
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
      ...(request.readOnlyRoots ?? []).flatMap((root) => ["--ro-bind", root, root]),
      ...providerRoots(request).flatMap((root) => ["--bind", root, root]),
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

/** System directories a confined phase reads, in bind order; each only when it exists. */
export const CONFINED_SYSTEM_ROOTS: readonly string[] = Object.freeze(["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"]);

/**
 * System files that may be symlinks out of the directories above. WSL points
 * the resolver at `/mnt/wsl/resolv.conf` and systemd at `/run/...`; without the
 * target the namespace has no DNS and no CLI reaches its provider.
 */
const CONFINED_SYSTEM_LINKS: readonly string[] = Object.freeze(["/etc/resolv.conf"]);

/** The most symlink hops an executable's PATH entry may take to its file. */
const MAXIMUM_LINK_HOPS = 40;

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function insideAny(roots: readonly string[], path: string): boolean {
  return roots.some((root) => inside(root, path));
}

/**
 * The npm package holding `file`, when it is inside one. A native CLI shipped
 * in a package still reads its vendored tools beside itself, and a bundled
 * script imports its chunks, so the package is the install; a bare file is
 * its own.
 */
function packageRoot(file: string): string | null {
  const parts = file.split(sep);
  const at = parts.lastIndexOf("node_modules");
  if (at === -1) return null;
  const end = at + (parts[at + 1]?.startsWith("@") === true ? 3 : 2);
  return end < parts.length ? parts.slice(0, end).join(sep) : null;
}

/**
 * How the confined namespace reaches one executable by the same PATH lookup
 * the host makes: each symlink on the way recreated as a link, and the install
 * it lands in bound read-only. Anything already inside a bound system
 * directory is there and is skipped. A path that turns through a directory
 * symlink is refused rather than approximated, because the link chain alone
 * would not reproduce it.
 */
function executableMounts(executable: string, env: Readonly<Record<string, string>>, system: readonly string[]): string[] {
  const found = resolveExecutable(executable, env);
  const argv: string[] = [];
  let current = found;
  for (let hop = 0; lstatOrNull(current)?.isSymbolicLink() === true; hop += 1) {
    if (hop === MAXIMUM_LINK_HOPS) throw new Error(`worktree confinement cannot follow ${found}: more than ${String(MAXIMUM_LINK_HOPS)} symlinks`);
    const target = readlinkSync(current);
    if (!insideAny(system, current)) argv.push("--symlink", target, current);
    current = resolve(dirname(current), target);
  }
  const real = realpathSync.native(found);
  if (real !== current) {
    throw new Error(`worktree confinement cannot reach ${executable}: ${found} resolves through a directory symlink to ${real}`);
  }
  const install = packageRoot(real) ?? real;
  if (!insideAny(system, install)) argv.push("--ro-bind", install, install);
  return argv;
}

/**
 * The provider's declared files that exist. A directory is refused: under
 * `worktree` a provider root is an exact file, so no declaration can bind a
 * whole CLI state directory and the sessions inside it.
 */
function providerFiles(roots: readonly string[] | undefined): readonly string[] {
  return (roots ?? []).filter((root) => {
    let stat: Stats;
    try {
      stat = statSync(root);
    } catch {
      return false;
    }
    if (!stat.isFile()) throw new Error(`worktree confinement binds provider files, never directories: ${root} is not a regular file`);
    return true;
  });
}

/**
 * `worktree` confinement: the namespace starts empty and gains only what the
 * work needs, in this fixed order. System directories come first, then the
 * fresh `/tmp` and home tmpfs mounts, so every later bind under either is laid
 * on top of them and survives. No `/`, canonical repository, `.git` or state
 * root is ever bound; the worktree's `.git` file therefore names an object
 * store that is not there, and Git inside the namespace finds no repository.
 */
function confinedSpec(spec: ProcessSpec, request: SandboxRequest): ProcessSpec {
  const home = spec.env["HOME"];
  if (home !== undefined && (!isAbsolute(home) || resolve(home) === "/")) {
    throw new Error(`worktree confinement needs an absolute home directory below /, not ${JSON.stringify(home)}`);
  }
  const system: string[] = [];
  const systemMounts: string[] = [];
  for (const root of CONFINED_SYSTEM_ROOTS) {
    const stat = lstatOrNull(root);
    if (stat === null) continue;
    if (stat.isSymbolicLink()) {
      systemMounts.push("--symlink", readlinkSync(root), root);
    } else {
      systemMounts.push("--ro-bind", root, root);
      system.push(root);
    }
  }
  const linkTargets = CONFINED_SYSTEM_LINKS.flatMap((link) => {
    if (lstatOrNull(link)?.isSymbolicLink() !== true || !existsSync(link)) return [];
    const target = realpathSync.native(link);
    return insideAny(system, target) ? [] : ["--ro-bind", target, target];
  });
  let node: string[] = [];
  try {
    node = executableMounts("node", spec.env, system);
  } catch (error) {
    // No node on the child's PATH is only a problem for a CLI that needs one,
    // and that CLI would fail the same way on the host.
    if (!(error instanceof ExecutableNotFound)) throw error;
  }
  const executable = executableMounts(spec.executable, spec.env, system);
  const seen = new Set<string>();
  const installs: string[] = [];
  for (const mounts of [executable, node]) {
    for (let at = 0; at < mounts.length; at += 3) {
      const [operation, source, destination] = mounts.slice(at, at + 3) as [string, string, string];
      if (seen.has(destination)) continue;
      seen.add(destination);
      installs.push(operation, source, destination);
    }
  }
  const worktreeBind = request.writes.length === 0 ? "--ro-bind" : "--bind";
  return {
    executable: "bwrap",
    argv: [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--share-net",
      ...systemMounts,
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      ...(home === undefined ? [] : ["--tmpfs", home]),
      ...linkTargets,
      ...installs,
      ...providerFiles(request.providerReadableRoots).flatMap((file) => ["--ro-bind", file, file]),
      worktreeBind, request.worktree, request.worktree,
      "--bind", request.sessionRuntime, request.sessionRuntime,
      ...(request.readOnlyRoots ?? []).flatMap((root) => ["--ro-bind", root, root]),
      ...providerFiles(request.providerWritableRoots).flatMap((file) => ["--bind", file, file]),
      "--chdir", spec.cwd,
      "--",
      spec.executable,
      ...spec.argv,
    ],
    cwd: request.worktree,
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
  const confined = request.confinement === "worktree";
  if (platform === "linux" && probe("bwrap")) {
    return Object.freeze({
      badge: "os-enforced",
      mechanism: "linux-bwrap",
      writableRoots: Object.freeze([
        ...(request.writes.length === 0 ? [] : [physical(request.worktree)]),
        physical(request.sessionRuntime),
        ...(confined ? providerFiles(request.providerWritableRoots) : providerRoots(request)).map(physical),
      ]),
      spec: confined ? confinedSpec(spec, request) : bwrapSpec(spec, request),
    });
  }
  if (confined) throw new WorktreeConfinementUnavailable(platform);
  const toolPolicy = platform === "linux";
  return Object.freeze({
    badge: toolPolicy ? "tool-policy" : "unavailable",
    mechanism: toolPolicy ? "adapter-tool-policy" : "none",
    writableRoots: Object.freeze([physical(request.sessionRuntime)]),
    spec,
  });
}

export interface PermissionSessionRequest extends SandboxRequest {
  readonly protectedCapability?: ProtectedFilesCapability;
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
    if (request.confinement === "worktree" && !this.#osEnforced) {
      throw new WorktreeConfinementUnavailable(request.platform ?? process.platform);
    }
    if (request.protectedCapability !== undefined) {
      const proof = protectedWriteContext(request.protectedCapability);
      if (this.sandboxBadge !== "os-enforced" || proof?.grant.subject.worktree !== physical(request.worktree) ||
          JSON.stringify(proof.policy) !== JSON.stringify({ profile: request.profile, tools: request.tools, writes: request.writes, protectedPaths: request.protectedPaths })) {
        throw new Error("protected execution requires its original role policy, authentic worktree capability and OS sandbox");
      }
      assertProtectedOutput(request.protectedCapability, request.worktree);
    }
  }

  sandbox(spec: ProcessSpec): SandboxGrant {
    return grantSandbox(spec, this.#request, () => this.#osEnforced);
  }

  enforce(): PermissionResult {
    if (this.#request.protectedCapability !== undefined) assertProtectedOutput(this.#request.protectedCapability, this.#request.worktree);
    const after = captureChangeSet(this.#request.worktree, this.#git);
    const mutations = changedPaths(this.before, after);
    enforcePathPolicy(mutations, {
      writes: this.profile.writes,
      protectedPaths: this.#request.protectedPaths,
      ...(this.#request.protectedCapability === undefined ? {} : { protectedCapability: this.#request.protectedCapability }),
    });
    if (this.#request.protectedCapability !== undefined) assertProtectedOutput(this.#request.protectedCapability, this.#request.worktree);
    return Object.freeze({ changedPaths: mutations, sandboxBadge: this.sandboxBadge });
  }
}

export function openPermissionSession(request: PermissionSessionRequest): PermissionSession {
  return new PermissionSession(request);
}
