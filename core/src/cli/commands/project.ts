import { access, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import { loadCatalog } from "../../registry/catalog.ts";
import type { ProjectCatalog } from "../../registry/catalog-schema.ts";
import { loadPlacement, readPlacement, writePlacement } from "../../registry/placement.ts";
import type { Placement } from "../../registry/placement-schema.ts";
import { resolveProject, type ResolvedProject } from "../../registry/resolve.ts";
import { placementFilePath } from "../../persistence/platform-paths.ts";

export interface RegisterProjectOptions {
  readonly stateRoot: string;
  readonly catalogPath: string;
  readonly repositories: readonly string[];
}

export class ProjectAlreadyRegisteredError extends Error {
  constructor(slug: string) {
    super(`project ${JSON.stringify(slug)} is already registered; refusing to replace its placement`);
    this.name = "ProjectAlreadyRegisteredError";
  }
}

function repositoryPaths(values: readonly string[]): Record<string, string> {
  const repositories: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const id = value.slice(0, separator);
    const path = value.slice(separator + 1);
    if (separator <= 0 || path.length === 0) {
      throw new Error(`--repository must be <id>=<absolute-path>; got ${JSON.stringify(value)}`);
    }
    if (repositories[id] !== undefined) throw new Error(`--repository was provided more than once for ${JSON.stringify(id)}`);
    repositories[id] = path;
  }
  return repositories;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function catalogAtRegisteredRoots(placement: Placement): Promise<ProjectCatalog> {
  for (const repository of Object.values(placement.repositories)) {
    const catalogPath = join(repository.path, "awsf.project.yaml");
    try {
      const catalog = loadCatalog(await readFile(catalogPath, "utf8"));
      if (catalog.project.slug === placement.project) return catalog;
    } catch {
      // A registered repository need not be the plan repository.
    }
  }
  throw new Error(`registered project ${JSON.stringify(placement.project)} has no readable catalog at an explicitly registered repository root`);
}

async function resolvedRegisteredProject(stateRoot: string, slug: string): Promise<ResolvedProject> {
  const placement = await readPlacement(stateRoot, slug);
  return resolveProject(await catalogAtRegisteredRoots(placement), placement, stateRoot);
}

/** Registers explicitly supplied clone paths after their catalog pair resolves. */
export async function registerProject(options: RegisterProjectOptions): Promise<ResolvedProject> {
  const catalog = loadCatalog(await readFile(options.catalogPath, "utf8"));
  const repositories = repositoryPaths(options.repositories);
  const missing = Object.keys(catalog.repositories).filter((id) => repositories[id] === undefined);
  if (missing.length > 0) throw new Error(`missing explicit --repository path for: ${missing.join(", ")}`);

  const placement = loadPlacement(toYaml({
    version: "awsf.placement/v1",
    project: catalog.project.slug,
    repositories: Object.fromEntries(Object.entries(repositories).map(([id, path]) => [id, { path }])),
  }));
  const placementPath = placementFilePath(options.stateRoot, catalog.project.slug);
  if (await fileExists(placementPath)) throw new ProjectAlreadyRegisteredError(catalog.project.slug);

  const resolved = resolveProject(catalog, placement, options.stateRoot);
  await writePlacement(options.stateRoot, catalog.project.slug, placement);
  return resolved;
}

/** Lists registered placements and whether their explicitly registered roots resolve as a project. */
export async function listProjects(stateRoot: string): Promise<readonly string[]> {
  let entries: readonly Dirent[];
  try {
    entries = await readdir(join(stateRoot, "projects"), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const placement = await readPlacement(stateRoot, entry.name);
      try {
        await resolvedRegisteredProject(stateRoot, entry.name);
        lines.push(`${placement.project}: ${Object.keys(placement.repositories).length} repository(ies), resolves: yes`);
      } catch {
        lines.push(`${placement.project}: ${Object.keys(placement.repositories).length} repository(ies), resolves: no`);
      }
    } catch {
      lines.push(`${entry.name}: placement unreadable`);
    }
  }
  return lines;
}

/** Reports every resolved repository record for one registered project. */
export async function showProject(stateRoot: string, slug: string): Promise<readonly string[]> {
  const project = await resolvedRegisteredProject(stateRoot, slug);
  return Object.values(project.repositories).map((repository) => {
    const gates = repository.gates.map((gate) => gate.gateId).join(",") || "none";
    return `${repository.id}: role=${repository.role}, branch=${repository.defaultBranch}, gates=${gates}, worktree_root=${repository.worktreeRoot}`;
  });
}
