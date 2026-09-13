// Owner-invoked role proof preparation. No workflow driving or provider launch.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import { registeredAdapter } from "../../../src/adapters/registry.ts";
import { isContinuityCapable } from "../../../src/adapters/interface.ts";
import { writeSystemPromptFile } from "../../../src/adapters/system-prompt-file.ts";
import type { DesignContext } from "../../../src/contracts/design-context.ts";
import type { EnvelopeBase } from "../../../src/contracts/envelope-base.ts";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { continuityDigest, InterruptedTurnRefused } from "../../../src/contracts/interrupted-turn.ts";
import { ContinuityStore, continuityHandle } from "../../../src/execution/continuity-store.ts";
import { buildPhaseRequest, openRetainedColdTurn, phasePersistenceEvidence } from "../../../src/execution/phase-request.ts";
import { openPermissionSession } from "../../../src/policy/sandbox-broker.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { compileWorkflow } from "../../../src/workflow/compiler.ts";
import { workflowRecipe } from "../../../src/workflow/catalog.ts";
import { productionPhaseRegistration, renderProductionRolePrompt } from "../../../src/cli/commands/production-run.ts";

export async function prepareRoleProbe(input: {
  readonly config: AwsfConfig;
  readonly configPath: string;
  readonly workflow: string;
  readonly role: string;
  readonly selection: "proof-low" | "configured";
  readonly previous: EnvelopeBase;
  readonly designContext?: DesignContext;
  readonly recordedRequest: string;
  readonly canonical: string;
  readonly worktree: string;
  readonly stateRoot: string;
  readonly runtime: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}) {
  const configured = input.config.agents.find((agent) => agent.name === input.role);
  const recipe = workflowRecipe(input.workflow);
  if (configured === undefined || recipe === null || !input.config.workflows.enabled.includes(recipe.id)) {
    throw new Error("proof role or workflow is not configured");
  }
  const index = recipe.phases.findIndex((phase) => phase.kind === "agent" && phase.owner === input.role);
  const definition = recipe.phases[index];
  if (definition === undefined || definition.kind !== "agent") throw new Error("role is not an agent phase of this workflow");
  const previousSchema = recipe.phases[index - 1]?.schemaId;
  if (previousSchema === undefined || !parseEnvelope(JSON.stringify(input.previous), previousSchema).valid) {
    throw new Error("proof input does not satisfy the production predecessor schema");
  }
  if (configured.harness.interrupted_turn !== true) throw new InterruptedTurnRefused("continuity-not-enabled", "role has not opted into original-turn retention");
  const entry = input.config.adapters[configured.harness.adapter];
  if (entry?.kind !== "claude-code" && entry?.kind !== "pi-codex") throw new InterruptedTurnRefused("proof-unavailable", "no reviewed proof route for this adapter kind");
  const agent = input.selection === "configured" ? configured : { ...configured,
    model: entry.kind === "claude-code" ? "claude:sonnet" : "codex:gpt-5.6-luna", thinking: "low" as const };
  const adapter = registeredAdapter(input.config.adapters, agent.harness.adapter, input.config.runtime);
  if (adapter === null || !isContinuityCapable(adapter)) throw new InterruptedTurnRefused("proof-unavailable", "configured adapter has no retention transport");
  if (input.role === "architecture-reviewer" && input.designContext === undefined) throw new Error("architecture review requires the original host repository context");
  if (input.designContext !== undefined && !parseEnvelope(JSON.stringify(input.designContext), "awsf.design-context/v1").valid) throw new Error("invalid host design context");
  const model = await adapter.getModelInfo(agent.model);
  const prompts = await composePromptBundle({ configPath: input.configPath, agent });
  const workflow = compileWorkflow({ ...recipe, phases: recipe.phases.map((phase, ordinal) =>
    ordinal === index ? { ...definition, prompt: prompts.userPrompt } : phase) }, recipe.tier);
  const phase = workflow.phases[index];
  if (phase?.kind !== "agent") throw new Error("compiled proof phase changed kind");
  const registrationFor = (runId: string, reservationId: string, taskSessionId: string) => productionPhaseRegistration({
    phaseId: phase.id, phaseOrdinal: index + 1, adapterId: agent.harness.adapter, role: agent.name,
    reservationId, runId, taskSessionId, workflowId: workflow.id,
    first: index === recipe.phases.findIndex(candidate => candidate.kind === "agent"),
    review: phase.schemaId === "awsf.review-output/v1",
  });
  await mkdir(input.runtime, { recursive: true, mode: 0o700 });
  const systemPromptPath = await writeSystemPromptFile(prompts.systemPrompt, input.runtime);
  const store = new ContinuityStore({ path: join(input.runtime, "continuity.json") });
  let retained = await openRetainedColdTurn({ agent, adapter, store, phaseKey: phase.id, round: 0, runtimeDir: input.runtime });
  if (agent.harness.continuity === "same-session") {
    const storeDir = adapter.continuityStoreDir(input.runtime);
    if (storeDir !== null) await mkdir(storeDir, { recursive: true, mode: 0o700 });
    await store.open({ phaseId: phase.id, adapter: adapter.id, provider: model.provider, model: model.requestedModel, storeDir });
    const handle = continuityHandle(phase.id);
    retained = { handle, ref: store.ref(handle) };
  }
  if (retained === null) throw new Error("proof role did not obtain its original retention descriptor");
  const request = buildPhaseRequest({ agent,
    prompt: renderProductionRolePrompt(phase, input.previous, input.designContext ?? null, input.recordedRequest, agent),
    systemPromptPath, cwd: input.worktree,
    env: Object.fromEntries(Object.entries(input.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    continuity: { ref: retained.ref, turn: "open" } });
  const permission = openPermissionSession({ canonicalRepository: input.canonical, worktree: input.worktree,
    sessionRuntime: input.runtime, stateRoot: input.stateRoot, profile: agent.tools.profile,
    tools: agent.tools.allow, writes: agent.writes, protectedPaths: input.config.policy.protected_paths });
  const grant = permission.sandbox(adapter.buildSpec(request));
  return { agent, adapter, phase, workflow, registrationFor, request, permission, grant, store,
    evidence: { workflow: recipe.id, phase: phase.id, ordinal: index + 1, role: agent.name,
      configuredModel: configured.model, configuredEffort: configured.thinking,
      selectedModel: agent.model, selectedEffort: agent.thinking, provider: model.provider,
      selection: input.selection, adapterId: agent.harness.adapter, adapterKind: adapter.id, configDigest: continuityDigest(input.config),
      predecessorDigest: continuityDigest(input.previous), promptComposition: prompts.evidence,
      profile: agent.tools.profile, tools: agent.tools.allow, writes: agent.writes,
      sandboxBadge: grant.badge, sandboxMechanism: grant.mechanism,
      persistence: phasePersistenceEvidence(agent, adapter, retained.handle, grant.spec, prompts.systemPrompt),
      releaseEligible: false as const,
    },
  };
}
