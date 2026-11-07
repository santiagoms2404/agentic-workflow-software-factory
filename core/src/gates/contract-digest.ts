import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readContractArtifactDigestSync } from "../contracts/artifact-digest.ts";
import { loadContractProjection, type ContractGateRequirement } from "../registry/contracts.ts";
import { GateReport } from "./interface.ts";

function errorText(error: unknown): string {
  const code = error instanceof Error && "code" in error ? String(error.code) : null;
  return code ?? (error instanceof Error ? error.message : String(error));
}

function within(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset !== "" && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function readArtifact(repositoryRoot: string, path: string): { readonly digest: string } | { readonly error: string } {
  try {
    const root = realpathSync(repositoryRoot);
    const candidate = resolve(root, path);
    if (!within(root, candidate)) return { error: "path escapes the candidate repository" };
    const target = realpathSync(candidate);
    if (!within(root, target)) return { error: "path resolves outside the candidate repository" };
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: "candidate artifact is not a regular file" };
    return readContractArtifactDigestSync(candidate, errorText);
  } catch (error) {
    return { error: errorText(error) };
  }
}

/**
 * Checks candidate projection bytes and artifacts against host-derived
 * requirements. With no registered requirement the optional projection is not
 * an authority and absence is a pass with no checks.
 */
export function contractDigest(
  repositoryRoot: string,
  requirements: readonly ContractGateRequirement[] = [],
): GateReport {
  const report = new GateReport("contract_digest", { passWhenEmpty: true });
  if (requirements.length === 0) return report;

  let projection: ReturnType<typeof loadContractProjection> | null = null;
  let projectionError: string | null = null;
  try {
    const projectionPath = join(repositoryRoot, "awsf.contracts.yaml");
    const stat = lstatSync(projectionPath);
    if (!stat.isFile() || stat.isSymbolicLink()) projectionError = "projection is not a regular file";
    else projection = loadContractProjection(readFileSync(projectionPath, "utf8"));
  } catch (error) {
    projectionError = errorText(error);
  }

  for (const requirement of requirements) {
    const entries = projection?.contracts.filter((entry) => entry.id === requirement.id) ?? [];
    const entry = entries[0];
    const projectionMatches = projectionError === null && entries.length === 1 && entry !== undefined &&
      entry.role === requirement.role && entry.path === requirement.path && entry.digest === requirement.digest;
    const artifact = readArtifact(repositoryRoot, requirement.path);
    const artifactMatches = "digest" in artifact && artifact.digest === requirement.digest;
    const projectionNote = projectionError !== null
      ? `projection=${projectionError}`
      : entries.length === 0
        ? "projection=required entry missing"
        : entries.length !== 1
          ? `projection=duplicate entries (${entries.length})`
          : `projection=${entry!.role}/${entry!.path}/${entry!.digest}`;
    const artifactNote = "digest" in artifact ? artifact.digest : artifact.error;
    report.check(
      `contract ${requirement.id}: ${requirement.path}`,
      projectionMatches && artifactMatches,
      `expected=${requirement.digest}; ${projectionNote}; artifact=${artifactNote}`,
    );
  }
  return report;
}
