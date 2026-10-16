import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter, resolveTicketPlanSources } from "../../../src/api/routes.ts";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import type { ApiError, SessionsResponse, TicketsResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

// B2-02, B2-03, B2-04, B2-17 (owner decision O4): a plan catalog that does not
// resolve was served as an empty board with HTTP 200, or as the last good set
// with no word that it was stale. Inv 12 makes an unresolvable plan a hard
// failure, so the plan reads now name it: a refusal coded `PlanUnresolved` when
// no catalog has resolved yet, and `stale: true` plus the error beside any
// last good set.

const headers = { host: "127.0.0.1:4600" };

function request(url: string) {
  return { method: "GET", url, headers };
}

const CATALOG = JSON.stringify({
  version: "awsf.project/v1",
  project: { slug: "test-project" },
  repositories: { repo: { role: "plan", default_branch: "main" } },
  plans: { root: "specs", format: "awsf-plan-html/v1", default: "fixture" },
});

const TICKET = "---\nid: T01\ntitle: First\nmilestone: M1\ntier: 0\nstate: todo\ndepends_on: []\nworkflow: build\noutcome: First\ncontext: [First]\nacceptance: [First]\nnon_goals: [First]\n---\nbody\n";

interface Checkout {
  readonly root: string;
  readonly catalogPath: string;
}

/**
 * A git checkout in the temp directory, entered for the test's length: plan
 * sources self-place against the working directory's checkout.
 */
async function withCheckout(
  layout: { readonly catalog: boolean; readonly plansRoot: boolean },
  run: (checkout: Checkout) => Promise<void>,
): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-plan-unresolved-")));
  const catalogPath = join(root, "awsf.project.yaml");
  mkdirSync(join(root, ".git"));
  if (layout.catalog) writeFileSync(catalogPath, CATALOG);
  if (layout.plansRoot) {
    mkdirSync(join(root, "specs", "tickets", "fixture"), { recursive: true });
    writeFileSync(join(root, "specs", "fixture.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(root, "specs", "tickets", "fixture", "T01.md"), TICKET);
  } else {
    // The flat light-tier store `awsf backlog` falls back to; the board never reads it.
    mkdirSync(join(root, "specs-flat", "tickets"), { recursive: true });
    writeFileSync(join(root, "specs-flat", "tickets", "T01.md"), TICKET);
  }
  const previous = process.cwd();
  process.chdir(root);
  try {
    await run({ root, catalogPath });
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

function routerFor(root: string) {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, repository: root });
  return { router, close(): void { router.close(); fixture.close(); } };
}

test("B2-17: a catalog that stops parsing serves the last good board only as stale, naming the parse error", async () => {
  await withCheckout({ catalog: true, plansRoot: true }, async ({ root, catalogPath }) => {
    const { router, close } = routerFor(root);
    try {
      const fresh = await router.dispatch(request("/api/v1/tickets"));
      assert.equal(fresh.status, 200);
      const good = fresh.body as TicketsResponse;
      assert.deepEqual(good.tickets.map((ticket) => ticket.uid), ["fixture/T01"]);
      assert.equal(good.stale, undefined, "a catalog that resolves is not stale");
      assert.equal(good.planError, undefined);

      const broken = "version: [unclosed\n";
      let parseMessage = "";
      try { loadCatalog(broken); } catch (error) { parseMessage = (error as Error).message; }
      assert.notEqual(parseMessage, "", "the broken catalog must fail to parse or the case is vacuous");
      writeFileSync(catalogPath, broken);

      const tickets = await router.dispatch(request("/api/v1/tickets"));
      assert.equal(tickets.status, 200);
      const stale = tickets.body as TicketsResponse;
      assert.deepEqual(
        { stale: stale.stale, planError: stale.planError },
        { stale: true, planError: { code: "PlanUnresolved", message: parseMessage } },
      );
      assert.deepEqual(stale.tickets.map((ticket) => ticket.uid), ["fixture/T01"], "the last good board is still served");

      const sessions = await router.dispatch(request("/api/v1/sessions"));
      assert.equal(sessions.status, 200);
      const body = sessions.body as SessionsResponse;
      assert.deepEqual(body.plans.map((plan) => plan.id), ["fixture"]);
      assert.deepEqual(
        { stale: body.stale, planError: body.planError },
        { stale: true, planError: { code: "PlanUnresolved", message: parseMessage } },
      );
    } finally { close(); }
  });
});

test("B2-04: a plans root removed at runtime is stale with the resolver's ENOENT, and clears once restored", async () => {
  await withCheckout({ catalog: true, plansRoot: true }, async ({ root }) => {
    const { router, close } = routerFor(root);
    try {
      assert.equal(((await router.dispatch(request("/api/v1/tickets"))).body as TicketsResponse).stale, undefined);
      renameSync(join(root, "specs"), join(root, "specs-away"));

      const sessions = (await router.dispatch(request("/api/v1/sessions"))).body as SessionsResponse;
      assert.deepEqual(sessions.plans.map((plan) => plan.id), ["fixture"], "the last good plan set, not an empty one");
      assert.equal(sessions.stale, true);
      assert.equal(sessions.planError?.code, "PlanUnresolved");
      assert.match(sessions.planError?.message ?? "", /ENOENT.*scandir '\.\/specs'/u);
      assert.equal(sessions.planError?.message.includes(root), false, "the checkout path is not sent");

      const tickets = (await router.dispatch(request("/api/v1/tickets"))).body as TicketsResponse;
      assert.deepEqual(tickets.plans.map((plan) => plan.id), ["fixture"]);
      assert.equal(tickets.stale, true);
      assert.equal(tickets.planError?.message, sessions.planError?.message);

      renameSync(join(root, "specs-away"), join(root, "specs"));
      const restored = (await router.dispatch(request("/api/v1/tickets"))).body as TicketsResponse;
      assert.deepEqual(
        { uids: restored.tickets.map((ticket) => ticket.uid), stale: restored.stale, planError: restored.planError },
        { uids: ["fixture/T01"], stale: undefined, planError: undefined },
      );
    } finally { close(); }
  });
});

test("B2-03: a catalog whose plans root never existed is refused by name, not shown as an empty board", async () => {
  await withCheckout({ catalog: true, plansRoot: false }, async ({ root }) => {
    const { router, close } = routerFor(root);
    try {
      const tickets = await router.dispatch(request("/api/v1/tickets"));
      assert.equal(tickets.status, 503);
      const refusal = tickets.body as ApiError;
      assert.equal(refusal.code, "PlanUnresolved");
      assert.match(refusal.error, /ENOENT.*scandir '\.\/specs'/u);

      const source = await router.dispatch(request("/api/v1/tickets?plan=fixture&ticket=T01"));
      assert.deepEqual({ status: source.status, code: (source.body as ApiError).code }, { status: 503, code: "PlanUnresolved" });

      // The sessions board stays up: its runs are database rows, and the plan
      // list beside them is empty with the error named, never silently.
      const sessions = await router.dispatch(request("/api/v1/sessions"));
      assert.equal(sessions.status, 200);
      const body = sessions.body as SessionsResponse;
      assert.equal(body.sessions.length, 1);
      assert.deepEqual(
        { plans: body.plans, stale: body.stale, planError: body.planError },
        { plans: [], stale: undefined, planError: { code: "PlanUnresolved", message: refusal.error } },
      );
    } finally { close(); }
  });
});

test("B2-02: a checkout with no catalog is refused by name, pointing at the light-tier listing", async () => {
  await withCheckout({ catalog: false, plansRoot: false }, async ({ root }) => {
    const { router, close } = routerFor(root);
    try {
      const tickets = await router.dispatch(request("/api/v1/tickets"));
      assert.equal(tickets.status, 503);
      const refusal = tickets.body as ApiError;
      assert.equal(refusal.code, "PlanUnresolved");
      assert.match(refusal.error, /no awsf\.project\.yaml/u);
      assert.match(refusal.error, /awsf backlog/u);
      assert.equal(refusal.error.includes(root), false);
    } finally { close(); }
  });
});

test("the CLI resolver keeps a missing catalog as no plans but no longer hides a missing plans root", async () => {
  await withCheckout({ catalog: false, plansRoot: false }, async ({ root }) => {
    assert.deepEqual(resolveTicketPlanSources(root), []);
  });
  await withCheckout({ catalog: true, plansRoot: false }, async ({ root }) => {
    assert.throws(() => resolveTicketPlanSources(root), (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, "ENOENT");
      assert.equal(error.syscall, "scandir");
      return true;
    });
  });
});
