import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../../../src/cli/main.ts";

// B7-06, owner call O8 (R): W04 task 20 has landed (the flat v1 set moved into
// specs/tickets/awsf-plan), so a declared default plan whose ticket directory is
// missing is refused by name instead of silently reading the flat light-tier
// store, which belongs to no plan (inv 12).

const ticket = (id: string, title: string): string => `---\nid: ${id}\ntitle: ${title}\nmilestone: M1\ntier: 0\nstate: done\n`
  + "depends_on: []\nworkflow: intake\noutcome: Light\ncontext: [Light]\nacceptance: [Light]\nnon_goals: [Light]\n---\nbody\n";

/** A git checkout whose catalog declares `alpha` as default, with only the flat light-tier T99 on disk. */
function defaultWithoutDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-default-dir-"));
  // A plan source resolves only from a git checkout (B10-03).
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "specs", "tickets"), { recursive: true });
  writeFileSync(join(root, "awsf.project.yaml"), `
version: awsf.project/v1
project:
  slug: default-dir
repositories:
  plans:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`);
  writeFileSync(join(root, "specs", "alpha.html"), "<html></html>");
  writeFileSync(join(root, "specs", "tickets", "T99.md"), ticket("T99", "Light-tier intake ticket"));
  return root;
}

async function drive(argv: readonly string[], cwd: string): Promise<{ code: number; output: string[]; errors: string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    const code = await main({
      argv, cwd,
      writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); },
    });
    return { code, output, errors };
  } finally {
    process.chdir(previous);
  }
}

const REFUSAL = /^DefaultPlanTicketsMissing: default plan "alpha" has no ticket directory at .*specs[/\\]tickets[/\\]alpha/;

test("ticket list refuses a default plan whose ticket directory is missing, rather than listing the flat set", async () => {
  const root = defaultWithoutDirectory();
  try {
    const { code, output, errors } = await drive(["ticket", "list"], root);
    assert.equal(code, 1, `expected a refusal; listed ${JSON.stringify(output)}`);
    assert.deepEqual(output, []);
    assert.match(errors[0] ?? "", REFUSAL);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ticket show, backlog and an explicit --plan naming the default refuse the same way", async () => {
  const root = defaultWithoutDirectory();
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-ticket-default-dir-state-"));
  try {
    for (const argv of [
      ["ticket", "show", "T99", "--state-root", stateRoot],
      ["backlog", "--state-root", stateRoot],
      ["ticket", "list", "--plan", "alpha"],
    ]) {
      const { code, output, errors } = await drive(argv, root);
      assert.equal(code, 1, `${argv.join(" ")} listed ${JSON.stringify(output)}`);
      assert.deepEqual(output, [], argv.join(" "));
      assert.match(errors[0] ?? "", REFUSAL, argv.join(" "));
      assert.match(errors[0] ?? "", /belongs to no plan/, argv.join(" "));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("once the default plan's ticket directory exists, only its own tickets are listed", async () => {
  const root = defaultWithoutDirectory();
  try {
    mkdirSync(join(root, "specs", "tickets", "alpha"));
    writeFileSync(join(root, "specs", "tickets", "alpha", "T01.md"), ticket("T01", "Alpha first"));
    const { code, output, errors } = await drive(["ticket", "list"], root);
    assert.equal(code, 0, errors.join("\n"));
    assert.deepEqual(output, ["T01\tdone\tT0\tAlpha first"]);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
