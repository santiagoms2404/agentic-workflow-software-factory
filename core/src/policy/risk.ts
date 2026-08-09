import type { RiskTierName } from "../config/schema.ts";
import { matchesPathGlob, normalizeRepositoryPath } from "./path-policy.ts";

export const RISK_TIERS = ["T0", "T1", "T2"] as const;

export interface RiskPolicy {
  readonly default: RiskTierName;
  readonly paths: Readonly<Record<string, RiskTierName>>;
}

export interface RiskClassification {
  readonly tier: RiskTierName;
  readonly source: "default" | "path" | "operator-override";
  readonly matched: readonly { path: string; glob: string; tier: RiskTierName }[];
  readonly classifiedTier: RiskTierName;
}

export interface OperatorRiskOverride {
  readonly tier: RiskTierName;
  /** An override is an auditable operator decision, never an inferred downgrade. */
  readonly reason: string;
}

function tierRank(tier: RiskTierName): number {
  return RISK_TIERS.indexOf(tier);
}

export function classifyRisk(
  paths: readonly string[],
  policy: RiskPolicy,
  override?: OperatorRiskOverride,
): RiskClassification {
  const normalized = [...new Set(paths.map(normalizeRepositoryPath))].sort();
  const matched: { path: string; glob: string; tier: RiskTierName }[] = [];
  let classifiedTier = policy.default;
  for (const path of normalized) {
    for (const [glob, tier] of Object.entries(policy.paths)) {
      if (!matchesPathGlob(path, glob)) continue;
      matched.push({ path, glob, tier });
      if (tierRank(tier) > tierRank(classifiedTier)) classifiedTier = tier;
    }
  }
  if (override !== undefined) {
    if (!override.reason.trim()) throw new Error("an operator risk override requires a reason");
    return Object.freeze({
      tier: override.tier,
      source: "operator-override",
      matched: Object.freeze(matched),
      classifiedTier,
    });
  }
  return Object.freeze({
    tier: classifiedTier,
    source: matched.length === 0 ? "default" : "path",
    matched: Object.freeze(matched),
    classifiedTier,
  });
}

export function tierForPaths(paths: readonly string[], policy: RiskPolicy): RiskTierName {
  return classifyRisk(paths, policy).tier;
}
