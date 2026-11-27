import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LightTicketSourceResponse, TicketsResponse } from "../../../../dashboard/shared/types.ts";
import { createApiRouter } from "../../../src/api/routes.ts";
import { apiFixture } from "./_fixture.ts";

const path = "/api/v1/tickets";
const ticket = (id: string, state: string, depends = "") => [
  "---", `id: ${id}`, `title: Ticket ${id}`, "milestone: M1", "tier: 1", `state: ${state}`, `depends_on: [${depends}]`,
  "workflow: build", "outcome: Outcome", "context: [Context]", "acceptance: [Acceptance]", "non_goals: [Non-goal]",
  "---", `Body for ${id} — UTF-8`, "", "",
].join("\r\n");

const request = (url: string, method = "GET") => ({ method, url, headers: { host: "127.0.0.1:4600" } });

test("T31 tickets route projects and reads a separate light store without changing the plan board or files", async () => {
  const fixture = apiFixture();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-api-t31-")));
  const previous = process.cwd();
  const catalog = join(root, "awsf.project.yaml");
  const flat = join(root, "plans", "tickets");
  const plan = join(flat, "alpha");
  let router: ReturnType<typeof createApiRouter> | undefined;
  try {
    process.chdir(root);
    mkdirSync(join(root, ".git"));
    mkdirSync(plan, { recursive: true });
    writeFileSync(catalog, JSON.stringify({
      version: "awsf.project/v1", project: { slug: "test-project" },
      repositories: { repo: { role: "plan", default_branch: "main" } },
      plans: { root: "plans", format: "awsf-plan-html/v1", default: "alpha" },
    }));
    writeFileSync(join(root, "plans", "alpha.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(plan, "T20.md"), ticket("T20", "done").replaceAll("\r\n", "\n"));
    router = createApiRouter({ dbPath: fixture.path, config: fixture.config, repository: root });
    const before = await router.dispatch(request(path));
    assert.equal(before.status, 200);
    const { light: empty, ...planBefore } = before.body as TicketsResponse;
    assert.deepEqual(planBefore.tickets.map(({ uid }) => uid), ["alpha/T20"]);
    assert.deepEqual(empty.tickets, []);
    assert.deepEqual(empty.ready, []);
    assert.deepEqual(empty.invalid, []);
    assert.equal(empty.counts.invalid, 0);

    const source = ticket("T20", "todo");
    const invalid = "no frontmatter\r\n";
    writeFileSync(join(flat, "T20.md"), source);
    writeFileSync(join(flat, "T21.md"), ticket("T21", "todo", "T20"));
    writeFileSync(join(flat, "T22.md"), invalid);
    const filesBefore = readdirSync(root, { recursive: true }).sort();
    const after = await router.dispatch(request(path));
    assert.equal(after.status, 200);
    const { light, ...planAfter } = after.body as TicketsResponse;
    assert.deepEqual(planAfter, planBefore);
    assert.equal(light.label, "light tier · belongs to no plan");
    assert.deepEqual(light.tickets.map(({ uid }) => uid), ["light/T20", "light/T21"]);
    assert.deepEqual(light.ready.map(({ uid }) => uid), ["light/T20"], "alpha's done T20 must not unblock light/T21");
    assert.deepEqual(light.invalid, [{ file: "T22.md", violations: ["/ missing YAML frontmatter"] }]);
    assert.deepEqual(light.counts, {
      state: { todo: 2, wip: 0, done: 0, failed: 0 }, milestone: { M1: 2 }, tier: { T0: 0, T1: 2, T2: 0 }, invalid: 1,
    });
    for (const [id, bytes] of [["T20", source], ["T22", invalid]] as const) {
      const selected = await router.dispatch(request(`${path}?light=${id}`));
      assert.equal(selected.status, 200);
      assert.deepEqual(selected.body, { uid: `light/${id}`, light: true, ticket: id, source: bytes } satisfies LightTicketSourceResponse);
    }
    for (const query of ["light=T2", "light=W20", "light=T20&plan=alpha", "light=T20&ticket=T20"]) {
      assert.equal((await router.dispatch(request(`${path}?${query}`))).status, 400, query);
    }
    assert.equal((await router.dispatch(request(`${path}?light=T99`))).status, 404);
    assert.equal((await router.dispatch(request(`${path}?light=T20`, "POST"))).status, 405);
    assert.deepEqual(readdirSync(root, { recursive: true }).sort(), filesBefore);

    writeFileSync(catalog, "version: [unclosed\n");
    const stale = await router.dispatch(request(path));
    assert.equal(stale.status, 200);
    const staleBoard = stale.body as TicketsResponse;
    assert.equal(staleBoard.stale, true);
    assert.deepEqual(staleBoard.plans, planBefore.plans);
    assert.ok(staleBoard.light.error);
    assert.ok(!staleBoard.light.error.includes(root));
  } finally {
    router?.close();
    fixture.close();
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
