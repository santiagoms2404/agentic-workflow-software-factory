import type { IncomingHttpHeaders } from "node:http";

export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;
export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

export const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export class SecurityError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
  }
}

export function assertLoopbackBind(host: string): asserts host is LoopbackHost {
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) {
    throw new SecurityError("invalid-bind-host", "the API may bind only to a loopback address");
  }
}

function oneHeader(headers: IncomingHttpHeaders, name: "host" | "origin"): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    throw new SecurityError(`invalid-${name}`, `${name} must occur at most once`);
  }
  return value;
}

function loopbackAuthority(authority: string): boolean {
  if (/^127\.0\.0\.1(?::(?:0|[1-9][0-9]{0,4}))?$/.test(authority)) {
    const port = authority.split(":")[1];
    return port === undefined || Number(port) <= 65_535;
  }
  if (/^localhost(?::(?:0|[1-9][0-9]{0,4}))?$/i.test(authority)) {
    const port = authority.split(":")[1];
    return port === undefined || Number(port) <= 65_535;
  }
  const ipv6 = /^\[::1\](?::(?:0|[1-9][0-9]{0,4}))?$/.exec(authority);
  if (ipv6 === null) return false;
  const port = authority.slice("[::1]".length + 1);
  return port.length === 0 || Number(port) <= 65_535;
}

/** DNS-rebinding and browser cross-site guard. No CORS header is ever emitted. */
export function validateAuthority(headers: IncomingHttpHeaders): void {
  const host = oneHeader(headers, "host")?.trim() ?? "";
  if (host.length === 0 || host.includes(",") || !loopbackAuthority(host)) {
    throw new SecurityError("invalid-host", "Host must name this loopback server");
  }

  const origin = oneHeader(headers, "origin");
  if (origin === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new SecurityError("invalid-origin", "Origin is malformed");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.host.toLowerCase() !== host.toLowerCase() ||
    !loopbackAuthority(parsed.host)
  ) {
    throw new SecurityError("invalid-origin", "Origin must exactly match this loopback server");
  }
}

/** Decode once, then refuse anything outside the identifier vocabulary. */
export function decodePathSegments(rawTarget: string): string[] {
  const queryAt = rawTarget.indexOf("?");
  const rawPath = queryAt === -1 ? rawTarget : rawTarget.slice(0, queryAt);
  if (!rawPath.startsWith("/") || rawPath.includes("#")) {
    throw new SecurityError("invalid-path", "request target must be an absolute path");
  }
  const rawSegments = rawPath.split("/").slice(1);
  const segments: string[] = [];
  for (const raw of rawSegments) {
    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      throw new SecurityError("invalid-path-segment", "path segment has invalid percent encoding");
    }
    if (!SAFE_PATH_SEGMENT.test(value) || value === "." || value === "..") {
      throw new SecurityError("invalid-path-segment", "path segment is not a plain identifier");
    }
    segments.push(value);
  }
  return segments;
}
