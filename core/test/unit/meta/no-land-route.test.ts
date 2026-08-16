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

test("the backlog surface is a GET route and no dashboard write path reaches the lifecycle", () => {
  assert.deepEqual(API_ROUTE_TABLE.find((route) => route.path === "/api/v1/tickets"), {
    method: "GET", path: "/api/v1/tickets", name: "tickets",
  });
  const apiFiles = walkFiles(join(repoRoot(), "core", "src", "api"), [".ts"]);
  const offenders = apiFiles
    .map(relRepo)
    .filter((f) => {
      const src = readFileSync(join(repoRoot(), f), "utf8");
      return FORBIDDEN_ROUTES.some((p) => p.test(src));
    });
  assert.deepEqual(offenders, []);
});
