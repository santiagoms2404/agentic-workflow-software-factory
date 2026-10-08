// Read-only repository facts. Git reads go through the transport broker; there
// is no gc join, provider launch, trap run, state writer or repair operation.
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { readAttempt, type AttemptStatus } from "../cli/commands/attempt.ts";
import type { AwsfConfig } from "../config/schema.ts";
import type { DoctorReadout } from "../contracts/doctor-readout.ts";
import type { TicketState } from "../contracts/ticket.ts";
import { resolveExecutable, runSystemCommand } from "../execution/transport-broker.ts";
import { discoverAttempts } from "../observability/rebuild.ts";
import { parsePlanTicketData } from "../persistence/plan-tickets.ts";
import { defaultWorktreeRoot } from "../persistence/platform-paths.ts";
import { baselineWorktreeName } from "../preflight/baseline-worktree.ts";
import type { RunQuotaCommand, ResolveQuotaExecutable } from "../quota/probe.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { readPlacement } from "../registry/placement.ts";
import { resolvePlanSources, type ResolvedPlanSource } from "../registry/plan-source.ts";
import { baselineRow, type BaselineFact } from "./baseline.ts";
import { branchesRow } from "./branches.ts";
import { markersRow, type MarkerFact } from "./markers.ts";
import { insideWorktreeRoot, parseWorktrees, worktreesRow, type WorktreeFact } from "./worktrees.ts";

export type RepositoryRows = Pick<DoctorReadout["rows"], "branches" | "worktrees" | "baseline" | "markers">;
interface RepositoryInput {
  readonly cwd: string;
  readonly stateRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly config: AwsfConfig | null;
  readonly runCommand?: RunQuotaCommand;
  readonly resolveExecutable?: ResolveQuotaExecutable;
}
const terminal = (attempt: AttemptStatus) => ["LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"].includes(attempt.lifecycleState);
const landed = (attempt: AttemptStatus) => ["LANDED", "PUBLISHED"].includes(attempt.lifecycleState);

async function samePath(a: string, b: string): Promise<boolean> {
  try { return await realpath(a) === await realpath(b); } catch { return resolve(a) === resolve(b); }
}
async function mtime(path: string): Promise<number | null> {
  try { return (await stat(path)).mtimeMs; } catch { return null; }
}

/** Constant Git process count: no per-branch or per-worktree subprocess. */
export async function gatherRepositoryRows(input: RepositoryInput): Promise<RepositoryRows> {
  const run = input.runCommand ?? runSystemCommand;
  const resolver = input.resolveExecutable ?? resolveExecutable;
  let git: string | null = null;
  try { git = resolver("git", input.env); } catch { /* Absence is a warning here. */ }
  const query = (cwd: string, argv: readonly string[]): string | null => {
    if (git === null) return null;
    try {
      // GIT_OPTIONAL_LOCKS=0 keeps even status from opportunistically refreshing the index.
      const response = run(git, [...argv], { cwd, env: { ...input.env, GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 8000, maxBuffer: 4 * 1024 * 1024 });
      return response.status === 0 && response.error === null ? response.stdout : null;
    } catch { return null; }
  };
  let project = input.config?.project.slug ?? null;
  let repositoryPath = input.cwd;
  let defaultBranch: string | null = null;
  let root = defaultWorktreeRoot(input.stateRoot);
  let sources: readonly ResolvedPlanSource[] = [];
  const contextNotes: string[] = [];
  try {
    const catalogPath = join(input.cwd, "awsf.project.yaml");
    const catalog = loadCatalog(await readFile(catalogPath, "utf8"));
    project = catalog.project.slug;
    let placement;
    try { placement = await readPlacement(input.stateRoot, project); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    sources = resolvePlanSources(catalogPath, catalog, placement);
    const planId = Object.keys(catalog.repositories).find(id => catalog.repositories[id]!.role === "plan");
    if (planId !== undefined) {
      defaultBranch = catalog.repositories[planId]!.default_branch;
      repositoryPath = placement?.repositories[planId]?.path ?? input.cwd;
      root = placement?.repositories[planId]?.worktree_root ?? placement?.worktree_root ?? root;
    }
  } catch { contextNotes.push("registered repository/plan context not measured"); }

  const attempts: AttemptStatus[] = [];
  const attemptNotes: string[] = [];
  try {
    for (const dir of await discoverAttempts(input.stateRoot)) {
      try { attempts.push(await readAttempt(dir)); }
      catch { attemptNotes.push("an attempt status is unreadable; attempt ownership and marker coverage may be incomplete"); }
    }
  } catch { attemptNotes.push("attempt inventory not measured"); }
  const local = [] as AttemptStatus[];
  for (const attempt of attempts) if ((project === null || attempt.project === project)
    && (await samePath(attempt.repository, repositoryPath) || await samePath(attempt.repository, input.cwd))) local.push(attempt);
  const byTree = new Map<string, AttemptStatus[]>();
  for (const attempt of local) if (attempt.worktree !== null) {
    const key = resolve(attempt.worktree);
    byTree.set(key, [...(byTree.get(key) ?? []), attempt]);
  }
  const taskAttempts = new Map<string, AttemptStatus[]>();
  for (const attempt of local) taskAttempts.set(attempt.taskId, [...(taskAttempts.get(attempt.taskId) ?? []), attempt]);

  let trees: readonly WorktreeFact[] | null = null;
  const listing = query(input.cwd, ["worktree", "list", "--porcelain", "-z"]);
  if (listing !== null) try { trees = parseWorktrees(listing); } catch { /* Malformed is not empty. */ }
  // The first record is the main worktree, not a linked worktree. Bare entries are not trees.
  const linked = trees?.slice(1).filter(tree => !tree.bare) ?? [];
  const counts = trees === null ? null : { total: linked.length,
    underRoot: linked.filter(tree => insideWorktreeRoot(root, tree.path)).length,
    terminal: linked.filter(tree => { const owners = byTree.get(resolve(tree.path)); return owners !== undefined && owners.every(terminal); }).length,
    noAttempt: linked.filter(tree => !byTree.has(resolve(tree.path))).length };

  const allRefs = query(input.cwd, ["for-each-ref", "--format=%(refname:strip=2)%09%(objectname)", "refs/heads/"]);
  const defaultHead = defaultBranch === null ? null : query(input.cwd, ["rev-parse", "--verify", `refs/heads/${defaultBranch}^{commit}`])?.trim() ?? null;
  const mergedRefs = defaultHead === null ? null : query(input.cwd, ["for-each-ref", `--merged=${defaultHead}`, "--format=%(refname:strip=2)", "refs/heads/"]);
  const merged = new Set((mergedRefs ?? "").split("\n").filter(Boolean));
  const branchNotes = [...contextNotes, ...attemptNotes];
  if (defaultBranch !== null && (defaultHead === null || mergedRefs === null)) branchNotes.push("default branch containment not measured");
  const branches = allRefs === null ? null : allRefs.trim().split("\n").filter(Boolean).map(line => {
    const [name = "", tip = ""] = line.split("\t");
    // A branch belongs to a task only through a recorded worktree association,
    // or the exact task-id branch name. Never fuzzy-match task slug substrings.
    const tasks = new Set(trees?.filter(tree => tree.branch === name).flatMap(tree => (byTree.get(resolve(tree.path)) ?? []).map(owner => owner.taskId)) ?? []);
    if (taskAttempts.has(name)) tasks.add(name);
    const associated = [...tasks];
    const terminalTask = associated.length > 0 && associated.every(task => taskAttempts.get(task)!.every(terminal)) && attemptNotes.length === 0 ? associated.join(", ") : null;
    return { name, tip, contained: merged.has(name), terminalTask };
  });

  const path = project === null ? null : join(root, baselineWorktreeName(project));
  const baseline: BaselineFact = { path, present: null, foreign: null, head: null, defaultHead, dirty: null,
    seededNodeModules: input.config?.runtime.seed_paths.some(seed => seed === "node_modules") ?? false,
    nodeModulesMtime: null, lockfileMtime: null };
  let baselineFact = baseline;
  if (path !== null) {
    let present: boolean | null = null;
    try { await lstat(path); present = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") present = false; }
    baselineFact = { ...baseline, present };
    if (present) {
      const top = query(path, ["rev-parse", "--show-toplevel"]);
      const ownCommon = query(input.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const treeCommon = query(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const foreign = top === null || ownCommon === null || treeCommon === null || !await samePath(top.trim(), path)
        || !await samePath(resolve(input.cwd, ownCommon.trim()), resolve(path, treeCommon.trim()));
      const dirty = foreign ? null : query(path, ["status", "--porcelain", "--untracked-files=normal"]);
      baselineFact = { ...baselineFact, foreign, head: foreign ? null : query(path, ["rev-parse", "HEAD"])?.trim() ?? null,
        dirty: dirty === null ? null : dirty.length > 0, nodeModulesMtime: await mtime(join(path, "node_modules")), lockfileMtime: await mtime(join(input.cwd, "package-lock.json")) };
    }
  }

  const markerFacts: MarkerFact[] = [];
  const ticketStates = new Map<string, TicketState | "not measured">();
  for (const attempt of local.filter(attempt => landed(attempt) && attempt.planRef != null)) {
    const label = `${attempt.project}/${attempt.taskId}#${attempt.attempt}`;
    const plan = attempt.planRef!;
    const source = sources.find(source => basename(source.planPath, ".html") === plan);
    if (attempt.shift == null || attempt.shift.plan !== plan || attempt.shift.tickets.length === 0) {
      markerFacts.push({ attempt: label, plan, tickets: null });
      continue;
    }
    const tickets: NonNullable<MarkerFact["tickets"]>[number][] = [];
    for (const selected of attempt.shift.tickets) {
      const key = `${plan}/${selected.id}`;
      if (!ticketStates.has(key)) {
        let state: NonNullable<MarkerFact["tickets"]>[number]["state"] = "not measured";
        if (source !== undefined && /^[TW]\d\d$/u.test(selected.id)) {
          try {
            const ticket = parsePlanTicketData(await readFile(join(source.ticketsPath, `${selected.id}.md`), "utf8"));
            if (ticket?.id === selected.id) state = ticket.state;
          } catch { /* A missing selected file remains an open diagnostic. */ }
        }
        ticketStates.set(key, state);
      }
      tickets.push({ id: selected.id, state: ticketStates.get(key)! });
    }
    markerFacts.push({ attempt: label, plan, tickets });
  }
  return { branches: branchesRow(branches, defaultBranch, branchNotes), worktrees: worktreesRow(counts, root, attemptNotes),
    baseline: baselineRow(baselineFact), markers: markersRow(markerFacts, [...contextNotes, ...attemptNotes]) };
}
