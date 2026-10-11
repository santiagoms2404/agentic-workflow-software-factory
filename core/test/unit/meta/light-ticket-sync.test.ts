import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { lightTicketStore } from "../../../src/cli/commands/ticket-selection.ts";
import { lightTicketAgreement } from "../../../src/registry/plan-agreement.ts";

test("the registered plans root's flat light store passes the shared vocabulary and dependency-cycle rules", async () => {
  const records = await (await lightTicketStore(resolve("."))).load();
  const violations = lightTicketAgreement(records);
  assert.deepEqual(violations, [], violations.map(row => row.message).join("\n"));
});
