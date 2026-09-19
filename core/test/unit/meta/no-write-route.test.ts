import { test } from "node:test";
import assert from "node:assert/strict";
import { API_ROUTE_TABLE } from "../../../src/api/routes.ts";

const EXPECTED = [
  "GET /api/v1/health",
  "GET /api/v1/sessions",
  "GET /api/v1/sessions/:id",
  "GET /api/v1/sessions/:id/phases/:phaseId",
  "GET /api/v1/sessions/:id/events",
  "GET /api/v1/settings",
  "GET /api/v1/adapters",
  "GET /api/v1/tickets",
  "GET /api/v1/groups",
  "POST /api/v1/sessions/:id/archive",
];

test("every API route but the single archive write is a read", () => {
  const actual = API_ROUTE_TABLE.map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(actual, EXPECTED);
  assert.equal(API_ROUTE_TABLE.filter((route) => route.method !== "GET").length, 1);
});

test("the route table contains no lifecycle or configuration mutation surface", () => {
  const serialized = JSON.stringify(API_ROUTE_TABLE);
  for (const forbidden of ["land", "approv", "retry", "cancel", "config-mutation"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
  }
});
