import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listGroupSummaries } from "../../../src/api/planning-route.ts";
import { createApiRouter, resolveTicketPlanSources } from "../../../src/api/routes.ts";
import { SecurityError, validateAuthority } from "../../../src/api/security.ts";
import { createApiServer } from "../../../src/api/server.ts";
import { openDatabase, type OpenDatabaseOptions } from "../../../src/observability/sqlite.ts";
import { capture, hash } from "../../../src/planning/store.ts";
import type { ResolvedPlanSource } from "../../../src/registry/plan-source.ts";
import type { GroupsResponse, SessionsResponse, TicketsResponse } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

const VALID_TICKET = "---\nid: T01\ntitle: First\nmilestone: M1\ntier: 0\nstate: todo\ndepends_on: []\nworkflow: build\noutcome: First\ncontext: [First]\nacceptance: [First]\nnon_goals: [First]\n---\nbody\n";

function narrative(title: string) {
  return { title, explanation: "an explanation", changes: "what changed", reason: "a reason", friction: "", tasks: [], references: [] };
}

async function seedGroup(stateRoot: string, project: string, group: string, ask: string): Promise<void> {
  const location = { stateRoot, project, group };
  await capture({ ...location, id: `${group}-c1`, expected: 0 },
    { id: `${group}-in`, text: ask, sha256: hash(ask), provenance: "owner terminal", attachments: [] },
    narrative(`capture ${group}`));
}

test("B2-19: listGroupSummaries() catches journal parsing/replay/corruption errors as unreadable, but rethrows programming defects like TypeError or ReferenceError", async (t) => {
  const PROJECT = "test-project";
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-19-")));

  try {
    // 1. Corrupt line (invalid JSON)
    const corruptDir = join(stateRoot, "projects", PROJECT, "groups", "grp-corrupt");
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, "journal.jsonl"), "this is not json\n");

    // 2. Torn append (trailing bytes without terminating newline)
    const tornDir = join(stateRoot, "projects", PROJECT, "groups", "grp-torn");
    mkdirSync(tornDir, { recursive: true });
    writeFileSync(join(tornDir, "journal.jsonl"), '{"source_seq":1');

    // 3. Digest mismatch
    await seedGroup(stateRoot, PROJECT, "grp-digest", "ask for digest mismatch");
    const digestJournal = join(stateRoot, "projects", PROJECT, "groups", "grp-digest", "journal.jsonl");
    const rawRecord = JSON.parse(readFileSync(digestJournal, "utf8").trim()) as { event: { digest: string } };
    rawRecord.event.digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    writeFileSync(digestJournal, `${JSON.stringify(rawRecord)}\n`);

    // 4. Good group
    await seedGroup(stateRoot, PROJECT, "grp-good", "valid group ask");

    const res = await listGroupSummaries({ stateRoot, project: PROJECT });
    assert.deepEqual(res.groups.map((g) => g.group), ["grp-good"]);
    assert.deepEqual([...res.unreadable].sort(), ["grp-corrupt", "grp-digest", "grp-torn"]);

    // 5. Programming defect: TypeError is rethrown
    const typeDefectRoot = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-19-type-")));
    try {
      await seedGroup(typeDefectRoot, PROJECT, "grp-good", "valid ask");
      const mockClone = t.mock.method(globalThis, "structuredClone", () => {
        throw new TypeError("injected type defect");
      });
      try {
        await assert.rejects(
          () => listGroupSummaries({ stateRoot: typeDefectRoot, project: PROJECT }),
          (err: unknown) => err instanceof TypeError && (err as TypeError).message === "injected type defect",
        );
      } finally {
        mockClone.mock.restore();
      }
    } finally {
      rmSync(typeDefectRoot, { recursive: true, force: true });
    }

    // 6. Programming defect: ReferenceError is rethrown
    const refDefectRoot = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-19-ref-")));
    try {
      await seedGroup(refDefectRoot, PROJECT, "grp-good", "valid ask");
      const mockClone = t.mock.method(globalThis, "structuredClone", () => {
        throw new ReferenceError("injected reference defect");
      });
      try {
        await assert.rejects(
          () => listGroupSummaries({ stateRoot: refDefectRoot, project: PROJECT }),
          (err: unknown) => err instanceof ReferenceError && (err as ReferenceError).message === "injected reference defect",
        );
      } finally {
        mockClone.mock.restore();
      }
    } finally {
      rmSync(refDefectRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("B2-20: resolveTicketPlanSources(repository) respects the passed repository rather than defaulting/falling back on process.cwd()", () => {
  const repoA = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-20-repoA-")));
  const repoB = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-20-repoB-")));
  const emptyRepo = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-20-empty-")));

  try {
    writeFileSync(join(repoA, "awsf.project.yaml"), JSON.stringify({
      version: "awsf.project/v1",
      project: { slug: "project-a" },
      repositories: { repo: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "plan-a" },
    }));
    mkdirSync(join(repoA, "specs", "tickets", "plan-a"), { recursive: true });
    writeFileSync(join(repoA, "specs", "plan-a.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(repoA, "specs", "tickets", "plan-a", "T01.md"), VALID_TICKET);

    writeFileSync(join(repoB, "awsf.project.yaml"), JSON.stringify({
      version: "awsf.project/v1",
      project: { slug: "project-b" },
      repositories: { repo: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "plan-b" },
    }));
    mkdirSync(join(repoB, "specs", "tickets", "plan-b"), { recursive: true });
    writeFileSync(join(repoB, "specs", "plan-b.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(repoB, "specs", "tickets", "plan-b", "T01.md"), VALID_TICKET);

    const sourcesA = resolveTicketPlanSources(repoA);
    assert.equal(sourcesA.length, 1);
    assert.equal(sourcesA[0]?.project, "project-a");
    assert.ok(sourcesA[0]?.planPath.startsWith(repoA));
    assert.ok(sourcesA[0]?.ticketsPath.startsWith(repoA));

    const sourcesB = resolveTicketPlanSources(repoB);
    assert.equal(sourcesB.length, 1);
    assert.equal(sourcesB[0]?.project, "project-b");
    assert.ok(sourcesB[0]?.planPath.startsWith(repoB));
    assert.ok(sourcesB[0]?.ticketsPath.startsWith(repoB));

    // Passing a checkout without a catalog resolves to empty, not falling back to cwd
    const sourcesEmpty = resolveTicketPlanSources(emptyRepo);
    assert.deepEqual(sourcesEmpty, []);
  } finally {
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
    rmSync(emptyRepo, { recursive: true, force: true });
  }
});

test("B2-21: When awsf.project.yaml is missing (ENOENT) or malformed mid-edit during currentPlans() polling, keep serving the last known good cached plan set rather than replacing it with an empty plan catalog", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-21-")));
  const catalogPath = join(root, "awsf.project.yaml");
  const fixture = apiFixture();

  const validCatalog = JSON.stringify({
    version: "awsf.project/v1",
    project: { slug: "test-project" },
    repositories: { repo: { role: "plan", default_branch: "main" } },
    plans: { root: "specs", format: "awsf-plan-html/v1", default: "fixture" },
  });

  writeFileSync(catalogPath, validCatalog);
  mkdirSync(join(root, "specs", "tickets", "fixture"), { recursive: true });
  writeFileSync(join(root, "specs", "fixture.html"), "<h3>Milestone M1</h3>");
  writeFileSync(join(root, "specs", "tickets", "fixture", "T01.md"), VALID_TICKET);

  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, repository: root });

  try {
    // 1. Initial fresh resolution
    const resFresh = await router.dispatch({ method: "GET", url: "/api/v1/tickets", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resFresh.status, 200);
    const bodyFresh = resFresh.body as TicketsResponse;
    assert.deepEqual(bodyFresh.tickets.map((t) => t.uid), ["fixture/T01"]);
    assert.equal(bodyFresh.stale, undefined);
    assert.equal(bodyFresh.planError, undefined);

    // 2. Missing catalog (ENOENT): keep serving last good cached plan set beside stale flag and error
    rmSync(catalogPath);
    const resMissing = await router.dispatch({ method: "GET", url: "/api/v1/tickets", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resMissing.status, 200);
    const bodyMissing = resMissing.body as TicketsResponse;
    assert.equal(bodyMissing.stale, true);
    assert.equal(bodyMissing.planError?.code, "PlanUnresolved");
    assert.ok(bodyMissing.planError?.message.includes("no awsf.project.yaml in this checkout"));
    assert.deepEqual(bodyMissing.tickets.map((t) => t.uid), ["fixture/T01"]);

    const resSessionsMissing = await router.dispatch({ method: "GET", url: "/api/v1/sessions", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resSessionsMissing.status, 200);
    const bodySessionsMissing = resSessionsMissing.body as SessionsResponse;
    assert.equal(bodySessionsMissing.stale, true);
    assert.equal(bodySessionsMissing.planError?.code, "PlanUnresolved");
    assert.deepEqual(bodySessionsMissing.plans.map((p) => p.id), ["fixture"]);

    // 3. Malformed mid-edit catalog: keep serving last good cached plan set
    writeFileSync(catalogPath, "version: [unclosed\n");
    const resMalformed = await router.dispatch({ method: "GET", url: "/api/v1/tickets", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resMalformed.status, 200);
    const bodyMalformed = resMalformed.body as TicketsResponse;
    assert.equal(bodyMalformed.stale, true);
    assert.equal(bodyMalformed.planError?.code, "PlanUnresolved");
    assert.deepEqual(bodyMalformed.tickets.map((t) => t.uid), ["fixture/T01"]);

    const resSessionsMalformed = await router.dispatch({ method: "GET", url: "/api/v1/sessions", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resSessionsMalformed.status, 200);
    const bodySessionsMalformed = resSessionsMalformed.body as SessionsResponse;
    assert.equal(bodySessionsMalformed.stale, true);
    assert.equal(bodySessionsMalformed.planError?.code, "PlanUnresolved");
    assert.deepEqual(bodySessionsMalformed.plans.map((p) => p.id), ["fixture"]);

    // 4. Restored catalog: served fresh without stale flag
    writeFileSync(catalogPath, validCatalog);
    const resRestored = await router.dispatch({ method: "GET", url: "/api/v1/tickets", headers: { host: "127.0.0.1:4600" } });
    assert.equal(resRestored.status, 200);
    const bodyRestored = resRestored.body as TicketsResponse;
    assert.equal(bodyRestored.stale, undefined);
    assert.equal(bodyRestored.planError, undefined);
    assert.deepEqual(bodyRestored.tickets.map((t) => t.uid), ["fixture/T01"]);
  } finally {
    router.close();
    fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-22: In createApiRouter, ensure readDb is closed if plan catalog resolution throws during initialization", () => {
  const fixture = apiFixture();
  let dbClosed = false;
  const customOpen = (path: string, options?: OpenDatabaseOptions) => {
    const db = openDatabase(path, options);
    const origClose = db.close.bind(db);
    db.close = () => {
      dbClosed = true;
      origClose();
    };
    return db;
  };

  try {
    assert.throws(
      () => createApiRouter({
        dbPath: fixture.path,
        config: fixture.config,
        open: customOpen,
        planSources: [{ planPath: 123 as unknown as string, ticketsPath: "" } as unknown as ResolvedPlanSource],
      }),
      TypeError,
    );
    assert.equal(dbClosed, true, "readDb must be closed when plan catalog initialization throws");
  } finally {
    fixture.close();
  }
});

test("B2-22: In createApiServer.start(), close router if server.listen rejects", async () => {
  const fixture = apiFixture();
  const server1 = createApiServer({ dbPath: fixture.path, config: fixture.config, port: 0 });
  const running1 = await server1.start();
  const busyPort = running1.port;

  const server2 = createApiServer({ dbPath: fixture.path, config: fixture.config, port: busyPort });
  let routerClosed = false;
  const origClose = server2.router.close.bind(server2.router);
  server2.router.close = () => {
    routerClosed = true;
    origClose();
  };

  try {
    await assert.rejects(
      () => server2.start(),
      (err: NodeJS.ErrnoException) => err.code === "EADDRINUSE",
    );
    assert.equal(routerClosed, true, "router must be closed when server.listen rejects");
  } finally {
    await running1.close();
    fixture.close();
  }
});

test("B2-23: oneHeader rejects duplicated Host headers (both as array and as comma-separated string from Node http) with code 'invalid-host'", async () => {
  // Directly on validateAuthority
  assert.throws(
    () => validateAuthority({ host: ["127.0.0.1:4600", "127.0.0.1:4600"] as unknown as string }),
    (err: unknown) => err instanceof SecurityError && err.code === "invalid-host",
  );
  assert.throws(
    () => validateAuthority({ host: "127.0.0.1:4600, 127.0.0.1:4600" }),
    (err: unknown) => err instanceof SecurityError && err.code === "invalid-host",
  );

  // Through router dispatch
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  try {
    const arrayRes = await router.dispatch({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: ["127.0.0.1:4600", "127.0.0.1:4600"] as unknown as string },
    });
    assert.equal(arrayRes.status, 400);
    assert.deepEqual(arrayRes.body, { error: "host must occur at most once", code: "invalid-host" });

    const commaRes = await router.dispatch({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "127.0.0.1:4600, 127.0.0.1:4600" },
    });
    assert.equal(commaRes.status, 400);
    assert.deepEqual(commaRes.body, { error: "Host must occur at most once", code: "invalid-host" });
  } finally {
    router.close();
    fixture.close();
  }
});

test("B2-24: ApiServerOptions supports optional repository, stateRoot, planSources and passes them through to createApiRouter", async () => {
  const fixture = apiFixture();
  const stateRoot = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-24-stateroot-")));
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "awsf-b2-24-repo-")));

  try {
    await seedGroup(stateRoot, fixture.config.project.slug, "server-group", "server test ask");

    const catalogPath = join(repo, "awsf.project.yaml");
    writeFileSync(catalogPath, JSON.stringify({
      version: "awsf.project/v1",
      project: { slug: fixture.config.project.slug },
      repositories: { repo: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "custom-plan" },
    }));
    mkdirSync(join(repo, "specs", "tickets", "custom-plan"), { recursive: true });
    writeFileSync(join(repo, "specs", "custom-plan.html"), "<h3>Milestone M1</h3>");
    writeFileSync(join(repo, "specs", "tickets", "custom-plan", "T01.md"), VALID_TICKET);

    // 1. Pass planSources
    const serverWithPlanSources = createApiServer({
      dbPath: fixture.path,
      config: fixture.config,
      planSources: fixture.planSources,
    });
    try {
      const ticketsRes = await serverWithPlanSources.router.dispatch({
        method: "GET",
        url: "/api/v1/tickets",
        headers: { host: "127.0.0.1:4600" },
      });
      assert.equal(ticketsRes.status, 200);
      const ticketsBody = ticketsRes.body as TicketsResponse;
      assert.deepEqual(ticketsBody.plans.map((p) => p.id), ["fixture-plan", "fixture-w01-deep"]);
    } finally {
      serverWithPlanSources.router.close();
    }

    // 2. Pass stateRoot
    const serverWithStateRoot = createApiServer({
      dbPath: fixture.path,
      config: fixture.config,
      stateRoot,
      planSources: fixture.planSources,
    });
    try {
      const groupsRes = await serverWithStateRoot.router.dispatch({
        method: "GET",
        url: "/api/v1/groups",
        headers: { host: "127.0.0.1:4600" },
      });
      assert.equal(groupsRes.status, 200);
      const groupsBody = groupsRes.body as GroupsResponse;
      assert.deepEqual(groupsBody.groups.map((g) => g.group), ["server-group"]);
    } finally {
      serverWithStateRoot.router.close();
    }

    // 3. Pass repository
    const serverWithRepo = createApiServer({
      dbPath: fixture.path,
      config: fixture.config,
      repository: repo,
    });
    try {
      const ticketsRes = await serverWithRepo.router.dispatch({
        method: "GET",
        url: "/api/v1/tickets",
        headers: { host: "127.0.0.1:4600" },
      });
      assert.equal(ticketsRes.status, 200);
      const ticketsBody = ticketsRes.body as TicketsResponse;
      assert.deepEqual(ticketsBody.plans.map((p) => p.id), ["custom-plan"]);
    } finally {
      serverWithRepo.router.close();
    }
  } finally {
    fixture.close();
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
