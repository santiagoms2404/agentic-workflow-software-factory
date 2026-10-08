import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt } from "../../src/cli/commands/attempt.ts";
import { DoctorReadoutSchema, type DoctorReadout } from "../../src/contracts/doctor-readout.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { resolveExecutable } from "../../src/execution/transport-broker.ts";
import { runGit, systemGitRunner } from "../../src/git/changes.ts";

const ROWS = ["existing", "jev", "storage", "executables", "providers", "quota", "coverage", "branches", "worktrees", "baseline", "markers"];
const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
const git = (cwd: string, ...argv: string[]) => runGit(systemGitRunner(cwd), argv).trim();

function snapshot(root: string): unknown[] {
  const out: unknown[] = [];
  function visit(path: string) {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const info = lstatSync(full);
      out.push([relative(root, full), info.mode, info.mtimeMs, info.isSymbolicLink() ? readlinkSync(full)
        : info.isDirectory() ? null : readFileSync(full).toString("hex")]);
      if (info.isDirectory()) visit(full);
    }
  }
  visit(root);
  return out;
}

function quotaFixture(name: string): string {
  const original = JSON.parse(readFileSync(new URL(`../fixtures/quota-axi/${name}.json`, import.meta.url), "utf8"));
  // Move only synthetic fixture dates to this invocation's clock; main() must
  // gather the same healthy quota facts regardless of the date the suite runs.
  const offset = Date.now() - Date.parse(original.generatedAt);
  return JSON.stringify(original, (_key, value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/u.test(value)
    ? new Date(Date.parse(value) + offset).toISOString() : value);
}
function quotaSandbox(bin: string, name: string): void {
  const json = quotaFixture(name).replace(/'/gu, "'\\''");
  // This synthetic bwrap returns a readout instead of starting any process. The
  // production code still has to construct its read-only sandbox argv.
  const script = `#!/bin/sh\ncase "$*" in\n  *--ro-bind*QUOTA_AXI_CODEX_BINARY*--version*) printf '%s\\n' '0.1.29' ;;\n  *--ro-bind*QUOTA_AXI_CODEX_BINARY*--json*) printf '%s\\n' '${json}' ;;\n  *) exit 97 ;;\nesac\n`;
  writeFileSync(join(bin, "bwrap"), script);
  chmodSync(join(bin, "bwrap"), 0o700);
}

async function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-journey-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  const trees = join(root, "trees");
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(resolveExecutable("git", process.env as Record<string, string>), join(bin, "git"));
  for (const executable of ["claude", "pi", "agy", "quota-axi"]) {
    // A provider or an unsandboxed quota launch leaves a sentinel and fails the
    // complete-tree snapshot assertion. No real provider binary is reachable.
    writeFileSync(join(bin, executable), '#!/bin/sh\nprintf unexpected > "$0.called"\nexit 99\n');
    chmodSync(join(bin, executable), 0o700);
  }
  quotaSandbox(bin, "nominal");
  git(root, "init", "--quiet", "-b", "main", repository);
  mkdirSync(join(repository, "plans", "tickets", "synthetic-plan"), { recursive: true });
  writeFileSync(join(repository, "awsf.config.yaml"), readFileSync(new URL("../../../awsf.config.yaml", import.meta.url), "utf8").replace("slug: agentic-workflow-software-factory", "slug: synthetic"));
  writeFileSync(join(repository, "awsf.project.yaml"), "version: awsf.project/v1\nproject: {slug: synthetic}\nrepositories:\n  main: {role: plan, default_branch: main}\nplans: {root: plans, format: awsf-plan-html/v1}\n");
  writeFileSync(join(repository, "plans", "synthetic-plan.html"), '<section><h3><code class="status">[]</code> Milestone M1: Synthetic</h3><h4>1. Synthetic</h4></section>');
  const ticketPath = "plans/tickets/synthetic-plan/T01.md";
  const ticket = "---\nid: T01\ntitle: synthetic\nmilestone: M1\nstate: todo\ndepends_on: []\n---\nSynthetic request\n";
  writeFileSync(join(repository, ticketPath), ticket);
  writeFileSync(join(repository, "package-lock.json"), "synthetic lockfile\n");
  writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
  git(repository, "add", ".");
  git(repository, ...OWNER, "commit", "--quiet", "--no-gpg-sign", "-m", "test: synthetic doctor checkout");
  git(repository, "branch", "stale");
  const baseline = join(trees, "awsf-baseline-synthetic");
  git(repository, "worktree", "add", "--quiet", "--detach", baseline, "HEAD");
  git(repository, "worktree", "add", "--quiet", "--detach", join(trees, "unowned"), "HEAD");
  writeFileSync(join(baseline, "package-lock.json"), "dirty synthetic baseline\n");
  mkdirSync(join(baseline, "node_modules"));
  utimesSync(join(baseline, "node_modules"), new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
  mkdirSync(join(stateRoot, "projects", "synthetic"), { recursive: true });
  writeFileSync(join(stateRoot, "projects", "synthetic", "placement.yaml"), `version: awsf.placement/v1\nproject: synthetic\nrepositories:\n  main:\n    path: ${repository}\n    worktree_root: ${trees}\n`);
  const shift = sealShiftManifest({ plan: "synthetic-plan", milestones: ["M1"], tickets: [{ id: "T01", path: ticketPath, digest: createHash("sha256").update(ticket).digest("hex") }] });
  const created = await newCommand({ stateRoot, project: "synthetic", taskId: "landed-shift", repository, request: "Synthetic doctor marker evidence",
    workflow: "shift", tier: 1, planRef: "synthetic-plan", shift, sessionId: () => "synthetic-doctor-shift" });
  await persistAttempt(created.attemptDir, created.status.revision, { kind: "attempt.transitioned", next: nextRevision(created.status, { lifecycleState: "LANDED" }) });
  return { root, repository, stateRoot, bin, env: { PATH: bin, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } };
}

async function diagnose(world: Awaited<ReturnType<typeof setup>>, json: boolean): Promise<{ code: number; lines: string[] }> {
  const before = snapshot(world.root);
  const lines: string[] = [];
  const code = await main({ argv: ["doctor", "--state-root", world.stateRoot, ...(json ? ["--json"] : [])],
    cwd: world.repository, env: world.env, writeOut: line => lines.push(line) });
  assert.deepEqual(snapshot(world.root), before, "doctor changes no path, bytes, modes or mtimes, including Git indexes and the absent database");
  return { code, lines };
}
function modelOf(lines: string[]): DoctorReadout {
  assert.equal(lines.length, 1);
  const model: unknown = JSON.parse(lines[0]!);
  assert.ok(Value.Check(DoctorReadoutSchema, model), "doctor JSON validates against its registered schema");
  return model as DoctorReadout;
}

test("main doctor journey: every AC-5 row in text and JSON; stale branch, unowned tree, dirty baseline and todo landing only warn", async t => {
  const world = await setup(t);
  const json = await diagnose(world, true);
  assert.equal(json.code, 0, "W02-Q6: repository warnings do not stop a run");
  const model = modelOf(json.lines);
  assert.deepEqual(Object.keys(model.rows).sort(), [...ROWS].sort());
  assert.equal(model.healthy, true);
  assert.match(model.rows.branches.detail.join("\n"), /stale.*tip contained by default branch/);
  assert.match(model.rows.worktrees.detail[0]!, /linked worktrees=2; under factory root=2; terminal attempt=0; no attempt=2/);
  assert.match(model.rows.baseline.detail.join("\n"), /foreign=false; dirty=true/);
  assert.match(model.rows.baseline.detail.join("\n"), /older than repository lockfile=true/);
  assert.match(model.rows.markers.detail.join("\n"), /synthetic-plan\/T01=todo/);
  for (const name of ["branches", "worktrees", "baseline", "markers"] as const) assert.equal(model.rows[name].status, "warn");
  const text = await diagnose(world, false);
  assert.equal(text.code, 0);
  for (const name of ROWS.filter(name => name !== "existing")) assert.ok(text.lines.some(line => line.startsWith(`${name}: `)), `text row ${name}`);
  assert.ok(text.lines.some(line => line.startsWith("attempts: ")), "existing rows keep their original text");
  assert.ok(text.lines.some(line => line.startsWith("matrix: ")));
});

test("main doctor journey: a missing disabled adapter is descriptive, but cannot hide a missing enabled CLI", async t => {
  const world = await setup(t);
  unlinkSync(join(world.bin, "agy"));
  const disabled = await diagnose(world, true);
  assert.equal(disabled.code, 0);
  const row = modelOf(disabled.lines).rows.executables;
  assert.equal(row.status, "ok");
  assert.match(row.detail.join("\n"), /adapter antigravity \(disabled\): agy unresolvable/);
  unlinkSync(join(world.bin, "claude"));
  const enabled = await diagnose(world, true);
  assert.equal(enabled.code, 1);
  assert.equal(modelOf(enabled.lines).rows.executables.status, "finding");
});

test("main doctor journey: missing configured CLI, logged-out provider and unavailable quota each exit 1 without writes or provider execution", async t => {
  const world = await setup(t);
  unlinkSync(join(world.bin, "claude"));
  let result = await diagnose(world, true);
  assert.equal(result.code, 1);
  assert.equal(modelOf(result.lines).rows.executables.status, "finding");
  symlinkSync(join(world.bin, "pi"), join(world.bin, "claude"));
  quotaSandbox(world.bin, "derived-state-unauthenticated");
  result = await diagnose(world, true);
  assert.equal(result.code, 1);
  const loggedOut = modelOf(result.lines);
  assert.equal(loggedOut.rows.providers.status, "finding");
  assert.match(loggedOut.rows.providers.detail.join("\n"), /login=logged out/);
  unlinkSync(join(world.bin, "bwrap"));
  result = await diagnose(world, true);
  assert.equal(result.code, 1);
  assert.equal(modelOf(result.lines).rows.quota.status, "finding", "no unsandboxed quota fallback");
});
