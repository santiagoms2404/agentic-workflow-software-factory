// Adoption journeys prepare the fresh target through the real K1 commands.
// No production bypass: the first retry is refused with a DRAFT target, then
// preflight and the scripted owner confirmation authorize the second retry.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { adoptCommand as adopt, type AdoptCommandOptions } from "../../src/cli/commands/adopt.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { StartPreflightRefused } from "../../src/cli/commands/start.ts";
import { prepareK1 } from "./k1-preflight.ts";

export async function adoptUnderK1(options: AdoptCommandOptions) {
  try { return await adopt(options); }
  catch (error) {
    if (!(error instanceof StartPreflightRefused) || error.refusal !== "no-record") throw error;
    const source = await readAttempt(options.sourceAttemptDir);
    const attemptDir = join(options.stateRoot, "projects", source.project, "tasks", options.targetTaskId, "1");
    const configPath = join(dirname(options.stateRoot), "adoption-k1-config.yaml");
    writeFileSync(configPath, stringify(options.config));
    await prepareK1({ attemptDir, configPath, worktreeRoot: options.worktreeRoot,
      ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }) });
    return adopt(options);
  }
}
