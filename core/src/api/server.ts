import { createServer, type Server } from "node:http";
import type { AwsfConfig } from "../config/schema.ts";
import { createApiRouter, type ApiRouter } from "./routes.ts";
import { errorResponse, sendResponse } from "./responses.ts";
import { assertLoopbackBind, type LoopbackHost } from "./security.ts";

export interface ApiServerOptions {
  readonly dbPath: string;
  readonly config: AwsfConfig;
  readonly host?: LoopbackHost;
  readonly port?: number;
}

export interface RunningApiServer {
  readonly host: LoopbackHost;
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

export interface ApiServer {
  readonly nodeServer: Server;
  readonly router: ApiRouter;
  start(): Promise<RunningApiServer>;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackBind(host);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("API port must be an integer from 0 through 65535");
  }

  const router = createApiRouter({ dbPath: options.dbPath, config: options.config });
  const nodeServer = createServer((request, response) => {
    void router.dispatch({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
    }).then(
      (result) => sendResponse(response, result),
      () => sendResponse(response, errorResponse(500, "internal-error", "request failed")),
    );
  });

  return {
    nodeServer,
    router,
    async start(): Promise<RunningApiServer> {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          nodeServer.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          nodeServer.off("error", onError);
          resolve();
        };
        nodeServer.once("error", onError);
        nodeServer.once("listening", onListening);
        nodeServer.listen(port, host);
      });
      const address = nodeServer.address();
      if (address === null || typeof address === "string") {
        router.close();
        throw new Error("API server did not expose a TCP address");
      }
      const originHost = host === "::1" ? "[::1]" : host;
      return {
        host,
        port: address.port,
        origin: `http://${originHost}:${address.port}`,
        close: async (): Promise<void> => {
          await new Promise<void>((resolve, reject) => {
            nodeServer.close((error) => error === undefined ? resolve() : reject(error));
          });
          router.close();
        },
      };
    },
  };
}
