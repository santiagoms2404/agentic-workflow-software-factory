import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { runGit, systemGitRunner } from "../git/changes.ts";
import { loadCatalog } from "./catalog.ts";
import type { ProjectCatalog } from "./catalog-schema.ts";
import { readPlacement } from "./placement.ts";
import { resolveProject } from "./resolve.ts";
import { contractRequirementsForRepository, type ContractGateRequirement } from "./contracts.ts";

interface CatalogAtRevision {
  readonly catalog: ProjectCatalog;
  readonly commit: string;
}

export interface TrustedContractBaseline {
  readonly schema: "awsf.trusted-contract-baseline/v1";
  readonly projectSlug: string;
  readonly sourceKind: "attempt-base" | "registered-plan";
  readonly sourceRepository: string;
  readonly sourceRepositoryId: string | null;
  readonly participantRepositoryId: string | null;
  readonly sourceCommit: string;
  readonly requirements: readonly ContractGateRequirement[];
}

function catalogAtRevision(repository: string, revision: string): CatalogAtRevision | null {
  const git = systemGitRunner(repository);
  const commit = runGit(git, ["rev-parse", "--verify", `${revision}^{commit}`]).trim();
  const entries = runGit(git, ["ls-tree", "-z", commit, "--", "awsf.project.yaml"]).split("\0").filter(Boolean);
  if (entries.length === 0) return null;
  if (entries.length !== 1 || !entries[0]!.startsWith("100644 blob ")) {
    throw new Error(`registered catalog at ${repository} is not one regular tracked file`);
  }
  return { catalog: loadCatalog(runGit(git, ["show", `${commit}:awsf.project.yaml`])), commit };
}

function missingPlacement(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sameRequirements(left: readonly ContractGateRequirement[], right: readonly ContractGateRequirement[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other !== undefined && item.id === other.id && item.role === other.role && item.path === other.path && item.digest === other.digest;
  });
}

function validateBaselineShape(value: TrustedContractBaseline): void {
  if (value === null || typeof value !== "object" || value.schema !== "awsf.trusted-contract-baseline/v1" ||
      typeof value.projectSlug !== "string" || !["attempt-base", "registered-plan"].includes(value.sourceKind) ||
      typeof value.sourceRepository !== "string" || value.sourceRepository.length === 0 ||
      (value.sourceRepositoryId !== null && typeof value.sourceRepositoryId !== "string") ||
      (value.participantRepositoryId !== null && typeof value.participantRepositoryId !== "string") ||
      !/^[a-f0-9]{40}$/u.test(value.sourceCommit) || !Array.isArray(value.requirements)) {
    throw new Error("trusted contract baseline is malformed");
  }
  for (const requirement of value.requirements) {
    if (requirement === null || typeof requirement !== "object" || typeof requirement.id !== "string" ||
        (requirement.role !== "produces" && requirement.role !== "consumes") || typeof requirement.path !== "string" ||
        typeof requirement.digest !== "string") throw new Error("trusted contract baseline requirements are malformed");
  }
}

function freezeBaseline(input: Omit<TrustedContractBaseline, "schema">): TrustedContractBaseline {
  return Object.freeze({ schema: "awsf.trusted-contract-baseline/v1", ...input,
    requirements: Object.freeze(input.requirements.map(requirement => Object.freeze({ ...requirement }))) });
}

function localBaseline(input: { repository: string; baseSha: string; projectSlug: string }): TrustedContractBaseline {
  const repository = realpathSync(resolve(input.repository));
  const source = catalogAtRevision(repository, input.baseSha);
  if (source === null) return freezeBaseline({ projectSlug: input.projectSlug, sourceKind: "attempt-base",
    sourceRepository: repository, sourceRepositoryId: null, participantRepositoryId: null,
    sourceCommit: input.baseSha, requirements: [] });
  if (source.catalog.project.slug !== input.projectSlug) {
    throw new Error(`attempt project ${JSON.stringify(input.projectSlug)} differs from the pinned repository catalog ${JSON.stringify(source.catalog.project.slug)}`);
  }
  if ((source.catalog.contracts ?? []).length === 0) return freezeBaseline({ projectSlug: input.projectSlug, sourceKind: "attempt-base",
    sourceRepository: repository, sourceRepositoryId: null, participantRepositoryId: null,
    sourceCommit: source.commit, requirements: [] });
  const plan = Object.entries(source.catalog.repositories).find(([, candidate]) => candidate.role === "plan");
  if (plan === undefined) throw new Error("pinned catalog has no registered plan repository");
  return freezeBaseline({ projectSlug: input.projectSlug, sourceKind: "attempt-base", sourceRepository: repository,
    sourceRepositoryId: null, participantRepositoryId: plan[0], sourceCommit: source.commit,
    requirements: contractRequirementsForRepository(source.catalog, plan[0]) });
}

async function resolveCurrentBaseline(input: {
  readonly repository: string;
  readonly baseSha: string;
  readonly projectSlug: string;
  readonly stateRoot: string;
}): Promise<TrustedContractBaseline> {
  const placement = await readPlacement(input.stateRoot, input.projectSlug).catch((error: unknown) => {
    if (missingPlacement(error)) return null;
    throw error;
  });
  if (placement === null) return localBaseline(input);

  const planCatalogs: Array<{ repositoryId: string; repository: string; source: CatalogAtRevision }> = [];
  for (const [repositoryId, located] of Object.entries(placement.repositories)) {
    const repository = realpathSync(located.path);
    const sourceRevision = repository === realpathSync(input.repository) ? input.baseSha : "HEAD";
    const source = catalogAtRevision(repository, sourceRevision);
    if (source === null || source.catalog.project.slug !== input.projectSlug) continue;
    if (source.catalog.repositories[repositoryId]?.role === "plan") planCatalogs.push({ repositoryId, repository, source });
  }
  if (planCatalogs.length !== 1) {
    throw new Error(`registered project ${JSON.stringify(input.projectSlug)} must have exactly one catalog in its registered plan repository; found ${planCatalogs.length}`);
  }

  const selected = planCatalogs[0];
  if (selected === undefined) throw new Error("registered plan catalog disappeared during resolution");
  const { source } = selected;
  const project = resolveProject(source.catalog, placement, input.stateRoot);
  const repositoryRoot = realpathSync(resolve(input.repository));
  const participant = Object.values(project.repositories).find(repository => realpathSync(repository.path) === repositoryRoot);
  if (participant === undefined) {
    throw new Error(`attempt repository ${JSON.stringify(input.repository)} is not a registered repository in project ${JSON.stringify(input.projectSlug)}`);
  }
  return freezeBaseline({ projectSlug: input.projectSlug, sourceKind: "registered-plan", sourceRepository: selected.repository,
    sourceRepositoryId: selected.repositoryId, participantRepositoryId: participant.id, sourceCommit: source.commit,
    requirements: contractRequirementsForRepository(source.catalog, participant.id) });
}

async function verifyPinnedBaseline(input: {
  readonly repository: string;
  readonly baseSha: string;
  readonly projectSlug: string;
  readonly stateRoot: string;
}, baseline: TrustedContractBaseline): Promise<TrustedContractBaseline> {
  validateBaselineShape(baseline);
  if (baseline.projectSlug !== input.projectSlug) throw new Error("trusted contract baseline belongs to another project");
  let resolved: TrustedContractBaseline;
  if (baseline.sourceKind === "attempt-base") {
    if (realpathSync(resolve(input.repository)) !== baseline.sourceRepository || baseline.sourceCommit !== input.baseSha ||
        baseline.sourceRepositoryId !== null) throw new Error("trusted attempt-base contract baseline binding changed");
    resolved = localBaseline(input);
  } else {
    if (baseline.sourceRepositoryId === null || baseline.participantRepositoryId === null) {
      throw new Error("registered trusted contract baseline is missing repository identity");
    }
    const placement = await readPlacement(input.stateRoot, input.projectSlug);
    const located = placement.repositories[baseline.sourceRepositoryId];
    if (located === undefined || realpathSync(located.path) !== baseline.sourceRepository) {
      throw new Error("registered trusted contract baseline repository placement changed");
    }
    const source = catalogAtRevision(baseline.sourceRepository, baseline.sourceCommit);
    if (source === null || source.catalog.project.slug !== input.projectSlug ||
        source.catalog.repositories[baseline.sourceRepositoryId]?.role !== "plan") {
      throw new Error("registered trusted contract baseline catalog is unavailable or changed");
    }
    const project = resolveProject(source.catalog, placement, input.stateRoot);
    const repositoryRoot = realpathSync(resolve(input.repository));
    const participant = Object.values(project.repositories).find(repository => realpathSync(repository.path) === repositoryRoot);
    if (participant === undefined || participant.id !== baseline.participantRepositoryId) {
      throw new Error("registered trusted contract baseline participant changed");
    }
    resolved = freezeBaseline({ projectSlug: input.projectSlug, sourceKind: "registered-plan",
      sourceRepository: baseline.sourceRepository, sourceRepositoryId: baseline.sourceRepositoryId,
      participantRepositoryId: participant.id, sourceCommit: source.commit,
      requirements: contractRequirementsForRepository(source.catalog, participant.id) });
  }
  if (resolved.sourceKind !== baseline.sourceKind || resolved.sourceRepository !== baseline.sourceRepository ||
      resolved.sourceRepositoryId !== baseline.sourceRepositoryId || resolved.participantRepositoryId !== baseline.participantRepositoryId ||
      resolved.sourceCommit !== baseline.sourceCommit || !sameRequirements(resolved.requirements, baseline.requirements)) {
    throw new Error("trusted contract baseline requirements or source SHA changed");
  }
  return resolved;
}

/** Resolve once, then verify a journal-pinned source commit rather than consulting a moving HEAD. */
export async function trustedContractBaselineForAttempt(input: {
  readonly repository: string;
  readonly baseSha: string;
  readonly projectSlug: string;
  readonly stateRoot: string;
}, pinned?: TrustedContractBaseline): Promise<TrustedContractBaseline> {
  return pinned === undefined ? resolveCurrentBaseline(input) : verifyPinnedBaseline(input, pinned);
}

/** Compatibility read for callers that need requirements but do not persist a baseline. */
export async function trustedContractRequirementsForAttempt(input: {
  readonly repository: string;
  readonly baseSha: string;
  readonly projectSlug: string;
  readonly stateRoot: string;
}): Promise<readonly ContractGateRequirement[]> {
  return (await trustedContractBaselineForAttempt(input)).requirements;
}
