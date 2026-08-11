import { access, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import type { AwsfConfig } from "../../config/schema.ts";
import { createApiRouter, type ApiRouter } from "../../api/routes.ts";
import { sendResponse } from "../../api/responses.ts";
import { SECURITY_HEADERS, validateAuthority } from "../../api/security.ts";
import { ceilingFor } from "../../state/tiers.ts";
import { discoverAttempts, rebuildDatabase, type RebuildReport, type RebuildSource } from "../../observability/rebuild.ts";
import { prepareDatabaseForReadonly } from "../../observability/sqlite.ts";
import { journalFilePath } from "../../persistence/platform-paths.ts";
import { toAttemptStatusProjection } from "./attempt-projection.ts";
import { readAttempt, type AttemptEvent } from "./attempt.ts";

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
      attemptStatus: (record) => toAttemptStatusProjection(
        stateRoot,
        (record.event as AttemptEvent).next,
        record.event as AttemptEvent,
      ),
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
        configSnapshotJson: status.configSnapshotJson,
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

export interface DashOptions {
  readonly cwd: string;
  readonly write: (line: string) => void;
  readonly port?: number;
  /** Defaults to the dashboard workspace beside the installed core package. */
  readonly assetRoot?: string;
  readonly dbPath?: string;
  readonly config?: AwsfConfig;
  /** Test seam; production keeps the server alive until the process exits. */
  readonly onListening?: (server: Server) => void;
}

/** Serve only an already-built dashboard; building belongs to the owner, never this command. */
export async function dashCommand(options: DashOptions): Promise<"not-built" | "serving"> {
  const root = resolve(
    options.assetRoot ?? resolve(import.meta.dirname, "../../../../dashboard/dist"),
  );
  const index = join(root, "index.html");
  if (!await exists(index)) {
    options.write("Dashboard is not built yet. Run the dashboard build first; awsf dash never builds it.");
    return "not-built";
  }
  if (options.dbPath !== undefined && options.config !== undefined) {
    prepareDatabaseForReadonly(options.dbPath);
  }
  const router: ApiRouter | null = options.dbPath !== undefined && options.config !== undefined
    ? createApiRouter({ dbPath: options.dbPath, config: options.config }) : null;
  const contentType = (path: string): string => {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".json")) return "application/json; charset=utf-8";
    return "application/octet-stream";
  };
  const server = createServer(async (request, response) => {
    try {
      validateAuthority(request.headers);
    } catch {
      response.writeHead(400, SECURITY_HEADERS);
      response.end("invalid loopback authority");
      return;
    }
    if (router !== null && request.url?.startsWith("/api/")) {
      sendResponse(response, await router.dispatch({ method: request.method ?? "GET", url: request.url, headers: request.headers }));
      return;
    }
    const target = request.url === undefined ? "/" : new URL(request.url, "http://127.0.0.1").pathname;
    const path = target === "/" ? index : join(root, target.replace(/^\//, ""));
    const fromRoot = relative(root, resolve(path));
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      response.writeHead(404, SECURITY_HEADERS);
      response.end("not found");
      return;
    }
    try {
      const bytes = await (await import("node:fs/promises")).readFile(path);
      response.writeHead(200, { ...SECURITY_HEADERS, "content-type": contentType(path) });
      response.end(bytes);
    } catch {
      response.writeHead(404, SECURITY_HEADERS);
      response.end("not found");
    }
  });
  server.once("close", () => router?.close());
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", done);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  options.write(`Dashboard serving at http://127.0.0.1:${port}/`);
  options.onListening?.(server);
  return "serving";
}
