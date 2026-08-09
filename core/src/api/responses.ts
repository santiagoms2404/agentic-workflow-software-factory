import type { ServerResponse } from "node:http";
import type { ApiError } from "../../../dashboard/shared/types.ts";
import { scrubCredentials } from "../policy/redaction.ts";
import { SECURITY_HEADERS } from "./security.ts";

export interface ApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function privateResponseKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  if ([
    "hostcontinuityref",
    "continuityref",
    "journalpath",
    "filepath",
    "outputpath",
    "providerlog",
    "providerlogs",
  ].includes(normalized)) return true;
  return /^raw(?:provider)?(?:log|logs|output|outputpath|stream)$/.test(normalized);
}

/** Removes reference-shaped fields, then applies the repository credential scrubber. */
export function publicApiValue<T>(value: T): T {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== "object") return node;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (!privateResponseKey(key)) output[key] = visit(child);
    }
    return output;
  };
  return scrubCredentials(visit(value)) as T;
}

export function jsonResponse(body: unknown, status = 200): ApiResponse {
  return {
    status,
    headers: Object.freeze({
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
    }),
    body: publicApiValue(body),
  };
}

export function errorResponse(status: number, code: string, message: string): ApiResponse {
  return jsonResponse({ error: message, code } satisfies ApiError, status);
}

export function sendResponse(response: ServerResponse, apiResponse: ApiResponse): void {
  const encoded = JSON.stringify(apiResponse.body);
  response.writeHead(apiResponse.status, {
    ...apiResponse.headers,
    "content-length": Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: import("node:http").IncomingHttpHeaders;
}

export type ApiHandler = (request: HandlerRequest, params: Readonly<Record<string, string>>) => ApiResponse | Promise<ApiResponse>;

/** Every route handler crosses this boundary; thrown input and driver errors become JSON. */
export function safely(handler: ApiHandler): ApiHandler {
  return async (request, params) => {
    try {
      return await handler(request, params);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        return errorResponse(error.status, error.code, error.message);
      }
      const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
      if (typeof candidate.status === "number" && typeof candidate.code === "string") {
        return errorResponse(
          candidate.status,
          candidate.code,
          typeof candidate.message === "string" ? candidate.message : "request rejected",
        );
      }
      return errorResponse(500, "internal-error", "request failed");
    }
  };
}
