import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import {
  listProjects,
  ProjectAlreadyRegisteredError,
  registerProject,
  showProject,
} from "../../../src/cli/commands/project.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { placementFilePath } from "../../../src/persistence/platform-paths.ts";
import { relRepo, repoRoot } from "../meta/_walk.ts";

function catalog(slug: string, repositories: Record<string, unknown>): string {
  return toYaml({
    version: "awsf.project/v1",
    project: { slug },
    repositories,
    plans: { root: "specs", format: "awsf-plan-html/v1" },
  });
}

function planRepository(): Record<string, unknown> {
  return { role: "plan", default_branch: "main" };
}

test("register, list, and show round-trip a project placement", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-project-command-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "plans");
  const catalogPath = join(repository, "awsf.project.yaml");
  try {
    requireDirectory(repository);
    writeFileSync(catalogPath, catalog("project-command", { plans: planRepository() }));

    const registered = await registerProject({
      stateRoot,
      catalogPath,
      repositories: [`plans=${repository}`],
    });

    assert.equal(registered.slug, "project-command");
    assert.deepEqual(await listProjects(stateRoot), ["project-command: 1 repository(ies), resolves: yes"]);
    assert.deepEqual(await showProject(stateRoot, "project-command"), [
      `plans: role=plan, branch=main, gates=none, worktree_root=${join(root, "awsf-worktrees")}`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a registration resolution failure leaves no placement file", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-project-resolution-failure-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "plans");
  const catalogPath = join(repository, "awsf.project.yaml");
  const placementPath = placementFilePath(stateRoot, "unplaced-project");
  try {
    requireDirectory(repository);
    writeFileSync(catalogPath, catalog("unplaced-project", {
      plans: { ...planRepository(), identity: { root_commit: "a".repeat(40) } },
    }));

    await assert.rejects(
      registerProject({ stateRoot, catalogPath, repositories: [`plans=${repository}`] }),
      (error: unknown) => error instanceof Error && error.name === "RepositoryIdentityMismatchError",
    );
    assert.equal(existsSync(placementPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second registration refuses without changing the placement file bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-project-reregister-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "plans");
  const catalogPath = join(repository, "awsf.project.yaml");
  const placementPath = placementFilePath(stateRoot, "registered-project");
  try {
    requireDirectory(repository);
    writeFileSync(catalogPath, catalog("registered-project", { plans: planRepository() }));
    const options = { stateRoot, catalogPath, repositories: [`plans=${repository}`] };
    await registerProject(options);
    const before = readFileSync(placementPath);

    await assert.rejects(registerProject(options), ProjectAlreadyRegisteredError);

    assert.deepEqual(readFileSync(placementPath), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project command reaches no provider adapters", () => {
  const reachable = walkStaticImports(["core/src/cli/commands/project.ts"]);
  const adapters = [...reachable].filter((module) => module.startsWith("core/src/adapters/"));
  assert.deepEqual(adapters, []);
});

test("the committed catalog and config agree on this repository slug", () => {
  const root = repoRoot();
  const committedCatalog = loadCatalog(readFileSync(join(root, "awsf.project.yaml"), "utf8"));
  const configuredProject = loadConfig(readFileSync(join(root, "awsf.config.yaml"), "utf8"));

  assert.equal(committedCatalog.project.slug, configuredProject.project.slug);
});

function requireDirectory(path: string): void {
  // A catalog root is enough for these host-only tests. Registration must not
  // probe it for Git state, clone discovery, or worktrees.
  mkdirSync(path, { recursive: true });
}

const STATIC_IMPORT = /\bimport\s+(?!type\b)(?:["']([^"']+)["']|[\s\S]*?\bfrom\s+["']([^"']+)["'])|\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;

function walkStaticImports(entrypoints: readonly string[]): Set<string> {
  const reachable = new Set<string>();
  const pending = [...entrypoints];

  while (pending.length > 0) {
    const module = pending.pop();
    assert.ok(module !== undefined);
    if (reachable.has(module)) continue;
    reachable.add(module);
    if (!module.startsWith("core/src/")) continue;

    const sourcePath = join(repoRoot(), module);
    assert.ok(existsSync(sourcePath), `static import graph module does not exist: ${module}`);
    const source = readFileSync(sourcePath, "utf8");
    STATIC_IMPORT.lastIndex = 0;
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      assert.ok(specifier !== undefined);
      pending.push(specifier.startsWith(".") ? resolveLocalImport(sourcePath, specifier) : specifier);
    }
  }
  return reachable;
}

function resolveLocalImport(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base) === "" ? [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")] : [base];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  assert.ok(resolved !== undefined, `cannot resolve ${JSON.stringify(specifier)} from ${relRepo(importer)}`);
  return relRepo(resolved);
}
