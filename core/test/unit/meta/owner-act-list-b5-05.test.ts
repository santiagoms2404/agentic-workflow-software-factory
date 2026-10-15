import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ownerActViolation } from "../../../../docs/driving/marimba/marimba-guard-rules.mts";
import { OWNER_ACT_LIST, ownerActName } from "../../../../docs/driving/marimba/owner-acts.mts";
import { OWNER_ACT_LIST_ROWS } from "./_owner-act-spellings.ts";
import { repoRoot } from "./_walk.ts";

// B5-05 B5-45 B9-07 B9-08: three owner acts build their owner terminal outside a
// `case` arm of cli/main.ts, so a list derived from the arms never named them
// and neither guard denied them. The list is now data (owner-acts.mts); the
// call-site sweep that holds it to the code is boundary-claims.test.ts half 2.
// X-01: their `npm run awsf [--silent] -- <act>` spellings were open with them.

const ROOT = repoRoot();
const SHELL_GUARD = join(ROOT, "docs", "driving", "marimba", "delegation-guard.sh");
const OUTSIDE_ARM = OWNER_ACT_LIST.filter((entry) => entry.reach !== "case-arm");

/** The shell guard's answer to one Bash command: exit 2 denies, 0 allows. */
function shellGuard(command: string): { code: number | null; stderr: string } {
  const result = spawnSync(SHELL_GUARD, [], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  });
  return { code: result.status, stderr: result.stderr };
}

test("seed, group apply and retry --adopt-as are guarded", () => {
  assert.equal(ownerActViolation("awsf seed T02 --from T01 --source-attempt 1"), "seed");
  assert.equal(ownerActViolation("awsf group apply --id e1 --expected 3 --proposal p1"), "group apply");
  assert.equal(ownerActViolation("awsf retry T01 --adopt-as T02 --request again"), "retry --adopt-as");
});

test("the three are listed by where main.ts builds their terminal, and the arm acts are unchanged", () => {
  assert.deepEqual(OUTSIDE_ARM.map((entry) => [ownerActName(entry), entry.reach]), [
    ["seed", "if-block"], ["group apply", "module"], ["retry --adopt-as", "helper"],
  ]);
  assert.equal(OWNER_ACT_LIST.filter((entry) => entry.reach === "case-arm").length, 14);
  assert.equal(new Set(OWNER_ACT_LIST.map(ownerActName)).size, OWNER_ACT_LIST.length, "an act is listed once");
});

test("the call sites B9-07 and B9-08 name still build the terminal where the list says", () => {
  const main = readFileSync(join(ROOT, "core", "src", "cli", "main.ts"), "utf8");
  const seedBlock = main.slice(main.indexOf('if (command === "seed")'), main.indexOf('if (command === "new")'));
  assert.ok(seedBlock.includes("processOwnerTerminal()"), "seed builds its terminal inside its command block");
  assert.match(main, /function adoptionTerminal\([^)]*\)[^{]*\{\s*return provided \?\? processOwnerTerminal\(\);/u);
  const retryArm = main.slice(main.indexOf('case "retry":'));
  assert.ok(retryArm.indexOf('flags["adopt-as"]') < retryArm.indexOf("adoptionTerminal("),
    "retry reaches the adoption terminal only under --adopt-as");
  const group = readFileSync(join(ROOT, "core", "src", "cli", "commands", "group.ts"), "utf8");
  assert.match(group, /await apply\([^\n]*processOwnerTerminal\(\)\)/u, "group apply builds its terminal in the group module");
});

test("every listed act, in every decided spelling, is denied by the shared rules", () => {
  assert.equal(OWNER_ACT_LIST_ROWS.length, OWNER_ACT_LIST.length * 7);
  for (const row of OWNER_ACT_LIST_ROWS) assert.equal(ownerActViolation(row.command), row.expected, row.label);
});

test("X-01: the npm run awsf [--silent] -- <act> spellings are caught for every listed act", () => {
  for (const entry of OWNER_ACT_LIST) {
    const args = `${entry.verb} T01${entry.flag === undefined ? "" : ` ${entry.flag} T02`}`;
    for (const npm of ["npm run awsf --", "npm run awsf --silent --"]) {
      assert.equal(ownerActViolation(`${npm} ${args}`), ownerActName(entry), `${npm} ${args}`);
    }
  }
  // The flag is read as a word wherever it sits, `=` form included.
  assert.equal(ownerActViolation("npm run awsf --silent -- retry --adopt-as=T02 T01"), "retry --adopt-as");
  // Targeted, not blanket: the same verbs without the owner path stay open.
  for (const open of ["npm run awsf -- retry T01 --group g1", "npm run awsf --silent -- group checklist", "awsf retry T01"]) {
    assert.equal(ownerActViolation(open), null, open);
  }
});

test("the shell guard denies the outside-arm acts in every spelling and still admits plain retry", () => {
  const rows = OWNER_ACT_LIST_ROWS.filter((row) => row.reach !== "case-arm");
  assert.equal(rows.length, OUTSIDE_ARM.length * 7);
  for (const row of rows) {
    const result = shellGuard(row.command);
    assert.equal(result.code, 2, `${row.label}: ${result.stderr}`);
    assert.ok(result.stderr.includes(row.act), `${row.label}: the denial must name the act`);
  }
  for (const open of ["npm run awsf -- retry T01 --group g1", "awsf retry T01", "npm run awsf --silent -- group checklist"]) {
    assert.equal(shellGuard(open).code, 0, open);
  }
});
