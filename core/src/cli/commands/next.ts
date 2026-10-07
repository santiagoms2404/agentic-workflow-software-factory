import type { AwsfConfig } from "../../config/schema.ts";
import { assertNextSteps, type NextSteps } from "../../contracts/next-steps.ts";
import { nextSteps } from "../../lifecycle/next-steps.ts";
import { renderNextSteps } from "../../lifecycle/renderer.ts";
import { freshnessRefusals, k1Requirements, PREFLIGHT_RECORD_REQUIREMENT, type K1Requirement } from "../../preflight/fields.ts";
import { grantOwedAt, writingPhases } from "../../preflight/grant-plan.ts";
import { workflowRecipe } from "../../workflow/catalog.ts";
import { readProtectedState } from "../../workflow/protected-grants.ts";
import { readAttempt, type AttemptStatus } from "./attempt.ts";
import { gatherFreshness, K1_EXEMPT_WORKFLOWS } from "./preflight.ts";
import { readAttemptEvidence } from "./review-record.ts";

/** What K1's requirements on L1 are measured against. Without it, `requires` stays unmeasured and empty. */
export interface NextK1Context {
  readonly stateRoot: string;
  readonly worktreeRoot: string;
  readonly config: AwsfConfig;
}

/**
 * K1's requirements on L1 at DRAFT, gathered exactly as `awsf start` gathers
 * them and with reads only. A fact that cannot be measured is reported as
 * such, never as satisfied.
 */
async function k1At(attemptDir: string, status: AttemptStatus, context: NextK1Context): Promise<readonly K1Requirement[]> {
  try {
    const facts = await gatherFreshness({ attemptDir, status, ...context });
    return k1Requirements(freshnessRefusals(facts), facts.confirmations);
  } catch {
    return [{ check: "K1", field: PREFLIGHT_RECORD_REQUIREMENT, status: "unmeasured" }];
  }
}

/**
 * The protected grant the next unsettled writing phase owes, measured as the
 * runner measures it: the latest preflight record's plan against the recorded
 * grants. Null when none is owed, when the phase already holds its one grant
 * (no second can be issued), or when a fact cannot be read, which leaves the
 * grant step generic rather than claiming a requirement.
 */
async function grantOwedNow(attemptDir: string, status: AttemptStatus, config: AwsfConfig): Promise<{ readonly phase: string; readonly paths: readonly string[] } | null> {
  const recipe = workflowRecipe(status.workflow);
  if (recipe === null) return null;
  try {
    const preflight = (await readAttemptEvidence(attemptDir)).findLast((evidence) => evidence.type === "driver-preflight");
    if (preflight?.type !== "driver-preflight") return null;
    const grants = readProtectedState(attemptDir).grants.map((grant) => ({ id: grant.id, phase: grant.subject.phaseKey, files: grant.files.map((file) => file.path) }));
    const settled = new Set((status.recovery?.prefix ?? []).map((accepted) => accepted.phaseKey));
    const pending = writingPhases(recipe, config.agents).map((writer) => writer.phase).filter((phase) => !settled.has(phase));
    const owed = grantOwedAt(preflight.record.protectedPlan, grants, pending);
    return owed === null || owed.grantId !== null ? null : { phase: owed.phase, paths: owed.paths };
  } catch {
    return null;
  }
}

/** Read the status projection and, at DRAFT, K1's facts; at a grant boundary, the grant owed. No lock, write, SQLite or owner terminal. */
export async function nextCommand(attemptDir: string, k1?: NextK1Context): Promise<{ readonly model: NextSteps; readonly lines: readonly string[] }> {
  const status = await readAttempt(attemptDir);
  const measured = k1 !== undefined && status.lifecycleState === "DRAFT" && !K1_EXEMPT_WORKFLOWS.includes(status.workflow);
  const grantOwed = k1 !== undefined && (status.lifecycleState === "PREPARED" || status.recovery != null)
    ? await grantOwedNow(attemptDir, status, k1.config) : undefined;
  const model = nextSteps({ ...status, state: status.lifecycleState, ...(measured ? { k1: await k1At(attemptDir, status, k1) } : {}),
    ...(grantOwed === undefined ? {} : { grantOwed }) });
  assertNextSteps(model);
  return { model, lines: renderNextSteps(model, status) };
}
