import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { loadConfig } from "../../../src/config/load.ts";
import { loadPlacement } from "../../../src/registry/placement.ts";
import {
  QuotaRouteResolutionError,
  resolveProjectQuotaRoutes,
} from "../../../src/quota/routes.ts";

const CONFIG_PATH = new URL("../../../../awsf.config.yaml", import.meta.url);

function routeConfig(slug = "route-project") {
  const doc = parseYaml(readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
  doc.project.slug = slug;
  doc.adapters = {
    claude: { kind: "pi-codex", executable: "pi" },
    stub: { kind: "fixture" },
  };
  doc.routing.default_worker = "claude";
  for (const agent of doc.agents as Array<Record<string, any>>) {
    agent.harness.adapter = "claude";
  }
  return loadConfig(toYaml(doc));
}

test("B2-16: resolves routes from placed plan repository when plans root contains 0 html files", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-b2-16-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    // Empty plans root with non-html files only (tickets subdirectory)
    mkdirSync(join(planRepository, "specs", "tickets"), { recursive: true });
    writeFileSync(join(planRepository, "specs", "README.md"), "# Specs\n");
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
    assert.equal(resolved.configPath, join(planRepository, "awsf.config.yaml"));
    assert.deepEqual(resolved.routes.map((route) => route.adapterId), ["claude", "stub"]);
    assert.deepEqual(resolved.probeRoutes, [{ provider: "codex" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-16: still throws E_QUOTA_PLAN_REPOSITORY_UNRESOLVED if plan repository placement is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-b2-16-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(planRepository, { recursive: true });
    const catalogPath = join(catalogRoot, "awsf.project.yaml");
    writeFileSync(catalogPath, toYaml({
      version: "awsf.project/v1",
      project: { slug: "unplaced-project" },
      repositories: { plans: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "example" },
    }));
    const placement = loadPlacement(toYaml({
      version: "awsf.placement/v1",
      project: "unplaced-project",
      repositories: { other: { path: planRepository } },
    }));

    await assert.rejects(
      async () => resolveProjectQuotaRoutes({ catalogPath, placement }),
      (err: any) => {
        assert.ok(err instanceof QuotaRouteResolutionError);
        assert.equal(err.code, "E_QUOTA_PLAN_REPOSITORY_UNRESOLVED");
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-16: throws E_QUOTA_PROJECT_MISMATCH when config slug differs even with 0 html plan files", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-b2-16-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(join(planRepository, "specs"), { recursive: true });
    writeFileSync(join(planRepository, "awsf.config.yaml"), toYaml(routeConfig("different-project")));

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

    await assert.rejects(
      async () => resolveProjectQuotaRoutes({ catalogPath, placement }),
      (err: any) => {
        assert.ok(err instanceof QuotaRouteResolutionError);
        assert.equal(err.code, "E_QUOTA_PROJECT_MISMATCH");
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-16: throws E_QUOTA_PLAN_REPOSITORY_UNRESOLVED when placement project slug mismatches", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-b2-16-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(join(planRepository, "specs"), { recursive: true });
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
      project: "mismatched-slug",
      repositories: { plans: { path: planRepository } },
    }));

    await assert.rejects(
      async () => resolveProjectQuotaRoutes({ catalogPath, placement }),
      (err: any) => {
        assert.ok(err instanceof QuotaRouteResolutionError);
        assert.equal(err.code, "E_QUOTA_PLAN_REPOSITORY_UNRESOLVED");
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-16: maps diverse route types correctly when placed plan repository has 0 html plan files", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-quota-routes-b2-16-"));
  try {
    const catalogRoot = join(root, "catalog-copy");
    const planRepository = join(root, "declared-plans");
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(join(planRepository, "specs"), { recursive: true });

    const doc = parseYaml(readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
    doc.project.slug = "complex-project";
    doc.adapters = {
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
    writeFileSync(join(planRepository, "awsf.config.yaml"), toYaml(doc));

    const catalogPath = join(catalogRoot, "awsf.project.yaml");
    writeFileSync(catalogPath, toYaml({
      version: "awsf.project/v1",
      project: { slug: "complex-project" },
      repositories: { plans: { role: "plan", default_branch: "main" } },
      plans: { root: "specs", format: "awsf-plan-html/v1", default: "example" },
    }));
    const placement = loadPlacement(toYaml({
      version: "awsf.placement/v1",
      project: "complex-project",
      repositories: { plans: { path: planRepository } },
    }));

    const resolved = await resolveProjectQuotaRoutes({
      catalogPath,
      placement,
      resolveCompositeMemberIds(adapterId) {
        return adapterId === "fusion" ? ["claude", "stub"] : undefined;
      },
    });

    assert.equal(resolved.project, "complex-project");
    assert.deepEqual(resolved.routes.map((route) => route.adapterId), ["claude", "stub", "gravity", "fusion"]);
    const fusionRoute = resolved.routes.find((route) => route.adapterId === "fusion");
    assert.equal(fusionRoute?.disposition, "measurable");
    assert.deepEqual(fusionRoute?.providers, ["codex"]);
    assert.deepEqual(resolved.probeRoutes, [{ provider: "codex" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
