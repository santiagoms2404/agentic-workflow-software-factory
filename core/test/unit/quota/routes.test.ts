import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { loadConfig } from "../../../src/config/load.ts";
import { loadPlacement } from "../../../src/registry/placement.ts";
import {
  configuredQuotaProbeRoutes,
  mapConfiguredQuotaRoutes,
  resolveProjectQuotaRoutes,
} from "../../../src/quota/routes.ts";

const CONFIG_PATH = new URL("../../../../awsf.config.yaml", import.meta.url);

function routeConfig(slug = "route-project") {
  const doc = parseYaml(readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
  doc.project.slug = slug;
  doc.adapters = {
    // The collision is deliberate: provider selection must use this kind.
    claude: { kind: "pi-codex", executable: "pi" },
    stub: { kind: "fixture" },
    gravity: { kind: "antigravity", executable: "agy", enabled: true, verified: true },
    fusion: { kind: "composite-fusion" },
    hidden: { kind: "claude-code", executable: "claude", enabled: false },
  };
  doc.routing.default_worker = "claude";
  for (const agent of doc.agents as Array<Record<string, any>>) {
    agent.harness.adapter = "claude";
  }
  return loadConfig(toYaml(doc));
}

test("maps enabled routes by adapter kind and explains every route that cannot be probed", () => {
  const config = routeConfig();
  const routes = mapConfiguredQuotaRoutes(config, {
    resolveCompositeMemberIds(adapterId) {
      return adapterId === "fusion" ? ["claude", "stub"] : undefined;
    },
  });

  assert.deepEqual(routes.map((route) => route.adapterId), ["claude", "stub", "gravity", "fusion"]);
  assert.deepEqual(routes[0], {
    adapterId: "claude",
    adapterKind: "pi-codex",
    disposition: "measurable",
    providers: ["codex"],
    memberKinds: [],
    reason: null,
  });
  assert.deepEqual(routes[1], {
    adapterId: "stub",
    adapterKind: "fixture",
    disposition: "spends-no-quota",
    providers: [],
    memberKinds: [],
    reason: "fixture-spends-no-quota",
  });
  assert.equal(routes[2]?.reason, "antigravity-not-measurable");
  assert.deepEqual(routes[3], {
    adapterId: "fusion",
    adapterKind: "composite-fusion",
    disposition: "measurable",
    providers: ["codex"],
    memberKinds: ["pi-codex", "fixture"],
    reason: null,
  });
  assert.deepEqual(configuredQuotaProbeRoutes(routes), [{ provider: "codex" }]);
});

test("an enabled composite with unresolved, disabled, or cyclic members stays unmeasurable", () => {
  const config = routeConfig();
  const unresolved = mapConfiguredQuotaRoutes(config).find((route) => route.adapterId === "fusion");
  assert.deepEqual(unresolved, {
    adapterId: "fusion",
    adapterKind: "composite-fusion",
    disposition: "unmeasurable",
    providers: [],
    memberKinds: null,
    reason: "composite-members-unresolved",
  });

  for (const members of [["hidden"], ["fusion"]]) {
    const composite = mapConfiguredQuotaRoutes(config, {
      resolveCompositeMemberIds: () => members,
    }).find((route) => route.adapterId === "fusion");
    assert.equal(composite?.reason, "composite-members-unresolved");
    assert.deepEqual(composite?.providers, []);
  }
});

test("resolves routes from the catalog's placed plan repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(join(planRepository, "specs"), { recursive: true });
    writeFileSync(join(planRepository, "specs", "example.html"), "<!doctype html><title>example</title>\n");
    writeFileSync(join(planRepository, "awsf.config.yaml"), toYaml(routeConfig("route-project")));

    const catalogPath = join(catalogRoot, "awsf.project.yaml");
    writeFileSync(catalogPath, toYaml({
      version: "awsf.project/v1",
      project: { slug: "route-project" },
      repositories: { plans: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "example" },
    }));
    const placement = loadPlacement(toYaml({
      version: "awsf.placement/v1",
      project: "route-project",
      repositories: { plans: { path: planRepository } },
    }));

    const resolved = await resolveProjectQuotaRoutes({ catalogPath, placement });
    assert.equal(resolved.project, "route-project");
    assert.equal(resolved.planRepositoryId, "plans");
    assert.equal(resolved.planRepositoryPath, planRepository);
    assert.deepEqual(resolved.routes.map((route) => route.adapterId), ["claude", "stub", "gravity", "fusion"]);
    assert.deepEqual(resolved.probeRoutes, [{ provider: "codex" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
