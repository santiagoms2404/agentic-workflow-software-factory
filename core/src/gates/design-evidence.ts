import { isAbsolute, relative, resolve } from "node:path";
import type { DesignContext } from "../contracts/design-context.ts";
import type { ResolvedProject, ResolvedRepository } from "../registry/resolve.ts";
import type { PhaseGateContext } from "../workflow/phase.ts";
import { GateReport } from "./interface.ts";

const EVIDENCE_LIMIT = "this proves which revisions were available to the designer, never which files it read";

function listed(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function isInside(path: string, root: string): boolean {
  const offset = relative(resolve(root), resolve(path));
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function targetCounts(context: DesignContext): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const target of context.targets) {
    counts.set(target.repositoryId, (counts.get(target.repositoryId) ?? 0) + 1);
  }
  return counts;
}

function targetMatchesRepository(
  target: DesignContext["targets"][number],
  repository: ResolvedRepository | undefined,
): boolean {
  return repository !== undefined
    && target.path === repository.path
    && target.defaultBranch === repository.defaultBranch
    && target.headSha.trim().length > 0;
}

/**
 * Proves that host-composed design evidence covers the resolved project before
 * a design call is reserved. This gate reads no filesystem: an exact resolved
 * registry path plus the host-observed head revision is the existence evidence.
 */
export function designEvidencePresent(
  context: PhaseGateContext<DesignContext>,
  catalog: ResolvedProject,
): GateReport {
  const report = new GateReport("design_evidence_present");
  const counts = targetCounts(context.envelope);
  const declaredIds = Object.keys(catalog.repositories).sort();
  const missing = declaredIds.filter((repositoryId) => (counts.get(repositoryId) ?? 0) === 0);
  const duplicate = declaredIds.filter((repositoryId) => (counts.get(repositoryId) ?? 0) > 1);
  const unexpected = [...counts.keys()].filter((repositoryId) => catalog.repositories[repositoryId] === undefined).sort();

  report.check(
    "every declared repository appears exactly once",
    missing.length === 0 && duplicate.length === 0 && unexpected.length === 0,
    missing.length === 0 && duplicate.length === 0 && unexpected.length === 0
      ? `${String(declaredIds.length)} catalog repository/repositories appear exactly once`
      : `missing: ${listed(missing)}; duplicate: ${listed(duplicate)}; unexpected: ${listed(unexpected)}`,
  );

  const unresolved = context.envelope.targets
    .filter((target) => !targetMatchesRepository(target, catalog.repositories[target.repositoryId]))
    .map((target) => target.repositoryId)
    .sort();
  report.check(
    "targets carry resolved paths and revisions",
    unresolved.length === 0,
    unresolved.length === 0
      ? `${String(context.envelope.targets.length)} target(s) match resolved registry paths and carry host-observed head revisions`
      : `unresolved or revisionless target(s): ${listed(unresolved)}`,
  );

  const planEntries = Object.entries(catalog.repositories)
    .filter(([, repository]) => repository.role === "plan");
  const planRepository = planEntries[0];
  const planTargetCount = planRepository === undefined ? 0 : (counts.get(planRepository[0]) ?? 0);
  report.check(
    "plan repository is a target",
    planEntries.length === 1 && planTargetCount === 1,
    planEntries.length === 1
      ? `plan repository ${planRepository![0]} appears ${String(planTargetCount)} time(s)`
      : `resolved catalog has ${String(planEntries.length)} plan repositories: ${listed(planEntries.map(([repositoryId]) => repositoryId))}`,
  );

  const worktreeBelongsToPlan = planRepository !== undefined
    && isInside(context.worktree, planRepository[1].worktreeRoot);
  report.check(
    "attempt worktree belongs to the plan repository",
    worktreeBelongsToPlan,
    planRepository === undefined
      ? `attempt worktree ${context.worktree} cannot be assigned because no plan repository resolved`
      : `attempt worktree ${context.worktree} ${worktreeBelongsToPlan ? "is inside" : "is outside"} ${planRepository[1].worktreeRoot} for ${planRepository[0]}`,
  );

  report.check(
    "revision evidence limit",
    true,
    `${String(context.envelope.targets.length)} repository revision(s) were available; ${EVIDENCE_LIMIT}`,
  );
  return report;
}
