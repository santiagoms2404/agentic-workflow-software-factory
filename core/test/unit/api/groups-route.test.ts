import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApiRouter } from "../../../src/api/routes.ts";
import { capture, hash, propose } from "../../../src/planning/store.ts";
import type { GroupsResponse, GroupTree } from "../../../../dashboard/shared/types.ts";
import { apiFixture } from "./_fixture.ts";

const headers = { host: "127.0.0.1:4600" };

function request(url: string, method = "GET") {
  return { method, url, headers };
}

const PROJECT = "test-project";

function narrative(title: string) {
  return { title, explanation: "an explanation", changes: "what changed", reason: "a reason", friction: "", tasks: [], references: [] };
}

async function seedGroup(stateRoot: string, group: string, ask: string): Promise<void> {
  const location = { stateRoot, project: PROJECT, group };
  await capture({ ...location, id: `${group}-c1`, expected: 0 },
    { id: `${group}-in`, text: ask, sha256: hash(ask), provenance: "owner terminal", attachments: [] },
    narrative(`capture ${group}`));
  await propose({ ...location, id: `${group}-c2`, expected: 1 }, {
    id: `${group}-p1`, base: 1, narrative: narrative(`propose in ${group}`),
    alternatives: ["Do it later; rejected because the column is already dead."],
    changes: [{ kind: "constraints", values: ["one constraint"] }],
  });
}

test("the groups route lists driving sessions newest first and returns one decision tree", async () => {
  const fixture = apiFixture();
  const stateRoot = dirname(fixture.path);
  await seedGroup(stateRoot, "drive-early", "The first ask.\nWith a second line.");
  await seedGroup(stateRoot, "drive-late", "The later ask.");
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  try {
    const listed = await router.dispatch(request("/api/v1/groups"));
    assert.equal(listed.status, 200);
    const body = listed.body as GroupsResponse;
    assert.deepEqual(body.groups.map((summary) => summary.group).sort(), ["drive-early", "drive-late"]);
    assert.deepEqual(body.unreadable, []);
    const early = body.groups.find((summary) => summary.group === "drive-early");
    // The title is the owner's own first line, bounded. Not generated.
    assert.equal(early?.title, "The first ask.");
    assert.equal(early?.counts.notTaken, 1);

    const tree = await router.dispatch(request("/api/v1/groups?group=drive-early"));
    assert.equal(tree.status, 200);
    const projection = tree.body as GroupTree;
    assert.equal(projection.schema, "awsf/decision-tree/v1");
    assert.equal(projection.group, "drive-early");
    assert.equal(projection.asks[0]?.text, "The first ask.\nWith a second line.");
    assert.deepEqual(projection.notTaken.map((proposal) => proposal.id), ["drive-early-p1"]);
  } finally { router.close(); fixture.close(); }
});

test("a group a run names but the journal never recorded is 404, and a malformed id never reaches disk", async () => {
  const fixture = apiFixture();
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources });
  try {
    const missing = await router.dispatch(request("/api/v1/groups?group=never-captured"));
    assert.equal(missing.status, 404);
    for (const bad of ["..", "../escape", "with%20space", ""]) {
      const refused = await router.dispatch(request(`/api/v1/groups?group=${bad}`));
      assert.equal(refused.status, 400, bad);
    }
    // And an unknown query parameter is refused rather than ignored.
    assert.equal((await router.dispatch(request("/api/v1/groups?plan=x"))).status, 400);
  } finally { router.close(); fixture.close(); }
});

test("a project with no planning state lists no groups rather than failing the sessions view", async () => {
  const fixture = apiFixture();
  const empty = mkdtempSync(join(tmpdir(), "awsf-no-groups-"));
  const router = createApiRouter({ dbPath: fixture.path, config: fixture.config, planSources: fixture.planSources, stateRoot: empty });
  try {
    const listed = await router.dispatch(request("/api/v1/groups"));
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body, { groups: [], unreadable: [] });
  } finally { router.close(); fixture.close(); }
});
