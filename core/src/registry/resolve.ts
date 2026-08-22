import { defaultWorktreeRoot } from "../cli/commands/start.ts";
import type { GateEntry } from "../config/schema.ts";
import type { ConfiguredCommand } from "../gates/commands.ts";
import { runGit, systemGitRunner } from "../git/changes.ts";
import type { ProjectCatalog } from "./catalog-schema.ts";
import type { Placement } from "./placement-schema.ts";

type CatalogRepository = ProjectCatalog["repositories"][string];
type CatalogPlan = ProjectCatalog["plans"];
type CatalogContract = NonNullable<ProjectCatalog["contracts"]>[number];

export interface ResolvedConfiguredCommand extends ConfiguredCommand {
  readonly timeout_seconds: number;
}

export interface ResolvedRepository {
  readonly id: string;
  readonly path: string;
  readonly worktreeRoot: string;
  readonly role: CatalogRepository["role"];
  readonly defaultBranch: string;
  readonly identity?: CatalogRepository["identity"];
  readonly delivery?: CatalogRepository["delivery"];
  readonly gates: readonly ResolvedConfiguredCommand[];
}

export interface ResolvedProject {
  readonly slug: string;
  readonly repositories: Readonly<Record<string, ResolvedRepository>>;
  readonly plans: CatalogPlan;
  readonly contracts: readonly CatalogContract[];
  gatesFor(repositoryId: string): readonly ResolvedConfiguredCommand[];
}

export class ProjectResolutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProjectResolutionError";
  }
}

export class ProjectSlugMismatchError extends ProjectResolutionError {
  constructor(catalogSlug: string, placementSlug: string) {
    super(
      "E_PROJECT_SLUG_MISMATCH",
      `placement project ${JSON.stringify(placementSlug)} does not match catalog project ${JSON.stringify(catalogSlug)}; register the catalog under the matching project slug`,
    );
    this.name = "ProjectSlugMismatchError";
  }
}

export class UnplacedRepositoryError extends ProjectResolutionError {
  readonly repositoryId: string;

  constructor(repositoryId: string) {
    super(
      "E_PROJECT_UNPLACED_REPOSITORY",
      `catalog repository ${JSON.stringify(repositoryId)} has no placement; add it with \`awsf project register --catalog <path-to-awsf.project.yaml> --repository ${repositoryId}=<absolute-path>\``,
    );
    this.name = "UnplacedRepositoryError";
    this.repositoryId = repositoryId;
  }
}

export class OrphanPlacementError extends ProjectResolutionError {
  readonly repositoryId: string;

  constructor(repositoryId: string) {
    super(
      "E_PROJECT_ORPHAN_PLACEMENT",
      `placement repository ${JSON.stringify(repositoryId)} is absent from the catalog; remove that entry from the machine-local placement or declare it in the catalog`,
    );
    this.name = "OrphanPlacementError";
    this.repositoryId = repositoryId;
  }
}

export class RepositoryIdentityMismatchError extends ProjectResolutionError {
  readonly repositoryId: string;
  readonly expectedRootCommit: string;
  readonly observedRootCommits: readonly string[];

  constructor(repositoryId: string, path: string, expectedRootCommit: string, observedRootCommits: readonly string[]) {
    const observed = observedRootCommits.length === 0
      ? "no root commit"
      : observedRootCommits.map((root) => JSON.stringify(root)).join(", ");
    super(
      "E_PROJECT_REPOSITORY_IDENTITY_MISMATCH",
      `repository ${JSON.stringify(repositoryId)} at ${JSON.stringify(path)} must have the single root commit ${JSON.stringify(expectedRootCommit)}; observed ${observed}; correct its placement or catalog identity`,
    );
    this.name = "RepositoryIdentityMismatchError";
    this.repositoryId = repositoryId;
    this.expectedRootCommit = expectedRootCommit;
    this.observedRootCommits = Object.freeze([...observedRootCommits]);
  }
}

function configuredCommands(repository: CatalogRepository): readonly ResolvedConfiguredCommand[] {
  const entries = Object.entries(repository.gates ?? {}) as [string, GateEntry][];
  return Object.freeze(entries.map(([gateId, gate]) => Object.freeze({
    gateId,
    argv: Object.freeze([...gate.argv]),
    timeout_seconds: gate.timeout_seconds,
  })));
}

function verifyIdentity(repositoryId: string, path: string, expectedRootCommit: string): void {
  let roots: readonly string[];
  try {
    roots = runGit(systemGitRunner(path), ["rev-list", "--max-parents=0", "HEAD"])
      .split(/\r?\n/u)
      .map((root) => root.trim())
      .filter((root) => root.length > 0);
  } catch {
    throw new RepositoryIdentityMismatchError(repositoryId, path, expectedRootCommit, []);
  }
  if (roots.length !== 1 || roots[0] !== expectedRootCommit) {
    throw new RepositoryIdentityMismatchError(repositoryId, path, expectedRootCommit, roots);
  }
}

/** Joins durable project identity to machine-local repository placement. */
export function resolveProject(catalog: ProjectCatalog, placement: Placement, stateRoot: string): ResolvedProject {
  const slug = catalog.project.slug;
  if (placement.project !== slug) throw new ProjectSlugMismatchError(slug, placement.project);

  const catalogIds = Object.keys(catalog.repositories);
  const placementIds = Object.keys(placement.repositories);
  for (const repositoryId of catalogIds) {
    if (placement.repositories[repositoryId] === undefined) throw new UnplacedRepositoryError(repositoryId);
  }
  for (const repositoryId of placementIds) {
    if (catalog.repositories[repositoryId] === undefined) throw new OrphanPlacementError(repositoryId);
  }

  const fallbackWorktreeRoot = defaultWorktreeRoot(stateRoot);
  const repositories: Record<string, ResolvedRepository> = {};
  for (const repositoryId of catalogIds) {
    const declared = catalog.repositories[repositoryId]!;
    const located = placement.repositories[repositoryId]!;
    if (declared.identity !== undefined) {
      verifyIdentity(repositoryId, located.path, declared.identity.root_commit);
    }
    repositories[repositoryId] = Object.freeze({
      id: repositoryId,
      path: located.path,
      worktreeRoot: located.worktree_root ?? placement.worktree_root ?? fallbackWorktreeRoot,
      role: declared.role,
      defaultBranch: declared.default_branch,
      identity: declared.identity,
      delivery: declared.delivery,
      gates: configuredCommands(declared),
    });
  }
  Object.freeze(repositories);

  return Object.freeze({
    slug,
    repositories,
    plans: catalog.plans,
    contracts: Object.freeze([...(catalog.contracts ?? [])]),
    gatesFor(repositoryId: string): readonly ResolvedConfiguredCommand[] {
      const repository = repositories[repositoryId];
      if (repository === undefined) throw new RangeError(`unknown resolved repository: ${repositoryId}`);
      return repository.gates;
    },
  });
}
