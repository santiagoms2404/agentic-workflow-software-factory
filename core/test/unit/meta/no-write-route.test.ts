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
  "GET /api/v1/metrics",
  "POST /api/v1/sessions/:id/archive",
];

type Routes = readonly { readonly method: string; readonly path: string; readonly name: string }[];

function checkRouteTable(routes: Routes): void {
  const actual = routes.map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(actual, EXPECTED);
  assert.equal(routes.filter((route) => route.method !== "GET").length, 1);
}

function checkMutationSurface(routes: Routes): void {
  assert.ok(routes.length > 0, "empty route table");
  const serialized = JSON.stringify(routes);
  for (const forbidden of ["land", "approv", "retry", "cancel", "config-mutation"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
  }
}

test("every API route but the single archive write is a read", () => {
  checkRouteTable(API_ROUTE_TABLE);
});

test("the route table contains no lifecycle or configuration mutation surface", () => {
  checkMutationSurface(API_ROUTE_TABLE);
});

test("route checks refuse a second write and a disguised lifecycle route", () => {
  assert.throws(() => checkRouteTable([...API_ROUTE_TABLE, { method: "POST", path: "/api/v1/planted", name: "planted" }]), /POST \/api\/v1\/planted/u);
  assert.throws(() => checkMutationSurface([...API_ROUTE_TABLE, { method: "GET", path: "/api/v1/planted", name: "retryTask" }]), /retry/u);
  assert.throws(() => checkMutationSurface([]), /empty route table/u);
});
