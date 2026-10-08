import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, lstatSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { DoctorReadoutSchema } from "../../../src/contracts/doctor-readout.ts";
import { branchesRow } from "../../../src/doctor/branches.ts";
import { baselineRow } from "../../../src/doctor/baseline.ts";
import { markersRow } from "../../../src/doctor/markers.ts";
import { gatherRepositoryRows } from "../../../src/doctor/repository.ts";
import { buildDoctorReport } from "../../../src/doctor/report.ts";
import { parseWorktrees, insideWorktreeRoot } from "../../../src/doctor/worktrees.ts";
import { runGit, systemGitRunner } from "../../../src/git/changes.ts";

const config = loadConfig(readFileSync(new URL("../../../../awsf.config.yaml", import.meta.url), "utf8"));
const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
function git(cwd: string, ...argv: string[]) { return runGit(systemGitRunner(cwd), argv).trim(); }
function snapshot(root: string): unknown[] {
  const result: unknown[] = [];
  function visit(path: string) {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      const info = lstatSync(child);
      result.push([relative(root, child), info.mode, info.mtimeMs, info.isDirectory() ? null : readFileSync(child).toString("hex")]);
      if (info.isDirectory()) visit(child);
    }
  }
  visit(root);
  return result;
}
function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-repo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "trees");
  git(root, "init", "--quiet", "-b", "main", repository);
  mkdirSync(worktreeRoot);
  mkdirSync(join(repository, "plans", "tickets", "synthetic-plan"), { recursive: true });
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: synthetic}\nrepositories:\n  main: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, "plans", "synthetic-plan.html"), '<section><h3><code class="status">[]</code> Milestone M1: Synthetic</h3><h4>1. Synthetic</h4></section>');
  writeFileSync(join(repository, "plans", "tickets", "synthetic-plan", "T01.md"), "---\nid: T01\ntitle: synthetic\nmilestone: M1\nstate: todo\ndepends_on: []\n---\nSynthetic request\n");
  writeFileSync(join(repository, "package-lock.json"), "synthetic lockfile\n");
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  git(repository, "add", ".");
  git(repository, ...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "test: synthetic baseline");
  const head = git(repository, "rev-parse", "HEAD");
  mkdirSync(join(stateRoot, "projects", "synthetic"), { recursive: true });
  writeFileSync(join(stateRoot, "projects", "synthetic", "placement.yaml"), `version: awsf.placement/v1\nproject: synthetic\nrepositories:\n  main:\n    path: ${repository}\n    worktree_root: ${worktreeRoot}\n`);
  const measuredConfig = { ...config, project: { ...config.project, slug: "synthetic" }, runtime: { ...config.runtime, seed_paths: ["node_modules"] } };
  return { root, repository, stateRoot, worktreeRoot, head, measuredConfig };
}
function attempt(world: ReturnType<typeof setup>, taskId: string, lifecycleState: AttemptStatus["lifecycleState"], worktree: string | null, extra: object = {}, number = 1) {
  const dir = join(world.stateRoot, "projects", "synthetic", "tasks", taskId, String(number));
  mkdirSync(dir, { recursive: true });
  const status = { project: "synthetic", taskId, attempt: number, lifecycleState, worktree, repository: world.repository,
    workflow: "build", planRef: null, budget: { ownerReentries: 0, allowance: { auto: 0, owner: 0, ownerReentries: 0 } },
    ...extra };
  writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  writeFileSync(join(dir, "journal.jsonl"), `${JSON.stringify({ source_seq: 1, recorded_at: "2026-10-08T12:00:00Z", event: { kind: "attempt.created", next: status } })}\n`);
}
const envRows = Object.fromEntries(["storage", "executables", "providers", "quota", "coverage"].map(name => [name, { status: "ok", detail: ["synthetic"] }])) as Pick<import("../../../src/doctor/gather.ts").EnvironmentRows, "storage" | "executables" | "providers" | "quota" | "coverage">;

test("real Git: stale branch, terminal/unowned linked trees, dirty and aged seeded baseline, open and unmapped landings; every row text and JSON, no writes", async t => {
  const world = setup(t);
  const baseline = join(world.worktreeRoot, "awsf-baseline-synthetic");
  const done = join(world.worktreeRoot, "terminal-tree");
  const unowned = join(world.root, "outside factory tree");
  const active = join(world.worktreeRoot, "active-tree");
  git(world.repository, "branch", "stale", world.head);
  for (const path of [baseline, done, unowned, active]) git(world.repository, "worktree", "add", "--quiet", "--detach", path, world.head);
  writeFileSync(join(baseline, "package-lock.json"), "dirty baseline\n");
  mkdirSync(join(baseline, "node_modules"));
  utimesSync(join(baseline, "node_modules"), new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
  attempt(world, "terminal-task", "CANCELLED", done);
  attempt(world, "active-task", "RUNNING", active);
  attempt(world, "shift-task", "LANDED", null, { planRef: "synthetic-plan", shift: { plan: "synthetic-plan", tickets: [{ id: "T01", path: "not-the-registered-path.md" }] } });
  attempt(world, "ordinary-task", "LANDED", null, { planRef: "synthetic-plan" });
  const before = snapshot(world.root);
  const rows = await gatherRepositoryRows({ cwd: world.repository, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.measuredConfig });
  assert.match(rows.branches.detail.join("\n"), /stale.*tip contained by default branch/);
  assert.match(rows.worktrees.detail[0]!, /linked worktrees=4; under factory root=3; terminal attempt=1; no attempt=2/);
  assert.match(rows.baseline.detail.join("\n"), /foreign=false; dirty=true/);
  assert.match(rows.baseline.detail.join("\n"), /older than repository lockfile=true/);
  assert.match(rows.markers.detail.join("\n"), /synthetic\/shift-task#1: synthetic-plan\/T01=todo/);
  assert.match(rows.markers.detail[0]!, /unmapped=1/);
  for (const row of Object.values(rows)) assert.equal(row.status, "warn");
  const report = buildDoctorReport({ healthy: true, lines: ["healthy: synthetic"] }, { line: "jev: synthetic", finding: null }, { ...envRows, ...rows });
  assert.equal(report.healthy, true, "repository warnings never make doctor unhealthy");
  assert.equal(Value.Check(DoctorReadoutSchema, JSON.parse(JSON.stringify(report))), true);
  for (const name of Object.keys(rows)) {
    assert.ok(Object.hasOwn(JSON.parse(JSON.stringify(report)).rows, name));
    assert.ok(report.lines.some(line => line.startsWith(`${name}: warn:`)));
  }
  assert.deepEqual(snapshot(world.root), before, "Git indexes, refs, tickets, placement and state retain bytes, modes and mtimes");
  const managed = await gatherRepositoryRows({ cwd: active, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.measuredConfig });
  assert.deepEqual(managed.markers, rows.markers, "a managed checkout still joins attempts recorded against its placed canonical repository");
  assert.deepEqual(snapshot(world.root), before);
});

test("task-terminal branch matching uses exact task names, all retries and recorded tree ownership", async t => {
  const world = setup(t);
  git(world.repository, "checkout", "--quiet", "-b", "ended-task");
  writeFileSync(join(world.repository, "new.txt"), "not contained\n");
  git(world.repository, "add", "new.txt");
  git(world.repository, ...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "test: branch ahead");
  git(world.repository, "branch", "mixed-task");
  git(world.repository, "branch", "prefix-ended-task");
  git(world.repository, "branch", "recorded-branch");
  git(world.repository, "checkout", "--quiet", "main");
  const tree = join(world.worktreeRoot, "recorded-tree");
  git(world.repository, "worktree", "add", "--quiet", tree, "recorded-branch");
  attempt(world, "ended-task", "BLOCKED", null);
  attempt(world, "mixed-task", "CANCELLED", null);
  attempt(world, "mixed-task", "DRAFT", null, {}, 2);
  attempt(world, "different-task", "PUBLISHED", tree);
  const rows = await gatherRepositoryRows({ cwd: world.repository, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.measuredConfig });
  assert.ok(rows.branches.detail.some(line => line.startsWith("ended-task at") && line.includes("all attempts terminal")));
  assert.ok(rows.branches.detail.some(line => line.startsWith("recorded-branch at") && line.includes("different-task")));
  assert.ok(!rows.branches.detail.some(line => line.startsWith("mixed-task at") || line.startsWith("prefix-ended-task at")));
});

test("registered plan root wins over adjacent or sealed ticket paths; done, missing and plan-mismatch selections are explicit", async t => {
  const world = setup(t);
  const ticket = join(world.repository, "plans", "tickets", "synthetic-plan", "T01.md");
  writeFileSync(ticket, readFileSync(ticket, "utf8").replace("state: todo", "state: done"));
  mkdirSync(join(world.repository, "specs", "tickets", "synthetic-plan"), { recursive: true });
  writeFileSync(join(world.repository, "specs", "tickets", "synthetic-plan", "T01.md"), "state: todo\n");
  attempt(world, "mapped", "PUBLISHED", null, { planRef: "synthetic-plan", shift: { plan: "synthetic-plan", tickets: [{ id: "T01" }, { id: "T02" }] } });
  attempt(world, "mismatch", "LANDED", null, { planRef: "synthetic-plan", shift: { plan: "another-plan", tickets: [{ id: "T01" }] } });
  attempt(world, "active", "RUNNING", null, { planRef: "synthetic-plan" });
  const rows = await gatherRepositoryRows({ cwd: world.repository, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.measuredConfig });
  assert.match(rows.markers.detail[0]!, /landed attempts with plan ref=2; open selected tickets=1; unmapped=1/);
  assert.match(rows.markers.detail.join("\n"), /synthetic-plan\/T02=not measured/);
  assert.doesNotMatch(rows.markers.detail.join("\n"), /T01=/);
});

test("baseline absent, foreign, clean, ahead and missing seed measurements remain read-only diagnostics", async t => {
  const world = setup(t);
  const input = { cwd: world.repository, stateRoot: world.stateRoot, env: { ...process.env } as Record<string, string>, config: world.measuredConfig };
  assert.match((await gatherRepositoryRows(input)).baseline.detail[0]!, /absent/);
  const path = join(world.worktreeRoot, "awsf-baseline-synthetic");
  mkdirSync(path);
  const before = snapshot(world.root);
  const foreign = (await gatherRepositoryRows(input)).baseline;
  assert.equal(foreign.status, "warn");
  assert.match(foreign.detail[0]!, /foreign=true/);
  assert.deepEqual(snapshot(world.root), before);
  const facts = { path, present: true, foreign: false, head: world.head, defaultHead: world.head, dirty: false,
    seededNodeModules: true, nodeModulesMtime: 100, lockfileMtime: 100 };
  assert.equal(baselineRow(facts).status, "ok");
  assert.equal(baselineRow({ ...facts, head: "b".repeat(40) }).status, "warn");
  assert.equal(baselineRow({ ...facts, nodeModulesMtime: null }).status, "warn");
  assert.equal(baselineRow({ ...facts, seededNodeModules: false, nodeModulesMtime: null }).status, "ok");
});

test("NUL worktree paths preserve spaces/newlines and factory root containment is component-bound", () => {
  const path = "/synthetic/trees/a\nb \\ c";
  const trees = parseWorktrees(`worktree ${path}\0HEAD abc\0branch refs/heads/task\0\0`);
  assert.equal(trees[0]!.path, path);
  assert.equal(trees[0]!.branch, "task");
  assert.equal(insideWorktreeRoot("/synthetic/trees", path), true);
  assert.equal(insideWorktreeRoot("/synthetic/trees", "/synthetic/trees-other/task"), false);
  assert.throws(() => parseWorktrees("broken\0\0"));
});

test("200 linked worktrees cost four bulk Git reads without per-tree or per-branch processes", async t => {
  const world = setup(t);
  const calls: string[][] = [];
  const start = performance.now();
  const rows = await gatherRepositoryRows({ cwd: world.repository, stateRoot: world.stateRoot, env: { PATH: "/synthetic" }, config: world.measuredConfig,
    resolveExecutable: () => "/synthetic/git",
    runCommand: (executable, argv, options) => {
      assert.equal(executable, "/synthetic/git");
      assert.equal(options.env?.GIT_OPTIONAL_LOCKS, "0");
      calls.push([...argv]);
      const stdout = argv[0] === "worktree" ? `worktree ${world.repository}\0HEAD ${world.head}\0\0` + Array.from({ length: 200 }, (_, i) => `worktree ${world.worktreeRoot}/tree-${i}\0HEAD ${world.head}\0detached\0\0`).join("")
        : argv[0] === "rev-parse" ? world.head
          : argv.some(arg => arg.startsWith("--merged=")) ? "main\nstale\n" : `main\t${world.head}\nstale\t${world.head}\n`;
      return { status: 0, error: null, stderr: "", stdout };
    } });
  assert.equal(calls.length, 4);
  assert.match(rows.worktrees.detail[0]!, /linked worktrees=200; under factory root=200; terminal attempt=0; no attempt=200/);
  t.diagnostic(`200-worktree synthetic gather: ${Math.round(performance.now() - start)} ms; 4 bulk Git reads`);
});

test("unavailable Git/registration is warn, never empty success or a finding; pure rows never repair", async t => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-repo-unavailable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = snapshot(root);
  const rows = await gatherRepositoryRows({ cwd: root, stateRoot: join(root, "state"), env: {}, config: null, resolveExecutable: () => { throw new Error("absent"); } });
  for (const row of Object.values(rows)) assert.equal(row.status, "warn");
  assert.deepEqual(snapshot(root), before);
  assert.equal(branchesRow([], "main").status, "ok");
  assert.equal(markersRow([{ attempt: "synthetic#1", plan: "plan", tickets: [{ id: "T01", state: "done" }] }]).status, "ok");
});
