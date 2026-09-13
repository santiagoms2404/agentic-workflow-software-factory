import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AwsfConfig } from "../../config/schema.ts";
import { loadConfig } from "../../config/load.ts";
import { toConfigSnapshotJson } from "../../config/effective-config.ts";
import type { CandidateSeed } from "../../contracts/candidate-seed.ts";
import { canonicalJson, createOwnerAmendment, ownerText, sha256 } from "../../contracts/owner-amendment.ts";
import { AttemptLock } from "../../persistence/attempt-lock.ts";
import { callCeilingsOf } from "../../state/tiers.ts";
import { CandidateSeedRejected, builderSeedBinding, inspectSeedSource, validateInheritedSeed, type ProcessQuiescence } from "../../workflow/candidate-seed.ts";
import type { OwnerTerminal } from "../tty.ts";
import { taskRoot, type AttemptProjector } from "./attempt.ts";
import { newCommand } from "./new.ts";

export interface SeedCommandOptions {
  readonly stateRoot: string;
  readonly project: string;
  readonly repository: string;
  readonly targetTaskId: string;
  readonly sourceTaskId: string;
  readonly sourceAttempt: number;
  readonly candidateSha: string;
  readonly request: string;
  readonly workflow: string;
  readonly instruction?: string;
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly terminal: OwnerTerminal;
  readonly projectRecord?: AttemptProjector;
  readonly quiescence?: ProcessQuiescence;
  readonly now?: () => string;
  readonly sessionId?: () => string;
}

/** Owner-selected committed seed. No worktree, provider, or source mutation. */
export async function seedCommand(options: SeedCommandOptions) {
  if (!options.terminal.interactive) throw new CandidateSeedRejected("requires an interactive owner terminal");
  if (!Number.isSafeInteger(options.sourceAttempt) || options.sourceAttempt < 1) throw new CandidateSeedRejected("source attempt must be a positive integer");
  if (options.targetTaskId === options.sourceTaskId) throw new CandidateSeedRejected("target must be a distinct task");
  if (options.project !== options.config.project.slug) throw new CandidateSeedRejected("project/config mismatch");
  ownerText(options.request);
  if (options.instruction !== undefined) ownerText(options.instruction);
  const sourceDir = join(taskRoot(options.stateRoot, options.project, options.sourceTaskId), String(options.sourceAttempt));
  const targetRoot = taskRoot(options.stateRoot, options.project, options.targetTaskId);
  const targetAbsent = () => {
    if (existsSync(targetRoot)) throw new CandidateSeedRejected("target already exists, including incomplete creation evidence");
  };
  targetAbsent();
  const selection = { project: options.project, taskId: options.sourceTaskId, attempt: options.sourceAttempt, candidateSha: options.candidateSha };
  const source = await inspectSeedSource(sourceDir, options.repository, selection, options.quiescence);
  const configSnapshot = toConfigSnapshotJson(options.config);
  const binding = await builderSeedBinding(options.config, options.configPath, options.workflow);
  const inherited = validateInheritedSeed(options.repository, {
    workflow: options.workflow, integrationBaseSha: source.baseSha, seedCandidateSha: source.candidateSha,
  }, options.config);
  const targetSession = (options.sessionId ?? randomUUID)();
  const authorizationId = randomUUID();
  options.terminal.write(`Sealed source: ${options.project}/${options.sourceTaskId} attempt ${options.sourceAttempt}, revision ${source.status.revision}`);
  options.terminal.write(`Exact seed: ${source.candidateSha}. Integration base: ${source.baseSha}.`);
  options.terminal.write(`Target: ${options.project}/${options.targetTaskId}, workflow ${options.workflow}, T2, zero spent/reserved calls.`);
  options.terminal.write(`Inherited paths: ${JSON.stringify(inherited)}`);
  options.terminal.write(`Fresh owner request: ${JSON.stringify(options.request)}`);
  if (options.instruction !== undefined) options.terminal.write(`Supplement to ${binding.builderPhaseKey} (${binding.builderPhaseOrdinal}): ${JSON.stringify(options.instruction)}`);
  options.terminal.write("No source gates, grants, review, journey, spend or provider session transfer. The target must build a new candidate and earn fresh review, journey and landing approval.");
  if (!await options.terminal.confirm(`Seed new task ${options.targetTaskId} from exact candidate ${source.candidateSha}?`)) {
    return { confirmed: false as const, status: null, attemptDir: null };
  }
  targetAbsent();
  // Lock only the prospective target. A sealed source is never opened for write.
  return new AttemptLock(join(dirname(targetRoot), `.seed-create-${options.targetTaskId}.lock`)).withLock(async () => {
    targetAbsent();
    const currentConfig = loadConfig(await readFile(options.configPath, "utf8"));
    if (toConfigSnapshotJson(currentConfig) !== configSnapshot || canonicalJson(await builderSeedBinding(currentConfig, options.configPath, options.workflow)) !== canonicalJson(binding)) {
      throw new CandidateSeedRejected("configuration or builder prompt changed after confirmation");
    }
    const repeated = await inspectSeedSource(sourceDir, options.repository, selection, options.quiescence);
    if (repeated.journalDigest !== source.journalDigest) throw new CandidateSeedRejected("source journal changed after confirmation");
    validateInheritedSeed(options.repository, { workflow: options.workflow, integrationBaseSha: source.baseSha, seedCandidateSha: source.candidateSha }, currentConfig);
    const confirmedAt = (options.now ?? (() => new Date().toISOString()))();
    const requestDigest = sha256(options.request);
    const seed: CandidateSeed = {
      schema: "awsf.candidate-seed/v1", authorizationId, confirmedAt,
      source: { project: options.project, taskId: options.sourceTaskId, attempt: options.sourceAttempt,
        sessionId: source.status.sessionId, revision: source.status.revision, journalDigest: source.journalDigest,
        lifecycle: source.status.lifecycleState as "BLOCKED" | "CANCELLED" },
      target: { project: options.project, taskId: options.targetTaskId, attempt: 1, sessionId: targetSession },
      integrationBaseSha: source.baseSha, seedCandidateSha: source.candidateSha, workflow: options.workflow,
      configDigest: sha256(configSnapshot), requestDigest, ...binding,
      ownerAmendment: options.instruction === undefined ? null : createOwnerAmendment({
        id: randomUUID(), text: options.instruction, confirmedAt,
        binding: { project: options.project, taskId: options.targetTaskId, attempt: 1, sessionId: targetSession,
          entry: "seed", authorizationId, anchorId: null, operationId: authorizationId,
          phaseKey: binding.builderPhaseKey, phaseOrdinal: binding.builderPhaseOrdinal, logicalTurnId: null,
          correctionRound: 0, originalRequestDigest: requestDigest, originalPromptBundleDigest: binding.builderPromptBundleDigest,
          priorAmendmentDigest: null, deliveryFrontier: "first-builder-input" },
      }),
    };
    const result = await newCommand({ stateRoot: options.stateRoot, project: options.project, taskId: options.targetTaskId,
      continuesTask: options.sourceTaskId, repository: options.repository, request: options.request, workflow: options.workflow, tier: 2,
      configSnapshotJson: configSnapshot, callCeilings: callCeilingsOf(currentConfig.risk.call_ceiling), allowance: currentConfig.risk.correction_allowance,
      seed, sessionId: () => targetSession, now: () => confirmedAt,
      ...(options.projectRecord === undefined ? {} : { projectRecord: options.projectRecord }),
    });
    return { confirmed: true as const, ...result };
  });
}
