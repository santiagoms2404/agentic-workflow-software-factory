import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { lightTicketStore } from "../../../src/cli/commands/ticket-selection.ts";
import { lightTicketAgreement } from "../../../src/registry/plan-agreement.ts";
import { repoRoot } from "./_walk.ts";

test("the registered plans root's flat light store passes the shared vocabulary and dependency-cycle rules", async () => {
  const store = await lightTicketStore(repoRoot());
  // An absent directory loads zero records and agrees with everything, so an empty result alone proves nothing.
  // The store must exist, and every flat ticket file in it must load into the agreement check.
  assert.ok(existsSync(store.directory), `the light ticket store ${store.directory} is missing; a missing store passes vacuously`);
  const records = await store.load();
  const flat = readdirSync(store.directory).filter((name) => /^T\d\d\.md$/.test(name));
  assert.equal(records.length, flat.length, "every flat light ticket file must load into the agreement check");
  const violations = lightTicketAgreement(records);
  assert.deepEqual(violations, [], violations.map(row => row.message).join("\n"));
});
