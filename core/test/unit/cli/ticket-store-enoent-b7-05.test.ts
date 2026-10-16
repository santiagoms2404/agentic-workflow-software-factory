import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lightTierListingLabel, main } from "../../../src/cli/main.ts";

// B7-05, owner call O8 (R): a repository with no awsf.project.yaml keeps its
// flat specs/tickets listing, but the listing says it is the light tier, which
// belongs to no plan, instead of passing for a plan's ticket set.

const LIGHT_TICKET = "---\nid: T99\ntitle: Light-tier intake ticket\nmilestone: M1\ntier: 0\nstate: done\ndepends_on: []\n"
  + "workflow: intake\noutcome: Light\ncontext: [Light]\nacceptance: [Light]\nnon_goals: [Light]\n---\nlight-source-only-marker\n";

function catalogless(): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-enoent-"));
  mkdirSync(join(root, "specs", "tickets"), { recursive: true });
  writeFileSync(join(root, "specs", "tickets", "T99.md"), LIGHT_TICKET);
  return root;
}

async function drive(argv: readonly string[], cwd: string): Promise<{ code: number; output: string[]; errors: string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await main({
    argv, cwd,
    writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); },
  });
  return { code, output, errors };
}

test("an ENOENT ticket list is labelled light tier, belonging to no plan", async () => {
  const root = catalogless();
  try {
    const { code, output, errors } = await drive(["ticket", "list"], root);
    assert.equal(code, 0, errors.join("\n"));
    assert.match(output[0] ?? "", /^light tier: .*belongs to no plan/);
    assert.deepEqual(output.slice(1), ["T99\tdone\tT0\tLight-tier intake ticket"]);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the light-tier label names a --plan it could not resolve, and only then", () => {
  assert.doesNotMatch(lightTierListingLabel(undefined), /--plan/);
  assert.match(lightTierListingLabel("W03"), /^light tier: .*belongs to no plan; --plan W03 was not resolved$/);
});

test("ticket show and backlog read without a catalog carry the same label, naming the ignored --plan", async () => {
  const root = catalogless();
  const stateRoot = mkdtempSync(join(tmpdir(), "awsf-ticket-enoent-state-"));
  try {
    const shown = await drive(["ticket", "show", "T99", "--plan", "W03", "--state-root", stateRoot], root);
    assert.equal(shown.code, 0, shown.errors.join("\n"));
    assert.equal(shown.output[0], lightTierListingLabel("W03"));
    assert.match(shown.output[1] ?? "", /^T99\tdone\tT0\tLight-tier intake ticket$/);

    const backlog = await drive(["backlog", "--state-root", stateRoot], root);
    assert.equal(backlog.code, 0, backlog.errors.join("\n"));
    assert.equal(backlog.output[0], lightTierListingLabel(undefined));
    assert.equal(backlog.output[1], "state: todo=0 wip=0 done=1 failed=0");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a repository with awsf.project.yaml lists its plan's set with no light-tier label", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-catalog-"));
  const cwd = process.cwd();
  try {
    // A plan source resolves only from a git checkout (B10-03).
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "specs", "tickets", "alpha"), { recursive: true });
    writeFileSync(join(root, "awsf.project.yaml"), `
version: awsf.project/v1
project:
  slug: labelled
repositories:
  plans:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
`);
    writeFileSync(join(root, "specs", "alpha.html"), "<html></html>");
    writeFileSync(join(root, "specs", "tickets", "alpha", "T01.md"), LIGHT_TICKET.replace("id: T99", "id: T01").replace("Light-tier intake ticket", "Alpha first"));
    process.chdir(root);
    const { code, output, errors } = await drive(["ticket", "list"], root);
    assert.equal(code, 0, errors.join("\n"));
    assert.deepEqual(output, ["T01\tdone\tT0\tAlpha first"]);
    assert.deepEqual(errors, []);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});
