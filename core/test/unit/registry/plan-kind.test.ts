import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { classifyPlans } from "../../../src/registry/plan-kind.ts";
import { resolvePlanSources, type ResolvedPlanSource } from "../../../src/registry/plan-source.ts";
import { repoRoot } from "../meta/_walk.ts";

function repositorySources(): readonly ResolvedPlanSource[] {
  const catalogPath = join(repoRoot(), "awsf.project.yaml");
  return resolvePlanSources(catalogPath, loadCatalog(readFileSync(catalogPath, "utf8")));
}

function source(root: string, stem: string): ResolvedPlanSource {
  return {
    project: "fixture",
    repositoryId: "fixture",
    planPath: join(root, `${stem}.html`),
    promptsPath: join(root, `${stem}-build-prompts.md`),
    ticketsPath: join(root, "tickets", stem),
    format: "awsf-plan-html/v1",
  };
}

test("repository plan kinds are structural and every deep plan names the v2 spine", () => {
  const plans = classifyPlans(repositorySources());
  assert.deepEqual(plans.filter((plan) => plan.kind === "spine").map((plan) => plan.id), [
    "awsf-plan",
    "awsf-v2-plan",
  ]);
  assert.equal(plans.filter((plan) => plan.kind === "deep").length, 10);
  assert.ok(plans.filter((plan) => plan.kind === "deep").every((plan) => plan.parentSpine === "awsf-v2-plan"));
});

test("an AWSF-rendered generic workstream is deep without prose in its HTML", () => {
  const plans = classifyPlans([source("/fixture", "foo-plan"), source("/fixture", "foo-w01-bar")]);
  assert.deepEqual(plans, [
    { id: "foo-plan", name: "foo-plan", kind: "spine", parentSpine: null, parentSpineName: null },
    { id: "foo-w01-bar", name: "foo-w01-bar", kind: "deep", parentSpine: "foo-plan", parentSpineName: "foo-plan" },
  ]);
});
