import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lightTierListingLabel, main } from "../../../src/cli/main.ts";

const ticket = (id: string, title: string) => `---
id: ${id}
title: ${title}
milestone: M1
tier: 0
state: todo
depends_on: []
workflow: build
outcome: Outcome
context: [Context]
acceptance: [Acceptance]
non_goals: [Non-goal]
---
${title} body
`;

test("T31 CLI keeps plan and light reads separate, including invalid files and repeat ids", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-cli-t31-")));
  const catalog = join(root, "awsf.project.yaml");
  const flat = join(root, "plans", "tickets");
  const plan = join(flat, "alpha");
  const previous = process.cwd();
  async function drive(...argv: string[]) {
    const output: string[] = [];
    const errors: string[] = [];
    const code = await main({ argv: [...argv, "--state-root", join(root, "state")], cwd: root,
      writeOut: (line) => { output.push(line); }, writeError: (line) => { errors.push(line); } });
    return { code, output, errors };
  }
  async function read(...argv: string[]) {
    const { code, output, errors } = await drive(...argv);
    assert.equal(code, 0, errors.join("\n"));
    assert.deepEqual(errors, []);
    return output;
  }
  try {
    process.chdir(root);
    mkdirSync(join(root, ".git"));
    mkdirSync(plan, { recursive: true });
    writeFileSync(catalog, JSON.stringify({
      version: "awsf.project/v1", project: { slug: "light-test" },
      repositories: { repo: { role: "plan", default_branch: "main" } },
      plans: { root: "plans", format: "awsf-plan-html/v1", default: "alpha" },
    }));
    writeFileSync(join(root, "plans", "alpha.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(plan, "T20.md"), ticket("T20", "Plan twenty"));
    const planList = await read("ticket", "list");
    const planBacklog = await read("backlog");
    assert.deepEqual(planList, ["T20\ttodo\tT0\tPlan twenty"]);
    assert.match(planBacklog.at(-1) ?? "", /^projected cost:/u);

    writeFileSync(join(flat, "T20.md"), ticket("T20", "Light twenty"));
    writeFileSync(join(flat, "T21.md"), ticket("T21", "Light twenty-one"));
    writeFileSync(join(flat, "T22.md"), "no frontmatter\n");
    const label = "light tier: the flat plans/tickets set, which belongs to no plan";
    const count = "light tier: todo=2 wip=0 done=0 failed=0 invalid=1 in plans/tickets, which belongs to no plan; read them with --light";
    const listed = await read("ticket", "list", "--light");
    assert.deepEqual(listed.slice(0, 3), [label, "T20\ttodo\tT0\tLight twenty", "T21\ttodo\tT0\tLight twenty-one"]);
    assert.match(listed[3] ?? "", /T22\.md — invalid: .*missing YAML frontmatter/u);
    const backlog = await read("backlog", "--light");
    assert.equal(backlog[0], label);
    assert.equal(backlog[1], "state: todo=2 wip=0 done=0 failed=0 invalid=1");
    assert.ok(backlog.includes("ready (2): T20, T21"));
    assert.equal(backlog.at(-1), listed[3]);
    assert.deepEqual(await read("ticket", "list"), [...planList, count]);
    assert.deepEqual(await read("backlog"), [...planBacklog, count]);

    assert.deepEqual(await read("ticket", "show", "T20"), [
      planList[0], "Plan twenty body",
      "shown: plan alpha's T20; the light tier also has T20: awsf ticket show T20 --light",
    ]);
    assert.deepEqual(await read("ticket", "show", "--light", "T20"), [
      label, listed[1], "Light twenty body",
      "shown: the light tier's T20; plan alpha also has T20: awsf ticket show T20 --plan alpha",
    ]);
    assert.deepEqual(await read("ticket", "show", "T22", "--light"), [label, listed[3], "no frontmatter"]);

    // A broken catalog would fail either store resolution; the flag conflict comes first.
    writeFileSync(catalog, "version: [unclosed\n");
    for (const argv of [["ticket", "list"], ["ticket", "show", "T20"], ["backlog"]]) {
      const refused = await drive(...argv, "--light", "--plan", "alpha");
      assert.equal(refused.code, 1);
      assert.deepEqual(refused.output, []);
      assert.match(refused.errors[0] ?? "", /--light .*cannot be combined with --plan/u);
    }

    rmSync(catalog);
    const fallback = join(root, "specs", "tickets");
    mkdirSync(fallback, { recursive: true });
    writeFileSync(join(fallback, "T21.md"), ticket("T21", "Catalogless"));
    assert.deepEqual(await read("ticket", "list", "--light"), [lightTierListingLabel(undefined), "T21\ttodo\tT0\tCatalogless"]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
