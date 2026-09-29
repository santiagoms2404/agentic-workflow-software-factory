import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFINED_SYSTEM_ROOTS,
  PermissionSession,
  WorktreeConfinementUnavailable,
  assertSandboxRoots,
  grantSandbox,
} from "../../../src/policy/sandbox-broker.ts";
import { ExecutableNotFound } from "../../../src/execution/transport-broker.ts";
import type { HarnessAdapter } from "../../../src/adapters/interface.ts";
import { PermissionBreach } from "../../../src/policy/path-policy.ts";
import type { GitRunner } from "../../../src/git/changes.ts";

const ROOTS = {
  canonicalRepository: "/srv/repos/project",
  worktree: "/srv/awsf-worktrees/attempt-1",
  sessionRuntime: "/srv/awsf-state/sessions/s1/attempts/1",
  stateRoot: "/srv/awsf-state",
};

const SPEC = {
  executable: "pi",
  argv: ["--mode", "json"],
  cwd: ROOTS.worktree,
  env: { PATH: "/usr/bin" },
  stdin: "private prompt on stdin",
  shell: false as const,
};

test("Linux bwrap grants only runtime for writes: [] and wraps argv without a shell", () => {
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => true);
  assert.equal(grant.badge, "os-enforced");
  assert.equal(grant.mechanism, "linux-bwrap");
  assert.deepEqual(grant.writableRoots, [ROOTS.sessionRuntime]);
  assert.equal(grant.spec.executable, "bwrap");
  assert.equal(grant.spec.shell, false);
  assert.equal(grant.spec.stdin, SPEC.stdin);
  assert.equal(grant.spec.env["TMPDIR"], ROOTS.sessionRuntime);
  assert.ok(grant.spec.argv.includes("--ro-bind"));
  assert.ok(!grant.spec.argv.includes(SPEC.stdin));
  const worktree = grant.spec.argv.indexOf(ROOTS.worktree);
  assert.equal(grant.spec.argv[worktree - 1], "--ro-bind");
});

test("a write-capable Linux grant mounts the managed worktree and runtime writable", () => {
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], platform: "linux" }, () => true);
  assert.deepEqual(grant.writableRoots, [ROOTS.worktree, ROOTS.sessionRuntime]);
  const worktree = grant.spec.argv.indexOf(ROOTS.worktree);
  assert.equal(grant.spec.argv[worktree - 1], "--bind");
});

test("the badge distinguishes Linux tool policy from an unverified Darwin sandbox", () => {
  const linux = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => false);
  const darwin = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "darwin" }, () => true);
  assert.equal(linux.badge, "tool-policy");
  assert.equal(darwin.badge, "unavailable");
  assert.equal(darwin.spec, SPEC);
});

test("the bwrap namespace masks the state root before it rebinds this phase's runtime", () => {
  // `--ro-bind / /` makes the WHOLE host filesystem readable, and `writes: []`
  // confines writes only. A readonly reviewer holding a model-driven Read that
  // can name an absolute path would otherwise reach every other attempt's
  // directory and this attempt's own `private/`. bwrap applies binds in argv
  // order, so the ORDER below is the control and is asserted exactly.
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => true);
  const argv = grant.spec.argv;
  const rootBind = argv.indexOf("--ro-bind");
  const mask = argv.indexOf("--tmpfs");
  const runtime = argv.lastIndexOf(ROOTS.sessionRuntime);

  assert.equal(argv[mask + 1], ROOTS.stateRoot, "the mask covers the state root itself");
  assert.ok(mask > rootBind, "the mask must come after the whole-filesystem read bind it narrows");
  assert.equal(argv[rootBind + 1], "/");
  assert.ok(runtime > mask, "this phase's own runtime is rebound after the mask, or it would be hidden too");
  assert.equal(argv[argv.indexOf(ROOTS.sessionRuntime) - 1], "--bind", "the runtime stays writable");
  assert.deepEqual(argv.slice(0, mask + 2), [
    "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
    "--ro-bind", "/", "/",
    "--tmpfs", ROOTS.stateRoot,
  ]);
});

test("the canonical checkout cannot overlap any sandbox writable root", () => {
  assert.throws(() => assertSandboxRoots({
    canonicalRepository: "/srv/repos/project",
    worktree: "/srv/repos/project/.worktrees/a",
    sessionRuntime: ROOTS.sessionRuntime,
    stateRoot: ROOTS.stateRoot,
  }), /disjoint/);
  assert.throws(() => assertSandboxRoots({
    ...ROOTS,
    sessionRuntime: "/srv/repos/project/runtime",
  }), /canonical repository writable/);
  assert.throws(() => assertSandboxRoots({
    ...ROOTS,
    stateRoot: "relative/state",
  }), /absolute machine-local path/);
});

function gitRunner(outputs: Record<string, string[]>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

test("the post-run comparison aborts with every path and exposes no correction path", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": [
      "",
      ["1\t0\tallowed/a.ts", "1\t0\toutside-a.ts", "1\t0\toutside-b.ts", ""].join("\0"),
    ],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const session = new PermissionSession({
    ...ROOTS,
    writes: ["allowed/**"],
    protectedPaths: [],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });
  assert.equal(session.sandboxBadge, "tool-policy");
  assert.throws(() => session.enforce(), (error: Error) => {
    if (!(error instanceof PermissionBreach)) return false;
    assert.deepEqual(error.offendingPaths, ["outside-a.ts", "outside-b.ts"]);
    return true;
  });
});

test("a reviewer configured writes: [] aborts if it edits a repository file", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", "1\t0\tquiet-fix.ts\0"],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const reviewer = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "no-tools",
    tools: [],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });
  assert.throws(() => reviewer.enforce(), (error: Error) => {
    if (!(error instanceof PermissionBreach)) return false;
    assert.deepEqual(error.offendingPaths, ["quiet-fix.ts"]);
    return true;
  });
});

test("the widened readonly reviewer may read the worktree and still may not write to it", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", "1\t0\tquiet-fix.ts\0"],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const reviewer = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "readonly",
    tools: ["read", "grep", "find", "ls"],
    platform: "linux",
    sandboxProbe: () => true,
    git,
  });
  // Reading is the point of the widening; `writes: []` is what keeps it from
  // becoming a second builder, and the worktree bind stays read-only with it.
  assert.equal(reviewer.profile.repositoryReadOnly, true);
  const grant = reviewer.sandbox(SPEC);
  assert.deepEqual(grant.writableRoots, [ROOTS.sessionRuntime]);
  assert.equal(grant.spec.argv[grant.spec.argv.indexOf(ROOTS.worktree) - 1], "--ro-bind");
  assert.throws(() => reviewer.enforce(), (error: Error) => {
    if (!(error instanceof PermissionBreach)) return false;
    assert.deepEqual(error.offendingPaths, ["quiet-fix.ts"]);
    return true;
  });
});

test("a clean reviewer writes: [] run is green", () => {
  const git = gitRunner({
    "status --porcelain": [""],
    "diff HEAD --numstat --no-renames -z": ["", ""],
    "ls-files --others --exclude-standard -z": ["", ""],
  });
  const session = new PermissionSession({
    ...ROOTS,
    writes: [],
    protectedPaths: [],
    profile: "no-tools",
    tools: [],
    platform: "darwin",
    git,
  });
  assert.deepEqual(session.enforce(), { changedPaths: [], sandboxBadge: "unavailable" });
});

test("delivered visual references are re-bound read-only after the state-root mask, and only when present", () => {
  const references = "/srv/awsf-state/sessions/s1/attempts/1-refs";
  const plain = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], platform: "linux" }, () => true);
  const empty = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], readOnlyRoots: [], platform: "linux" }, () => true);
  assert.deepEqual(empty.spec.argv, plain.spec.argv, "a request with no inputs keeps the reviewed argv byte for byte");
  const grant = grantSandbox(SPEC, { ...ROOTS, writes: ["src/**"], readOnlyRoots: [references], platform: "linux" }, () => true);
  const argv = grant.spec.argv;
  const bind = argv.indexOf(references);
  assert.equal(argv[bind - 1], "--ro-bind");
  assert.equal(argv[bind + 1], references);
  assert.ok(bind > argv.indexOf("--tmpfs"), "the mask comes first, so the rebind is what survives");
  assert.ok(!grant.writableRoots.includes(references));
  const toolPolicy = grantSandbox(SPEC, { ...ROOTS, writes: [], readOnlyRoots: [references], platform: "linux" }, () => false);
  assert.equal(toolPolicy.badge, "tool-policy", "without bwrap nothing claims the inputs are OS-protected");
});

test("a read-only input root may not overlap the worktree or the writable runtime", () => {
  for (const root of [ROOTS.worktree, `${ROOTS.worktree}/refs`, ROOTS.sessionRuntime, `${ROOTS.sessionRuntime}/refs`, "relative/refs"]) {
    assert.throws(() => assertSandboxRoots({ ...ROOTS, readOnlyRoots: [root] }), /read-only input roots/, root);
  }
});

test("a provider's own state directory is bound writable only when it exists, and never inside AWSF's roots", () => {
  const home = mkdtempSync(join(tmpdir(), "awsf-provider-home-"));
  try {
    const agentDir = join(home, ".pi", "agent");
    const absent = grantSandbox(SPEC, { ...ROOTS, writes: [], providerWritableRoots: [agentDir], platform: "linux" }, () => true);
    assert.ok(!absent.spec.argv.includes(agentDir), "a missing directory is neither created nor bound");
    mkdirSync(agentDir, { recursive: true });
    const grant = grantSandbox(SPEC, { ...ROOTS, writes: [], providerWritableRoots: [agentDir], platform: "linux" }, () => true);
    const at = grant.spec.argv.indexOf(agentDir);
    assert.equal(grant.spec.argv[at - 1], "--bind");
    assert.ok(at > grant.spec.argv.indexOf("--ro-bind"), "bound after the read-only root, so it is what survives");
    assert.ok(grant.writableRoots.includes(agentDir));
    const plain = grantSandbox(SPEC, { ...ROOTS, writes: [], platform: "linux" }, () => true);
    assert.deepEqual(grantSandbox(SPEC, { ...ROOTS, writes: [], providerWritableRoots: [], platform: "linux" }, () => true).spec.argv, plain.spec.argv);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a provider state root overlapping the worktree, the canonical checkout or the state root is refused", () => {
  for (const root of [ROOTS.worktree, `${ROOTS.worktree}/x`, ROOTS.canonicalRepository, `${ROOTS.stateRoot}/other-attempt`, "/srv", "relative/agent"]) {
    assert.throws(() => assertSandboxRoots({ ...ROOTS, providerWritableRoots: [root] }), /provider state root/, root);
  }
});

test("every host-confinement argv is the reviewed one, byte for byte, for each adapter, profile and optional root", async () => {
  // W18 task 18 adds `worktree` beside `host`. This pins the whole `host`
  // argv as it stood before, so the new confinement cannot move a byte of any
  // other workflow's launch: omitted and explicit `host` must both produce it.
  const { PiCodexAdapter } = await import("../../../src/adapters/pi-codex.ts");
  const { ClaudeCodeAdapter } = await import("../../../src/adapters/claude-code.ts");
  const home = mkdtempSync(join(tmpdir(), "awsf-host-argv-"));
  try {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    const references = "/srv/awsf-state/sessions/s1/attempts/1-refs";
    const adapters = [new ClaudeCodeAdapter(), new PiCodexAdapter()];
    const profiles = [
      { profile: "readonly", tools: ["read", "grep", "find", "ls"], writes: [] as string[] },
      { profile: "managed-worker", tools: ["read", "grep", "find", "ls", "edit", "write"], writes: ["src/**"] },
      { profile: "no-tools", tools: [] as string[], writes: [] as string[] },
    ];
    for (const adapter of adapters) {
      for (const { profile, tools, writes } of profiles) {
        const spec = adapter.buildSpec({ model: adapter.id === "claude-code" ? "claude:opus" : "codex:gpt-6-sol", prompt: "p",
          cwd: ROOTS.worktree, env: { PATH: "/usr/bin", HOME: home }, profile, tools });
        for (const optional of [{}, { readOnlyRoots: [references], providerWritableRoots: [agentDir] }]) {
          const request = { ...ROOTS, writes, platform: "linux" as const, ...optional };
          const expected = [
            "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
            "--ro-bind", "/", "/",
            "--tmpfs", ROOTS.stateRoot,
            "--proc", "/proc",
            "--dev", "/dev",
            writes.length === 0 ? "--ro-bind" : "--bind", ROOTS.worktree, ROOTS.worktree,
            "--bind", ROOTS.sessionRuntime, ROOTS.sessionRuntime,
            "--ro-bind", ROOTS.canonicalRepository, ROOTS.canonicalRepository,
            ...("readOnlyRoots" in optional ? ["--ro-bind", references, references, "--bind", agentDir, agentDir] : []),
            "--chdir", ROOTS.worktree,
            "--",
            spec.executable,
            ...spec.argv,
          ];
          const label = `${adapter.id} ${profile} ${JSON.stringify(optional)}`;
          assert.deepEqual(grantSandbox(spec, request, () => true).spec.argv, expected, label);
          assert.deepEqual(grantSandbox(spec, { ...request, confinement: "host" }, () => true).spec.argv, expected, label);
          assert.deepEqual(grantSandbox(spec, { ...request, confinement: "host", providerReadableRoots: [join(home, "x")] }, () => true).spec.argv,
            expected, `${label}: readable roots are ignored under host`);
        }
      }
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

/**
 * A machine in miniature for `worktree` confinement: a CLI installed as an npm
 * package behind a relative PATH symlink, a node binary beside it, and the
 * provider's files under a home directory. Resolution is real, so the argv is
 * the one this layout produces on any machine.
 */
function confinedWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-confined-")));
  const home = join(root, "home");
  const prefix = join(home, "prefix");
  const pkg = join(prefix, "lib", "node_modules", "@acme", "fake-cli");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  mkdirSync(join(prefix, "bin"), { recursive: true });
  writeFileSync(join(pkg, "bin", "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  symlinkSync("../lib/node_modules/@acme/fake-cli/bin/cli.js", join(prefix, "bin", "fakecli"));
  writeFileSync(join(prefix, "bin", "node"), "", { mode: 0o755 });
  const provider = join(home, ".fake");
  mkdirSync(join(provider, "sessions"), { recursive: true });
  for (const file of ["auth.json", "settings.json"]) writeFileSync(join(provider, file), "{}\n");
  const roots = {
    canonicalRepository: join(root, "canonical"),
    worktree: join(root, "worktrees", "attempt-1"),
    sessionRuntime: join(root, "state", "attempts", "1", "private", "reviewer"),
    stateRoot: join(root, "state"),
  };
  const spec = {
    executable: "fakecli", argv: ["--mode", "json"], cwd: roots.worktree,
    env: { PATH: join(prefix, "bin"), HOME: home }, stdin: "private prompt on stdin", shell: false as const,
  };
  return { root, home, prefix, pkg, provider, roots, spec };
}

/** The argv's bind operations as [op, source, destination] triples, `--chdir` excluded. */
function mounts(argv: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < argv.length && argv[at] !== "--"; at += 1) {
    const op = argv[at]!;
    if (["--ro-bind", "--bind", "--symlink"].includes(op)) { out.push([op, argv[at + 1]!, argv[at + 2]!]); at += 2; }
    else if (["--tmpfs", "--proc", "--dev"].includes(op)) { out.push([op, argv[at + 1]!]); at += 1; }
  }
  return out;
}

test("worktree confinement binds no host root and lays every declared root down in a fixed order", () => {
  const world = confinedWorld();
  try {
    const { home, prefix, pkg, provider, roots, spec } = world;
    const references = join(roots.stateRoot, "attempts", "1", "refs");
    const grant = grantSandbox(spec, {
      ...roots, writes: [], platform: "linux", confinement: "worktree", readOnlyRoots: [references],
      providerReadableRoots: [join(provider, "settings.json"), join(provider, "absent.json")],
      providerWritableRoots: [join(provider, "auth.json")],
    }, () => true);
    assert.equal(grant.badge, "os-enforced");
    assert.equal(grant.spec.executable, "bwrap");
    assert.equal(grant.spec.env["TMPDIR"], roots.sessionRuntime);
    assert.deepEqual(grant.writableRoots, [roots.sessionRuntime, join(provider, "auth.json")]);
    const argv = grant.spec.argv;

    // The system prefix: only the declared system roots, in their order, as
    // read-only binds or as the symlinks they are on this machine.
    const systemEnd = argv.indexOf("--proc");
    assert.deepEqual(argv.slice(0, 4), ["--die-with-parent", "--new-session", "--unshare-all", "--share-net"]);
    const system = mounts(argv.slice(4, systemEnd));
    assert.deepEqual(system.map((mount) => mount[2]), CONFINED_SYSTEM_ROOTS.filter((path) => {
      try { lstatSync(path); return true; } catch { return false; }
    }));
    for (const [op, source, destination] of system) {
      assert.ok(op === "--symlink" || (op === "--ro-bind" && source === destination), `${op} ${source} ${destination}`);
    }

    // Everything after it, exactly. The resolver's target is this machine's.
    let resolver: string[] = [];
    if (lstatSync("/etc/resolv.conf", { throwIfNoEntry: false })?.isSymbolicLink() === true && existsSync("/etc/resolv.conf")) {
      const target = realpathSync("/etc/resolv.conf");
      if (!["/usr", "/etc"].some((dir) => target.startsWith(`${dir}/`))) resolver = ["--ro-bind", target, target];
    }
    assert.deepEqual(argv.slice(systemEnd), [
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--tmpfs", home,
      ...resolver,
      "--symlink", "../lib/node_modules/@acme/fake-cli/bin/cli.js", join(prefix, "bin", "fakecli"),
      "--ro-bind", pkg, pkg,
      "--ro-bind", join(prefix, "bin", "node"), join(prefix, "bin", "node"),
      "--ro-bind", join(provider, "settings.json"), join(provider, "settings.json"),
      "--ro-bind", roots.worktree, roots.worktree,
      "--bind", roots.sessionRuntime, roots.sessionRuntime,
      "--ro-bind", references, references,
      "--bind", join(provider, "auth.json"), join(provider, "auth.json"),
      "--chdir", roots.worktree,
      "--",
      "fakecli", "--mode", "json",
    ]);

    // What is never bound: the host root, the canonical checkout or its .git,
    // the state root or anything above it, and the provider's own directory.
    for (const mount of mounts(argv).filter(([op]) => op === "--ro-bind" || op === "--bind" || op === "--symlink")) {
      const source = mount[0] === "--symlink" ? mount[2]! : mount[1]!;
      assert.notEqual(source, "/", `${mount.join(" ")} binds the host root`);
      assert.ok(!source.startsWith(roots.canonicalRepository), `${mount.join(" ")} reaches the canonical checkout`);
      assert.ok(!`${roots.stateRoot}/`.startsWith(`${source}/`), `${mount.join(" ")} exposes the state root`);
      assert.ok(source !== provider && !source.startsWith(join(provider, "sessions")), `${mount.join(" ")} binds a provider store`);
    }
    assert.ok(!argv.includes(spec.stdin), "the prompt stays on stdin");
    assert.ok(argv.indexOf(home) < argv.indexOf(pkg), "the home tmpfs is laid down before anything under it is bound back");
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("a write-capable confined grant binds the worktree writable and nothing else of the host", () => {
  const world = confinedWorld();
  try {
    const grant = grantSandbox(world.spec, { ...world.roots, writes: ["src/**"], platform: "linux", confinement: "worktree" }, () => true);
    const worktree = grant.spec.argv.indexOf(world.roots.worktree);
    assert.equal(grant.spec.argv[worktree - 1], "--bind");
    assert.deepEqual(grant.writableRoots, [world.roots.worktree, world.roots.sessionRuntime]);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("worktree confinement refuses without bwrap, where host confinement falls back to tool policy", () => {
  const world = confinedWorld();
  try {
    const request = { ...world.roots, writes: [] as string[], platform: "linux" as const };
    assert.throws(() => grantSandbox(world.spec, { ...request, confinement: "worktree" }, () => false), WorktreeConfinementUnavailable);
    assert.throws(() => grantSandbox(world.spec, { ...request, platform: "darwin", confinement: "worktree" }, () => true), WorktreeConfinementUnavailable);
    assert.equal(grantSandbox(world.spec, request, () => false).badge, "tool-policy");
    const git = gitRunner({ "status --porcelain": [""], "diff HEAD --numstat --no-renames -z": [""], "ls-files --others --exclude-standard -z": [""] });
    assert.throws(() => new PermissionSession({ ...request, confinement: "worktree", profile: "readonly",
      tools: ["read"], protectedPaths: [], sandboxProbe: () => false, git }), WorktreeConfinementUnavailable);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("worktree confinement binds provider files only, and refuses a directory or an unreachable executable", () => {
  const world = confinedWorld();
  try {
    const request = { ...world.roots, writes: [] as string[], platform: "linux" as const, confinement: "worktree" as const };
    for (const roots of [{ providerReadableRoots: [world.provider] }, { providerWritableRoots: [join(world.provider, "sessions")] }]) {
      assert.throws(() => grantSandbox(world.spec, { ...request, ...roots }, () => true), /provider files, never directories/, JSON.stringify(roots));
    }
    assert.throws(() => grantSandbox({ ...world.spec, executable: "absent-cli" }, request, () => true), ExecutableNotFound);
    // A PATH entry that is itself a directory symlink cannot be reproduced by
    // recreating the file's link chain, so it is refused rather than guessed.
    symlinkSync(join(world.prefix, "bin"), join(world.home, "linked-bin"));
    const linked = { ...world.spec, env: { ...world.spec.env, PATH: join(world.home, "linked-bin") } };
    assert.throws(() => grantSandbox(linked, request, () => true), /resolves through a directory symlink/);
    assert.throws(() => grantSandbox({ ...world.spec, env: { ...world.spec.env, HOME: "/" } }, request, () => true), /absolute home directory below \//);
    assert.throws(() => assertSandboxRoots({ ...world.roots, providerReadableRoots: [join(world.roots.worktree, "x")] }), /provider start file may not overlap the managed worktree/);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("pi narrows to its auth file under worktree confinement, and Claude declares only its credentials", async () => {
  const { PiCodexAdapter } = await import("../../../src/adapters/pi-codex.ts");
  const { ClaudeCodeAdapter } = await import("../../../src/adapters/claude-code.ts");
  const env = { HOME: "/home/owner" };
  assert.deepEqual(new PiCodexAdapter().providerWritableRoots(env, "host"), ["/home/owner/.pi/agent"]);
  assert.deepEqual(new PiCodexAdapter().providerWritableRoots(env, "worktree"), ["/home/owner/.pi/agent/auth.json"]);
  assert.deepEqual(new PiCodexAdapter().providerWritableRoots({}, "worktree"), []);
  assert.deepEqual(new ClaudeCodeAdapter().providerReadableRoots(env), ["/home/owner/.claude/.credentials.json"]);
  assert.deepEqual(new ClaudeCodeAdapter().providerReadableRoots({}), []);
  // No declared root is a session, transcript, history, project or memory store.
  const declared = [new PiCodexAdapter(), new ClaudeCodeAdapter()].flatMap((adapter: HarnessAdapter) => [
    ...(adapter.providerWritableRoots?.(env, "worktree") ?? []),
    ...(adapter.providerReadableRoots?.(env) ?? []),
  ]);
  for (const path of declared) {
    assert.doesNotMatch(path, /sessions|projects|history|file-history|memory|transcript/, path);
    assert.ok(![join(env.HOME, ".claude"), join(env.HOME, ".pi", "agent"), join(env.HOME, ".claude.json")].includes(path), path);
  }
});

test("pi declares exactly its agent directory under the child's HOME; Claude declares none", async () => {
  const { PiCodexAdapter } = await import("../../../src/adapters/pi-codex.ts");
  const { ClaudeCodeAdapter } = await import("../../../src/adapters/claude-code.ts");
  assert.deepEqual(new PiCodexAdapter().providerWritableRoots({ HOME: "/home/owner" }), ["/home/owner/.pi/agent"]);
  assert.deepEqual(new PiCodexAdapter().providerWritableRoots({}), []);
  assert.equal("providerWritableRoots" in new ClaudeCodeAdapter(), false);
});
