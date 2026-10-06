import type { AwsfConfig } from "../../config/schema.ts";
import { assertNextSteps, type NextSteps } from "../../contracts/next-steps.ts";
import { nextSteps } from "../../lifecycle/next-steps.ts";
import { renderNextSteps } from "../../lifecycle/renderer.ts";
import { freshnessRefusals, k1Requirements, PREFLIGHT_RECORD_REQUIREMENT, type K1Requirement } from "../../preflight/fields.ts";
import { readAttempt, type AttemptStatus } from "./attempt.ts";
import { gatherFreshness, K1_EXEMPT_WORKFLOWS } from "./preflight.ts";

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

/** Read the status projection and, at DRAFT, K1's facts: no lock, write, SQLite or owner terminal. */
export async function nextCommand(attemptDir: string, k1?: NextK1Context): Promise<{ readonly model: NextSteps; readonly lines: readonly string[] }> {
  const status = await readAttempt(attemptDir);
  const measured = k1 !== undefined && status.lifecycleState === "DRAFT" && !K1_EXEMPT_WORKFLOWS.includes(status.workflow);
  const model = nextSteps({ ...status, state: status.lifecycleState, ...(measured ? { k1: await k1At(attemptDir, status, k1) } : {}) });
  assertNextSteps(model);
  return { model, lines: renderNextSteps(model, status) };
}
