import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTE_TABLE } from "../../../src/api/routes.ts";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const FORBIDDEN_ROUTES = [
  /\bland\b/i,
  /\bapprove\b/i,
  /\bretry\b/i,
  /\bcancel\b/i,
  /config[-_]?mutation/i,
];

/** Remove TypeScript comments while preserving strings, where route paths remain observable. */
function withoutComments(source: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") { output += character; lineComment = false; }
      else output += " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") { output += "  "; index += 1; blockComment = false; }
      else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (quote !== null) {
      output += character;
      if (character === "\\") { output += source[++index] ?? ""; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") { output += "  "; index += 1; lineComment = true; continue; }
    if (character === "/" && next === "*") { output += "  "; index += 1; blockComment = true; continue; }
    if (character === "'" || character === '"' || character === "`") quote = character;
    output += character;
  }
  return output;
}

function hasForbiddenRoute(source: string): boolean {
  return FORBIDDEN_ROUTES.some((pattern) => pattern.test(withoutComments(source)));
}

test("route checks ignore comments but retain actionable route text", () => {
  assert.equal(hasForbiddenRoute('// retry is mentioned only in an explanatory comment'), false);
  assert.equal(hasForbiddenRoute('const route = "/api/v1/retry";'), true);
});

test("the backlog surface is a GET route and no dashboard write path reaches the lifecycle", () => {
  assert.deepEqual(API_ROUTE_TABLE.find((route) => route.path === "/api/v1/tickets"), {
    method: "GET", path: "/api/v1/tickets", name: "tickets",
  });
  assert.deepEqual(API_ROUTE_TABLE.filter((route) => route.method !== "GET"), [
    { method: "POST", path: "/api/v1/sessions/:id/archive", name: "archive" },
  ], "the archive operation remains the only dashboard write route");
  assert.deepEqual(API_ROUTE_TABLE.filter((route) => hasForbiddenRoute(`${route.method} ${route.path} ${route.name}`)), []);
  const apiFiles = walkFiles(join(repoRoot(), "core", "src", "api"), [".ts"]);
  const offenders = apiFiles
    .map(relRepo)
    .filter((f) => hasForbiddenRoute(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});
