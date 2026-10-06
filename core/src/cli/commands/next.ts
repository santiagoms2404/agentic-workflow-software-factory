import { assertNextSteps, type NextSteps } from "../../contracts/next-steps.ts";
import { nextSteps } from "../../lifecycle/next-steps.ts";
import { renderNextSteps } from "../../lifecycle/renderer.ts";
import { readAttempt } from "./attempt.ts";

/** Read the status projection only: no lock, journal, SQLite or owner terminal. */
export async function nextCommand(attemptDir: string): Promise<{ readonly model: NextSteps; readonly lines: readonly string[] }> {
  const status = await readAttempt(attemptDir);
  const model = nextSteps({ ...status, state: status.lifecycleState });
  assertNextSteps(model);
  return { model, lines: renderNextSteps(model, status) };
}
