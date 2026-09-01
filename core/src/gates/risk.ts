import type { RiskPolicy } from "../policy/risk.ts";
import { admitRisk } from "../policy/risk.ts";
import type { Tier } from "../state/tiers.ts";
import { GateReport } from "./interface.ts";

/**
 * `risk_tier_sufficient` — the attempt's tier against what `risk.paths` says
 * these paths are worth.
 *
 * Attached twice on a plan-carrying route: to the planner, against the files
 * the plan declares, so a refusal costs nothing beyond the plan call; and to
 * the builder, against what the candidate actually changed, because a plan that
 * named no risky path and a build that wrote one is the case a declaration
 * cannot catch.
 *
 * It does not raise the tier. Admitting an attempt at a higher tier mid-run
 * would widen its ceiling after the owner chose it; the honest move is to name
 * the glob and stop, which leaves `awsf retry` at the right tier available.
 */
export function riskTierSufficient(
  paths: readonly string[],
  tier: Tier,
  policy: RiskPolicy,
  subject: string,
): GateReport {
  const report = new GateReport("risk_tier_sufficient");
  const admission = admitRisk(paths, tier, policy);
  report.check(
    "declared paths sit inside the attempt's tier",
    admission.sufficient,
    admission.sufficient
      ? `${subject} ${String(paths.length)} path(s); risk.paths classifies them ${admission.classified}, and the attempt is T${String(tier)}`
      : `${subject} ${String(paths.length)} path(s) that risk.paths classifies ${admission.classified}, above this attempt's T${String(tier)}: ` +
        admission.raisedBy.map((match) => `${match.path} matches ${match.glob} (${match.tier})`).join("; ") +
        `; retry at --tier T${String(admission.classified.slice(1))} or narrow the change`,
  );
  return report;
}
