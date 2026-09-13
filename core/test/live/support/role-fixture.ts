import { lstat, mkdir, readdir, readlink, writeFile, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { continuityDigest } from "../../../src/contracts/interrupted-turn.ts";
import { digest } from "./continuation-probe.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import type { DesignContext } from "../../../src/contracts/design-context.ts";
import type { PlanOutput } from "../../../src/contracts/plan-output.ts";
import type { TestOutput } from "../../../src/contracts/test-output.ts";
import { composeReviewEvidence } from "../../../src/workflow/review-evidence.ts";
import { runSystemCommand } from "../../../src/execution/transport-broker.ts";

/** All writes and commits here are in a newly created external fixture, never a factory attempt. */
export async function createRoleFixture(root: string, role: string, challenge: string) {
  const canonical = join(root, "canonical");
  const worktree = join(root, "worktree");
  const stateRoot = join(root, "state");
  const runtime = join(stateRoot, "private");
  for (const path of [canonical, runtime]) await mkdir(path, { recursive: true, mode: 0o700 });
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_AUTHOR_NAME: "Santiago Marin", GIT_AUTHOR_EMAIL: "santiagomarinsuarez@me.com",
    GIT_COMMITTER_NAME: "Santiago Marin", GIT_COMMITTER_EMAIL: "santiagomarinsuarez@me.com" };
  const command = (executable: string, argv: readonly string[], cwd = canonical): string => {
    const result = runSystemCommand(executable, argv, { cwd, env, timeoutMs: 30_000 });
    if (result.status !== 0) throw new Error(`isolated fixture command failed: ${result.stderr}`);
    return result.stdout;
  };
  const git = (args: readonly string[], cwd = canonical) => command("git", args, cwd).trim();
  git(["init", "--quiet", "-b", "main"]);
  for (const directory of ["core/src", "docs", "specs/tickets/fixture"]) await mkdir(join(canonical, directory), { recursive: true });
  await writeFile(join(canonical, "README.md"), "# Continuity fixture\nInspect fixture-challenge.txt. The source marker is documented in docs/proof.md.\n");
  await writeFile(join(canonical, "fixture-challenge.txt"), `${challenge}\n`);
  await writeFile(join(canonical, "core/src/proof.ts"), 'export const proof = "pending";\n');
  await writeFile(join(canonical, "docs/proof.md"), "# Proof marker\nThe source marker is pending.\n");
  const commit = (message: string, cwd = canonical): string => {
    git(["add", "."], cwd);
    git(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message], cwd);
    return git(["rev-parse", "HEAD"], cwd);
  };
  const baseSha = commit("test: seed isolated role continuity fixture");
  git(["worktree", "add", "--detach", worktree, baseSha]);
  let request = "Inspect fixture-challenge.txt and core/src/proof.ts. Plan the single bounded change replacing pending with the exact challenge. Do not implement or commit.";
  if (role === "builder") request = "Read fixture-challenge.txt. Change only core/src/proof.ts so proof equals the exact challenge. Do not commit. Return the normal build envelope.";
  if (role === "documenter") request = "Read fixture-challenge.txt and core/src/proof.ts. Update only docs/proof.md to document the exact implemented marker. Return the normal document envelope and run report. Do not commit.";
  if (role === "scout") request = "Read fixture-challenge.txt and core/src/proof.ts. Report where the pending marker is implemented and the smallest safe replacement. Write nothing.";
  if (role === "intake") request = "Read fixture-challenge.txt and core/src/proof.ts. Create exactly one ticket at specs/tickets/fixture/T01.md for replacing pending with the challenge. Do not implement source or commit.";
  if (role === "designer" || role === "architecture-reviewer") request = "Design the single bounded replacement of pending in core/src/proof.ts with the exact challenge in fixture-challenge.txt. Preserve all other behavior and write nothing.";
  const plan: PlanOutput = { schema: "awsf.plan-output/v1", producerStatus: "success", summary: request,
    artifacts: [], notesForNextPhase: "Use the normal role contract. This is a disposable fixture, with no workflow or landing authority.",
    goals: [request], nonGoals: ["No commits, new dependencies, extra files or changes outside the stated target"],
    implementationSteps: [{ id: "S1", title: "Replace the one marker", files: ["core/src/proof.ts"], acceptanceCriteria: ["The marker equals the exact challenge"] }],
    testStrategy: ["Compare the marker against fixture-challenge.txt"], risks: [], openQuestions: [] };
  const designContext: DesignContext = { schema: "awsf.design-context/v1", producerStatus: "success", summary: request,
    artifacts: [], notesForNextPhase: "Inspect the pinned fixture repository; write nothing.",
    targets: [{ repositoryId: "fixture", path: worktree, defaultBranch: "main", headSha: baseSha }] };
  let previous: EnvelopeBase = plan;
  let workflow = role === "scout" ? "scout" : role === "intake" ? "intake" : role === "designer" || role === "architecture-reviewer" ? "design-to-plan" : "simple-sdlc";
  if (role === "designer") previous = designContext;
  if (role === "architecture-reviewer") previous = {
    schema: "awsf.design-output/v1", producerStatus: "success", summary: request, artifacts: [], notesForNextPhase: "Audit this fixture design without implementing it.",
    answeredRequest: request, components: [{ name: "marker", responsibility: "Export the exact challenge" }],
    decisions: [{ id: "D-1", statement: "Change the one source constant" }],
    invariants: [{ id: "INV-1", statement: "No other behavior changes" }],
    acceptanceCriteria: [{ id: "AC-1", statement: "The constant equals the challenge", verifiedBy: "Compare core/src/proof.ts to fixture-challenge.txt" }], openQuestions: [],
  } as EnvelopeBase;
  if (role === "reviewer" || role === "documenter") {
    await writeFile(join(worktree, "core/src/proof.ts"), `export const proof = ${JSON.stringify(challenge)};\n`);
    const candidateSha = commit("test: prepare isolated role candidate", worktree);
    const argv = ["-e", "const f=require('node:fs');const c=f.readFileSync('fixture-challenge.txt','utf8').trim();if(!f.readFileSync('core/src/proof.ts','utf8').includes(JSON.stringify(c)))process.exit(1)"];
    const started = Date.now();
    const output = command(process.execPath, argv, worktree);
    const tests: TestOutput = { schema: "awsf.test-output/v1", producerStatus: "success", summary: "Fixture marker check passed", artifacts: [], notesForNextPhase: request,
      passed: true, candidateSha, commands: [{ gateId: "test", argv: [process.execPath, ...argv], exitCode: 0,
        durationMs: Date.now() - started, outputRef: "private/fixture-check.txt" }], failures: [], outputTail: output };
    await writeFile(join(runtime, "fixture-check.txt"), output, { mode: 0o600 });
    previous = tests;
    if (role === "reviewer") {
      request = "Review the exact one-line replacement of pending with the fixture challenge. Read the changed source and challenge. Do not modify any file.";
      const composed = await composeReviewEvidence({ worktree, baseSha, candidateSha,
        intent: { request, goals: ["Only the marker changed"], nonGoals: ["Additional behavior or writes"], acceptanceCriteria: ["Marker equals the exact challenge"], testStrategy: ["Host marker check"] },
        testOutput: tests, diffRef: "private/full.diff", retainFullDiff: async (_path, text) => {
          const path = join(runtime, "full.diff"); await writeFile(path, text, { mode: 0o600 }); return readFile(path, "utf8");
        } });
      previous = composed.context;
      workflow = "build-review";
    }
  }
  const gitControlPaths = ["index", "HEAD"].map(name => {
    const path = git(["rev-parse", "--path-format=absolute", "--git-path", name], worktree);
    if (relative(canonical, path).startsWith("..") || !path.startsWith(`${resolve(canonical)}/`)) throw new Error("fixture Git control path escaped canonical repository");
    return path;
  });
  return { canonical, worktree, stateRoot, runtime, env, previous, designContext, request, workflow, baseSha, gitControlPaths };
}

/** Observe the complete fixture worktree and pinned index/HEAD without following agent-written symlinks. */
export async function snapshotRoleFixture(worktree: string, gitControlPaths: readonly string[]): Promise<string> {
  const rows: unknown[] = [];
  let totalBytes = 0;
  const visit = async (path: string, label: string): Promise<void> => {
    const info = await lstat(path);
    const metadata = { path: label, mode: info.mode, uid: info.uid, gid: info.gid, links: info.nlink };
    if (info.isSymbolicLink()) rows.push({ ...metadata, symlink: await readlink(path) });
    else if (info.isDirectory()) {
      rows.push({ ...metadata, directory: true });
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), `${label}/${name}`);
    } else if (info.isFile()) {
      totalBytes += info.size;
      if (totalBytes > 16 * 1024 * 1024) throw new Error("fixture snapshot size limit exceeded");
      rows.push({ ...metadata, digest: digest(await readFile(path)) });
    } else throw new Error("fixture contains an unsupported filesystem node");
  };
  await visit(worktree, "worktree");
  for (const [index, path] of gitControlPaths.entries()) await visit(path, `git-control/${index}`);
  return continuityDigest(rows);
}
