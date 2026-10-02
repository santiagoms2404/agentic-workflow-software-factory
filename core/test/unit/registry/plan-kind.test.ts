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

test("repository plan kinds are structural and every deep plan names its own spine", () => {
  // A rule, not a list. The list of spine ids turned red every time a spine was
  // authored, the same way the old deep-plan count did.
  const plans = classifyPlans(repositorySources());
  const spines = plans.filter((plan) => plan.kind === "spine");
  const deep = plans.filter((plan) => plan.kind === "deep");
  assert.ok(spines.length > 0 && deep.length > 0, "the corpus must contain both kinds or the checks below are vacuous");

  const spineIds = new Set(spines.map((plan) => plan.id));
  const offenders: string[] = [];
  for (const plan of plans) {
    const prefix = /^(.+)-w\d\d-/u.exec(plan.id)?.[1];
    if (prefix === undefined) {
      if (plan.kind !== "spine" || !plan.id.endsWith("-plan")) offenders.push(`${plan.id}: no -wNN- segment, so it must be a <prefix>-plan spine`);
    } else if (plan.kind !== "deep" || plan.parentSpine !== `${prefix}-plan` || !spineIds.has(plan.parentSpine)) {
      offenders.push(`${plan.id}: a -wNN- plan must be deep under the resolved spine ${prefix}-plan, got ${plan.kind} under ${String(plan.parentSpine)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("an AWSF-rendered generic workstream is deep without prose in its HTML", () => {
  const plans = classifyPlans([source("/fixture", "foo-plan"), source("/fixture", "foo-w01-bar")]);
  assert.deepEqual(plans, [
    { id: "foo-plan", name: "foo-plan", kind: "spine", parentSpine: null, parentSpineName: null },
    { id: "foo-w01-bar", name: "foo-w01-bar", kind: "deep", parentSpine: "foo-plan", parentSpineName: "foo-plan" },
  ]);
});
