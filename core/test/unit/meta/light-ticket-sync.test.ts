import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { lightTicketStore } from "../../../src/cli/commands/ticket-selection.ts";
import { lightTicketAgreement } from "../../../src/registry/plan-agreement.ts";
import { repoRoot } from "./_walk.ts";

function checkLightAgreement(records: Parameters<typeof lightTicketAgreement>[0]): void {
  assert.ok(records.length > 0, "empty light ticket store");
  const violations = lightTicketAgreement(records);
  assert.deepEqual(violations, [], violations.map(row => row.message).join("\n"));
}

test("the registered plans root's flat light store passes the shared vocabulary and dependency-cycle rules", async () => {
  const store = await lightTicketStore(repoRoot());
  // An absent directory loads zero records and agrees with everything, so an empty result alone proves nothing.
  // The store must exist, and every flat ticket file in it must load into the agreement check.
  assert.ok(existsSync(store.directory), `the light ticket store ${store.directory} is missing; a missing store passes vacuously`);
  const records = await store.load();
  const flat = readdirSync(store.directory).filter((name) => /^T\d\d\.md$/.test(name));
  assert.equal(records.length, flat.length, "every flat light ticket file must load into the agreement check");
  checkLightAgreement(records);
});

test("the light store check refuses a planted state and an empty store", async () => {
  const store = await lightTicketStore(repoRoot());
  const [sample] = await store.load();
  assert.ok(sample);
  assert.throws(() => checkLightAgreement([{ ...sample, path: "planted.md", frontmatter: { ...sample.frontmatter as object, state: "planted" } }]), /planted\.md\/state/u);
  assert.throws(() => checkLightAgreement([]), /empty light ticket store/u);
});
