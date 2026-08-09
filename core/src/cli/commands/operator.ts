import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import type { AwsfConfig } from "../../config/schema.ts";
import { createApiRouter, type ApiRouter } from "../../api/routes.ts";
import { sendResponse } from "../../api/responses.ts";
import { ceilingFor } from "../../state/tiers.ts";
import { discoverAttempts, rebuildDatabase, type RebuildReport, type RebuildSource } from "../../observability/rebuild.ts";
import { journalFilePath } from "../../persistence/platform-paths.ts";
import { readAttempt } from "./attempt.ts";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** Builds T8's source identity from the CLI-owned status projection. */
export async function rebuildCommand(stateRoot: string): Promise<RebuildReport> {
  const dirs = await discoverAttempts(stateRoot);
  const sources: RebuildSource[] = await Promise.all(dirs.map(async (dir): Promise<RebuildSource> => {
    const status = await readAttempt(dir);
    return {
      journalPath: journalFilePath(dir),
      normalize: (record) => ({
        // T8 projects the normalized provider vocabulary. The CLI's own
        // durable events have no provider event equivalent, so retain each
        // record as a host run-started envelope rather than pretending it was
        // provider output; its sequence and journal cursor stay exact.
        kind: "run.started",
        seq: record.source_seq,
        runId: status.sessionId,
        hostAt: record.recorded_at,
        providerAt: null,
        adapter: "host-cli",
        requestedModel: "not-a-provider-event",
      }),
      session: {
        sessionId: status.sessionId,
        projectSlug: status.project,
        taskId: status.taskId,
        attempt: status.attempt,
        workflowId: status.workflow,
        riskTier: status.tier,
        isProtected: false,
        requestText: status.request,
        callCeiling: ceilingFor(status.tier),
        configSnapshotJson: "{}",
        journalPath: journalFilePath(dir),
        startedAt: status.lastActivityAt,
      },
    };
  }));
  return rebuildDatabase({ targetPath: join(stateRoot, "awsf.db"), sources });
}

/** Candidates are deliberately only named. No delete operation exists in this module. */
export async function gcCommand(stateRoot: string): Promise<readonly string[]> {
  const candidates: string[] = [];
  for (const dir of await discoverAttempts(stateRoot)) {
    const status = await readAttempt(dir);
    if (["LANDED", "BLOCKED", "CANCELLED"].includes(status.lifecycleState)) candidates.push(`attempt: ${dir}`);
  }
  try {
    for (const name of await readdir(stateRoot)) {
      if (name.startsWith("awsf.db.superseded-") || name.startsWith("awsf.db.rebuild-")) candidates.push(`projection: ${join(stateRoot, name)}`);
    }
  } catch { /* an absent state root has no candidates */ }
  return Object.freeze(candidates.sort());
}

export interface DashOptions { readonly cwd: string; readonly write: (line: string) => void; readonly port?: number; readonly dbPath?: string; readonly config?: AwsfConfig; }

/** Serve only an already-built dashboard; building belongs to the owner, never this command. */
export async function dashCommand(options: DashOptions): Promise<"not-built" | "serving"> {
  const root = resolve(options.cwd, "dashboard", "dist");
  const index = join(root, "index.html");
  if (!await exists(index)) {
    options.write("Dashboard is not built yet. Run the dashboard build first; awsf dash never builds it.");
    return "not-built";
  }
  const router: ApiRouter | null = options.dbPath !== undefined && options.config !== undefined
    ? createApiRouter({ dbPath: options.dbPath, config: options.config }) : null;
  const server = createServer(async (request, response) => {
    if (router !== null && request.url?.startsWith("/api/")) {
      sendResponse(response, await router.dispatch({ method: request.method ?? "GET", url: request.url, headers: request.headers }));
      return;
    }
    const path = request.url === "/" || request.url === undefined ? index : join(root, request.url.replace(/^\//, ""));
    if (!resolve(path).startsWith(`${root}/`) && resolve(path) !== index) { response.writeHead(404); response.end(); return; }
    try { response.writeHead(200); response.end(await (await import("node:fs/promises")).readFile(path)); }
    catch { response.writeHead(404); response.end("not found"); }
  });
  await new Promise<void>((done) => server.listen(options.port ?? 0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  options.write(`Dashboard serving at http://127.0.0.1:${port}/`);
  return "serving";
}
