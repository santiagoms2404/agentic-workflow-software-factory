import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import type { ProjectCatalog } from "../../../src/registry/catalog-schema.ts";
import type { Placement } from "../../../src/registry/placement-schema.ts";
import {
  PlanGrammarMismatchError,
  UnsupportedPlanFormatError,
  parseAwsfPlanHtmlV1,
  resolvePlanSources,
} from "../../../src/registry/plan-source.ts";
import { repoRoot } from "../meta/_walk.ts";

function foreignCatalog(): ProjectCatalog {
  return loadCatalog(`
version: awsf.project/v1
project:
  slug: foreign-project
repositories:
  plans:
    role: plan
    default_branch: main
  service:
    role: service
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`);
}

function foreignPlacement(repository: string): Placement {
  return {
    version: "awsf.placement/v1",
    project: "foreign-project",
    repositories: {
      plans: { path: repository },
    },
  };
}

function withForeignRepository(run: (root: string, repository: string, catalogPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-source-"));
  const repository = join(root, "plan-repository");
  const catalogPath = join(repository, "awsf.project.yaml");
  mkdirSync(join(repository, "specs", "tickets", "alpha"), { recursive: true });
  writeFileSync(join(repository, "specs", "alpha.html"), "<html></html>");
  writeFileSync(join(repository, "specs", "alpha-build-prompts.md"), "# prompts\n");
  writeFileSync(catalogPath, "catalog location fixture\n");
  try {
    run(root, repository, catalogPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("self-places this checkout without consulting placement", () => {
  const catalogPath = join(repoRoot(), "awsf.project.yaml");
  const catalog = loadCatalog(readFileSync(catalogPath, "utf8"));
  const placement = new Proxy({} as Placement, {
    get() {
      throw new Error("self-placement consulted placement");
    },
  });

  const sources = resolvePlanSources(catalogPath, catalog, placement);
  const source = sources.find((candidate) => candidate.planPath === join(repoRoot(), "specs", "awsf-plan.html"));

  assert.ok(source);
  assert.deepEqual(source, {
    project: "agentic-workflow-software-factory",
    repositoryId: "awsf",
    planPath: join(repoRoot(), "specs", "awsf-plan.html"),
    promptsPath: join(repoRoot(), "specs", "awsf-plan-build-prompts.md"),
    ticketsPath: join(repoRoot(), "specs", "tickets", "awsf-plan"),
    format: "awsf-plan-html/v1",
  });
});

test("returns no foreign records without placement and resolves them where placement locates them", () => {
  withForeignRepository((_root, repository, catalogPath) => {
    const catalog = foreignCatalog();
    assert.deepEqual(resolvePlanSources(catalogPath, catalog), []);

    assert.deepEqual(resolvePlanSources(catalogPath, catalog, foreignPlacement(repository)), [{
      project: "foreign-project",
      repositoryId: "plans",
      planPath: join(repository, "specs", "alpha.html"),
      promptsPath: join(repository, "specs", "alpha-build-prompts.md"),
      ticketsPath: join(repository, "specs", "tickets", "alpha"),
      format: "awsf-plan-html/v1",
    }]);
  });
});

test("refuses an unimplemented declared format by format and plan name", () => {
  withForeignRepository((_root, repository, catalogPath) => {
    const catalog = foreignCatalog();
    (catalog.plans as unknown as { format: string }).format = "phase-plan-html/v1";

    assert.throws(
      () => resolvePlanSources(catalogPath, catalog, foreignPlacement(repository)),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedPlanFormatError);
        assert.equal(error.format, "phase-plan-html/v1");
        assert.equal(error.plan, "alpha");
        assert.match(error.message, /exactly one format is implemented/u);
        assert.match(error.message, /awsf-plan-html\/v1/u);
        return true;
      },
    );
  });
});

test("the named v1 parser preserves milestone grammar and task boundaries", () => {
  const tasks = parseAwsfPlanHtmlV1(`
<section>
<h3><code class="status">[wip]</code> Milestone M5: Registry</h3>
<h4>0. Authoring</h4><code class="status">[x]</code>
<h4>16. Sources</h4><code class="status">[x]</code><code class="status">[]</code>
<h4>17. Fence</h4><code class="status">[wip]</code>
</section>
<section><h2>Definition of Done</h2><code class="status">[]</code></section>
`, "fixture-plan");

  assert.deepEqual(tasks, [
    { number: 16, milestone: "M5", milestoneMarker: "wip", checklist: ["x", ""] },
    { number: 17, milestone: "M5", milestoneMarker: "wip", checklist: ["wip"] },
  ]);
});

test("declaring v1 for Phase headings fails loudly instead of parsing zero tasks", () => {
  assert.throws(
    () => parseAwsfPlanHtmlV1(
      '<h3><code class="status">[x]</code> Phase 24.5</h3><h4>16. Sources</h4>',
      "phase-plan",
    ),
    (error: unknown) => error instanceof PlanGrammarMismatchError
      && error.plan === "phase-plan"
      && error.code === "E_PLAN_GRAMMAR_MISMATCH",
  );
});
