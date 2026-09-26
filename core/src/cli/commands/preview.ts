// `awsf preview <task>`: show the owner the candidate at the owner gate, in
// the form its repository's delivery posture declares (W17 M5 task 15).
//
// Gates never render a page, so a stale asset bundle once made a correct
// landing read as a total regression. This step therefore builds the candidate
// itself, immediately before showing it, and refuses to serve any file its own
// build did not write. A bundle that was already there is refused, never shown
// with a caveat. What it built and when is recorded beside the attempt so the
// shift readout can print it without building or serving anything itself.
//
// Exactly one preview server is alive per state root. A second start is
// refused and told where the live one is; nothing here stops another process.
//
// No clock is read here (W17 INV-1): the build time is the caller's `now`. The
// build runs through the transport broker's command boundary, exactly as a gate
// command does, and nothing here adds a route, a push, or a skill.
import { createServer, type Server } from "node:http";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { SECURITY_HEADERS, validateAuthority } from "../../api/security.ts";
import {
  PREVIEW_RECORD_SCHEMA, PreviewRecordSchema, planPreview, type PreviewPlan, type PreviewRecord,
} from "../../contracts/preview-record.ts";
import { runSystemCommand, type SystemCommandOptions } from "../../execution/transport-broker.ts";
import type { CommandResult } from "../../execution/process-controller.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import { readAttempt, type AttemptStatus } from "./attempt.ts";

const PREVIEW_RECORD_FILE = "preview.json";
const PREVIEW_SERVER_FILE = "preview-server.json";

/** Every refusal the preview step makes before it shows anything. */
export class PreviewRefused extends Error {
  constructor(detail: string) {
    super(`preview refused: ${detail}`);
    this.name = "PreviewRefused";
  }
}

/** The build exited 0 and the bundle still holds files it did not write. */
export class PreviewBundleStale extends Error {
  readonly bundle: string;
  readonly staleFiles: readonly string[];
  constructor(bundle: string, staleFiles: readonly string[], total: number) {
    super(
      `preview refused: the bundle at ${bundle} is stale — ${String(staleFiles.length)} of ${String(total)} file(s) ` +
        `predate this build (first: ${staleFiles[0] ?? ""}); a preview is built fresh or not shown`,
    );
    this.name = "PreviewBundleStale";
    this.bundle = bundle;
    this.staleFiles = Object.freeze([...staleFiles]);
  }
}

/** The build exited 0 and wrote nothing where the catalog says it writes. */
export class PreviewBundleMissing extends Error {
  constructor(bundle: string) {
    super(`preview refused: the build exited 0 and wrote no file at ${bundle}`);
    this.name = "PreviewBundleMissing";
  }
}

export type PreviewCommandRunner = (executable: string, argv: readonly string[], options: SystemCommandOptions) => CommandResult;

export interface PreviewCommandOptions {
  readonly attemptDir: string;
  readonly stateRoot: string;
  readonly write: (line: string) => void;
  /** The caller's clock. The preview records when it built; it never reads a clock itself. */
  readonly now: () => string;
  readonly port?: number;
  readonly runCommand?: PreviewCommandRunner;
}

export interface PreviewCommandResult {
  readonly record: PreviewRecord;
  /** Present only for the `serve` form; stays alive until closed. */
  readonly server: Server | null;
  close(): Promise<void>;
}

interface ServerLease {
  readonly schema: "awsf.preview-server/v1";
  readonly pid: number;
  readonly state: "building" | "serving" | "released";
  readonly url: string | null;
  readonly task: string;
  readonly candidateSha: string;
}

/** Whether a process id is alive. EPERM means it exists but belongs to someone else. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLease(stateRoot: string): Promise<ServerLease | null> {
  try {
    return JSON.parse(await readFile(join(stateRoot, PREVIEW_SERVER_FILE), "utf8")) as ServerLease;
  } catch {
    return null;
  }
}

async function writeLease(stateRoot: string, lease: ServerLease): Promise<void> {
  await writeFile(join(stateRoot, PREVIEW_SERVER_FILE), `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600 });
}

/** The live preview server, if one is: a released lease or a dead process is not one. */
export async function livePreviewServer(stateRoot: string): Promise<ServerLease | null> {
  const lease = await readLease(stateRoot);
  if (lease === null || lease.state === "released" || !processAlive(lease.pid)) return null;
  return lease;
}

/** The record the last preview of this attempt wrote, or null when there is none it can trust. */
export async function readPreviewRecord(attemptDir: string): Promise<PreviewRecord | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(attemptDir, PREVIEW_RECORD_FILE), "utf8"));
  } catch {
    return null;
  }
  return Value.Check(PreviewRecordSchema, parsed) ? parsed : null;
}

async function deliveryOf(status: AttemptStatus): Promise<{ id: string; repository: ReturnType<typeof loadCatalog>["repositories"][string] }> {
  let catalog;
  try {
    catalog = loadCatalog(await readFile(join(status.repository, "awsf.project.yaml"), "utf8"));
  } catch (error) {
    throw new PreviewRefused(`the project catalog cannot be read, so the delivery posture is unknown: ${error instanceof Error ? error.message : String(error)}`);
  }
  // An attempt's worktree is always the plan repository's: the catalog has exactly one.
  const [id, repository] = Object.entries(catalog.repositories).find(([, entry]) => entry.role === "plan")!;
  return { id, repository };
}

/** Every file under a directory, repository-relative to it, with the time its bytes were last written. */
async function bundleFiles(root: string, prefix = ""): Promise<{ path: string; mtimeMs: number }[]> {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await bundleFiles(root, path));
    else files.push({ path, mtimeMs: (await lstat(join(root, path))).mtimeMs });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  svg: "image/svg+xml", json: "application/json; charset=utf-8", png: "image/png", woff2: "font/woff2",
};

/** Serves only the files this build wrote. Anything else, fresh or not, is a 404. */
async function serveBundle(root: string, fresh: ReadonlySet<string>, port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      validateAuthority(request.headers);
    } catch {
      response.writeHead(400, SECURITY_HEADERS);
      response.end("invalid loopback authority");
      return;
    }
    // A malformed path or a file removed since the build is a 404, never a
    // rejection that would take the one preview server down with it.
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname.replace(/^\/+/u, "");
      const path = pathname === "" ? "index.html" : decodeURIComponent(pathname);
      if (!fresh.has(path)) throw new Error("not built by this preview");
      const bytes = await readFile(join(root, path));
      const extension = path.slice(path.lastIndexOf(".") + 1);
      response.writeHead(200, { ...SECURITY_HEADERS, "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream" });
      response.end(bytes);
    } catch {
      response.writeHead(404, SECURITY_HEADERS);
      response.end("not found");
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  return server;
}

function diffReadout(worktree: string, base: string, candidate: string): string[] {
  const stat = runGit(systemGitRunner(worktree), ["diff", "--stat", base, candidate]).trimEnd();
  return stat.length === 0 ? ["  (no changes)"] : stat.split("\n").map((line) => `  ${line.trim()}`);
}

async function build(
  status: AttemptStatus & { worktree: string; candidateSha: string },
  plan: PreviewPlan,
  repository: Awaited<ReturnType<typeof deliveryOf>>,
  options: PreviewCommandOptions,
): Promise<{ bundle: string; root: string; argv: readonly string[]; fresh: ReadonlySet<string> }> {
  const declared = repository.repository.preview;
  if (declared?.build === undefined || declared.bundle === undefined) {
    throw new PreviewRefused(
      `repository ${JSON.stringify(repository.id)} delivers a ${plan.posture} but declares no preview build and bundle in awsf.project.yaml`,
    );
  }
  const git = systemGitRunner(status.worktree);
  const head = runGit(git, ["rev-parse", "HEAD"]).trim();
  if (head !== status.candidateSha) {
    throw new PreviewRefused(`the managed worktree is at ${head}, not the candidate ${status.candidateSha}; the preview would show another tree`);
  }
  if (runGit(git, ["status", "--porcelain"]).trim().length > 0) {
    throw new PreviewRefused("the managed worktree has uncommitted changes, so a build of it is not a build of the candidate");
  }
  const root = join(status.worktree, declared.bundle);
  const before = await bundleFiles(root);
  const newest = before.length === 0 ? null : Math.max(...before.map((file) => file.mtimeMs));
  const [executable, ...argv] = declared.build.argv;
  options.write(`Building ${status.candidateSha} fresh: ${declared.build.argv.join(" ")}`);
  const result = (options.runCommand ?? runSystemCommand)(executable!, argv, {
    timeoutMs: declared.build.timeout_seconds * 1_000,
    cwd: status.worktree,
  });
  if (result.error !== null || result.status !== 0) {
    const tail = `${result.stderr}${result.stdout}`.trim().split("\n").slice(-5).join(" | ");
    throw new PreviewRefused(`the build exited ${String(result.status)}${result.error === null ? "" : ` (${result.error})`}: ${tail}`);
  }
  const after = await bundleFiles(root);
  if (after.length === 0) throw new PreviewBundleMissing(declared.bundle);
  // Every served file must be one this build wrote: any file no newer than the
  // newest file present before the build ran was left there, not built.
  const stale = newest === null ? [] : after.filter((file) => file.mtimeMs <= newest).map((file) => file.path);
  if (stale.length > 0) throw new PreviewBundleStale(declared.bundle, stale, after.length);
  return { bundle: declared.bundle, root, argv: declared.build.argv, fresh: new Set(after.map((file) => file.path)) };
}

export async function previewCommand(options: PreviewCommandOptions): Promise<PreviewCommandResult> {
  const status = await readAttempt(options.attemptDir);
  if (status.lifecycleState !== "AWAITING_OWNER") {
    throw new PreviewRefused(`a preview shows a candidate at the owner gate, and this attempt is ${status.lifecycleState}`);
  }
  if (status.candidateSha === null || status.baseSha === null || status.worktree === null) {
    throw new PreviewRefused("this attempt has no candidate worktree to show");
  }
  const candidate = { ...status, worktree: status.worktree, candidateSha: status.candidateSha };
  const repository = await deliveryOf(status);
  const changed = runGit(systemGitRunner(status.worktree), ["diff", "--name-only", "-z", status.baseSha, status.candidateSha])
    .split("\0").filter((path) => path.length > 0);
  const plan = planPreview(repository.id, repository.repository.delivery, repository.repository.preview, changed);

  options.write(`Preview of ${status.taskId} at ${status.candidateSha}: delivery ${plan.posture} — ${plan.form}`);
  options.write(`  ${plan.reason}`);
  options.write(`Diff ${status.baseSha.slice(0, 7)}..${status.candidateSha.slice(0, 7)}:`);
  for (const line of diffReadout(status.worktree, status.baseSha, status.candidateSha)) options.write(line);

  const base = {
    schema: PREVIEW_RECORD_SCHEMA, posture: plan.posture, form: plan.form, visual: plan.visual, reason: plan.reason,
    baseSha: status.baseSha, candidateSha: status.candidateSha, changedPaths: changed.length, visualPaths: [...plan.visualPaths],
  };
  const record = async (value: PreviewRecord): Promise<PreviewRecord> => {
    await writeFile(join(options.attemptDir, PREVIEW_RECORD_FILE), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return value;
  };

  if (plan.form !== "serve") {
    if (plan.form === "named-not-built") {
      options.write("Named, not built: exercise this candidate where it runs; `awsf journey` records what you observed.");
    }
    const written = await record({ ...base, recordedAt: options.now(), build: null, server: null });
    return { record: written, server: null, close: async () => {} };
  }

  const live = await livePreviewServer(options.stateRoot);
  if (live !== null) {
    throw new PreviewRefused(
      `a preview server is already alive (pid ${String(live.pid)}, ${live.url ?? "still building"}, ${live.task} at ${live.candidateSha}); ` +
        "exactly one runs at a time — stop it before starting another",
    );
  }
  const lease = { schema: "awsf.preview-server/v1", pid: process.pid, task: status.taskId, candidateSha: status.candidateSha } as const;
  await writeLease(options.stateRoot, { ...lease, state: "building", url: null });
  let server: Server;
  let built: Awaited<ReturnType<typeof build>>;
  try {
    built = await build(candidate, plan, repository, options);
    server = await serveBundle(built.root, built.fresh, options.port ?? 0);
  } catch (error) {
    await writeLease(options.stateRoot, { ...lease, state: "released", url: null });
    throw error;
  }
  const builtAt = options.now();
  const address = server.address();
  const url = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : options.port)}/`;
  await writeLease(options.stateRoot, { ...lease, state: "serving", url });
  const written = await record({
    ...base, recordedAt: builtAt,
    build: { argv: [...built.argv], bundle: built.bundle, files: built.fresh.size },
    server: { url, pid: process.pid },
  });
  options.write(`Built fresh at ${builtAt}: ${String(built.fresh.size)} file(s) in ${built.bundle}, every one written by this build.`);
  options.write(`Preview serving at ${url} — the only preview server; stop it with Ctrl-C.`);
  return {
    record: written,
    server,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await writeLease(options.stateRoot, { ...lease, state: "released", url });
      // What was built stays recorded; where it was served no longer holds.
      await record({ ...written, server: null });
    },
  };
}
