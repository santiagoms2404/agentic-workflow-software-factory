import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { loadPlacement } from "../../../src/registry/placement.ts";
import { defaultWorktreeRoot } from "../../../src/cli/commands/start.ts";
import { resolveProject } from "../../../src/registry/resolve.ts";

interface Fixture {
  readonly root: string;
  readonly primaryRepository: string;
  readonly secondRepository: string;
  readonly stateRoot: string;
  readonly catalogDocument: Record<string, any>;
  readonly placementDocument: Record<string, any>;
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function createRepository(root: string, name: string): string {
  const repository = join(root, name);
  mkdirSync(repository);
  git(repository, "init", "--initial-branch=main");
  git(repository, "config", "user.name", "AWSF test fixture");
  git(repository, "config", "user.email", "fixture@example.test");
  writeFileSync(join(repository, "README.md"), `${name}\n`);
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "root");
  return repository;
}

function loadDocuments(
  root: string,
  catalogDocument: Record<string, any>,
  placementDocument: Record<string, any>,
) {
  const catalogPath = join(root, "awsf.project.yaml");
  const placementPath = join(root, "placement.yaml");
  writeFileSync(catalogPath, toYaml(catalogDocument));
  writeFileSync(placementPath, toYaml(placementDocument));
  return {
    catalog: loadCatalog(readFileSync(catalogPath, "utf8")),
    placement: loadPlacement(readFileSync(placementPath, "utf8")),
  };
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "awsf-resolve-project-"));
  const primaryRepository = createRepository(root, "plans");
  const secondRepository = createRepository(root, "other-clone");
  const rootCommit = git(primaryRepository, "rev-list", "--max-parents=0", "HEAD");
  const repositories = {
    plans: primaryRepository,
    service: join(root, "service"),
    application: secondRepository,
    "model-source-one": join(root, "model-source-one"),
    "model-source-two": join(root, "model-source-two"),
  };
  for (const path of Object.values(repositories)) mkdirSync(path, { recursive: true });

  return {
    root,
    primaryRepository,
    secondRepository,
    stateRoot: join(root, "state"),
    catalogDocument: {
      version: "awsf.project/v1",
      project: { slug: "smart-health" },
      repositories: {
        plans: { role: "plan", default_branch: "main", identity: { root_commit: rootCommit } },
        service: { role: "service", default_branch: "main", gates: { test: { argv: ["npm", "test"], timeout_seconds: 60 } } },
        application: { role: "application", default_branch: "master" },
        "model-source-one": { role: "source", default_branch: "main" },
        "model-source-two": { role: "source", default_branch: "master" },
      },
      plans: { root: "specs", format: "awsf-plan-html/v1" },
    },
    placementDocument: {
      version: "awsf.placement/v1",
      project: "smart-health",
      worktree_root: join(root, "project-worktrees"),
      repositories: {
        plans: { path: repositories.plans, worktree_root: join(root, "plans-worktrees") },
        service: { path: repositories.service },
        application: { path: repositories.application },
        "model-source-one": { path: repositories["model-source-one"] },
        "model-source-two": { path: repositories["model-source-two"] },
      },
    },
  };
}

function withFixture(run: (fixture: Fixture) => void): void {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof Error && (error as { code?: string }).code === code);
}

test("resolves five repositories from on-disk documents, including one with no identity signal", () => {
  withFixture((fixture) => {
    const { catalog, placement } = loadDocuments(fixture.root, fixture.catalogDocument, fixture.placementDocument);
    const resolved = resolveProject(catalog, placement, fixture.stateRoot);

    assert.equal(Object.keys(resolved.repositories).length, 5);
    assert.equal(resolved.repositories.plans?.path, fixture.primaryRepository);
    assert.equal(catalog.repositories.application?.identity, undefined);
    assert.equal(resolved.repositories.application?.path, fixture.secondRepository);
    assert.deepEqual(resolved.gatesFor("service"), [{
      gateId: "test", argv: ["npm", "test"], timeout_seconds: 60,
    }]);
  });
});

test("rejects each catalog and placement disagreement by code", () => {
  withFixture((fixture) => {
    const slugMismatch = structuredClone(fixture.placementDocument);
    slugMismatch.project = "another-project";
    let documents = loadDocuments(fixture.root, fixture.catalogDocument, slugMismatch);
    assertCode(() => resolveProject(documents.catalog, documents.placement, fixture.stateRoot), "E_PROJECT_SLUG_MISMATCH");

    const unplaced = structuredClone(fixture.placementDocument);
    delete unplaced.repositories.service;
    documents = loadDocuments(fixture.root, fixture.catalogDocument, unplaced);
    assertCode(() => resolveProject(documents.catalog, documents.placement, fixture.stateRoot), "E_PROJECT_UNPLACED_REPOSITORY");

    const orphan = structuredClone(fixture.placementDocument);
    orphan.repositories["dispatch-daemon"] = { path: fixture.secondRepository };
    documents = loadDocuments(fixture.root, fixture.catalogDocument, orphan);
    assertCode(() => resolveProject(documents.catalog, documents.placement, fixture.stateRoot), "E_PROJECT_ORPHAN_PLACEMENT");

    const identityMismatch = structuredClone(fixture.placementDocument);
    identityMismatch.repositories.plans.path = fixture.secondRepository;
    documents = loadDocuments(fixture.root, fixture.catalogDocument, identityMismatch);
    assertCode(() => resolveProject(documents.catalog, documents.placement, fixture.stateRoot), "E_PROJECT_REPOSITORY_IDENTITY_MISMATCH");
  });
});

test("resolves per-repository, project, and default worktree roots in order", () => {
  withFixture((fixture) => {
    const { catalog, placement } = loadDocuments(fixture.root, fixture.catalogDocument, fixture.placementDocument);
    const resolved = resolveProject(catalog, placement, fixture.stateRoot);
    assert.equal(resolved.repositories.plans?.worktreeRoot, join(fixture.root, "plans-worktrees"));
    assert.equal(resolved.repositories.service?.worktreeRoot, join(fixture.root, "project-worktrees"));

    const fallbackPlacement = structuredClone(fixture.placementDocument);
    delete fallbackPlacement.worktree_root;
    delete fallbackPlacement.repositories.plans.worktree_root;
    const fallbackDocuments = loadDocuments(fixture.root, fixture.catalogDocument, fallbackPlacement);
    const fallback = resolveProject(fallbackDocuments.catalog, fallbackDocuments.placement, fixture.stateRoot);
    assert.equal(fallback.repositories.plans?.worktreeRoot, defaultWorktreeRoot(fixture.stateRoot));
  });
});
