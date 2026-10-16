import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import type { ProjectCatalog } from "../../../src/registry/catalog-schema.ts";
import { PlanCheckoutUnresolvedError, resolvePlanSources } from "../../../src/registry/plan-source.ts";

// B10-03: the self checkout is the nearest directory at or above the working
// directory that holds a .git entry. A directory with none above it is not a
// checkout, so it must be refused by name instead of self-placing its plans.

const CATALOG = `
version: awsf.project/v1
project:
  slug: no-git-fixture
repositories:
  plans:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`;

function gitAbove(directory: string): string | undefined {
  let candidate = directory;
  while (true) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

function withFixture(run: (root: string, catalogPath: string, catalog: ProjectCatalog) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "awsf-plan-source-no-git-")));
  const catalogPath = join(root, "awsf.project.yaml");
  mkdirSync(join(root, "specs", "tickets", "alpha"), { recursive: true });
  writeFileSync(join(root, "specs", "alpha.html"), "<html></html>");
  writeFileSync(join(root, "specs", "alpha-build-prompts.md"), "# prompts\n");
  writeFileSync(catalogPath, CATALOG);
  const previous = process.cwd();
  try {
    run(root, catalogPath, loadCatalog(CATALOG));
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

test("a folder holding awsf.project.yaml with no .git above it is refused by name", () => {
  withFixture((root, catalogPath, catalog) => {
    // The fixture premise: nothing between the temp root and / is a checkout.
    assert.equal(gitAbove(root), undefined);
    process.chdir(root);
    assert.throws(
      () => resolvePlanSources(catalogPath, catalog),
      (error: unknown) => {
        assert.ok(error instanceof PlanCheckoutUnresolvedError);
        assert.equal(error.code, "E_PLAN_CHECKOUT_UNRESOLVED");
        assert.equal(error.start, root);
        assert.match(error.message, /not inside a git checkout/u);
        return true;
      },
    );
  });
});

test("a non-git parent of the plan checkout is refused by name, not by an ENOENT on its own specs path", () => {
  withFixture((root, _catalogPath, catalog) => {
    // The catalog lives in a real checkout below the non-git working directory.
    const parent = join(root, "specs-less-parent");
    const repository = join(parent, "repository");
    mkdirSync(join(repository, ".git"), { recursive: true });
    mkdirSync(join(repository, "specs"));
    writeFileSync(join(repository, "specs", "alpha.html"), "<html></html>");
    writeFileSync(join(repository, "awsf.project.yaml"), CATALOG);
    process.chdir(parent);
    assert.throws(
      () => resolvePlanSources(join(repository, "awsf.project.yaml"), catalog, {
        version: "awsf.placement/v1",
        project: "no-git-fixture",
        repositories: { plans: { path: repository } },
      }),
      (error: unknown) => {
        assert.ok(error instanceof PlanCheckoutUnresolvedError, `expected a named refusal, got ${String(error)}`);
        assert.equal(error.start, parent);
        return true;
      },
    );
  });
});

test("a folder with a .git directory resolves its plans to that checkout", () => {
  withFixture((root, catalogPath, catalog) => {
    mkdirSync(join(root, ".git"));
    process.chdir(root);
    assert.deepEqual(resolvePlanSources(catalogPath, catalog).map((source) => source.planPath),
      [join(root, "specs", "alpha.html")]);
  });
});

test("a worktree-style .git file marks the checkout root, even from a subdirectory", () => {
  withFixture((root, catalogPath, catalog) => {
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/fixture\n");
    const nested = join(root, "nested", "deeper");
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    assert.deepEqual(resolvePlanSources(catalogPath, catalog).map((source) => source.planPath),
      [join(root, "specs", "alpha.html")]);
  });
});
