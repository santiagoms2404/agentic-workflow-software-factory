import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsPass } from "../../../src/gates/commands.ts";
import { validTestOutput } from "../contracts/fixtures.ts";

const SHA = "a".repeat(40);
const configured = { gateId: "test", argv: ["npm", "run", "test:unit"] };

test("commands_pass positive records command, SHA, cleanliness, exit, and tail checks", () => {
  const report = commandsPass(validTestOutput(), configured, { candidateSha: SHA, cleanBefore: true, cleanAfter: true });
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 7);
});

test("commands_pass negative records all checks despite a failing dirty command", () => {
  const output = validTestOutput();
  output.commands[0]!.exitCode = 1;
  const report = commandsPass(output, configured, { candidateSha: SHA, cleanBefore: true, cleanAfter: false });
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 7);
  assert.deepEqual(report.checks.filter((check) => !check.ok).map((check) => check.item), ["exit code zero", "clean after"]);
});
