import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import {
  PREVIOUS_ENVELOPE_PLACEHOLDER,
  injectOutputSchema,
} from "../contracts/json-schema.ts";
import { schemaForId } from "../contracts/registry.ts";
import { admitWorkflow } from "../execution/call-budget.ts";
import type { ResolvedCeiling, Tier } from "../state/tiers.ts";
import type {
  AgentPhaseDefinition,
  CompiledAgentPhase,
  CompiledPhase,
  PhaseDefinition,
} from "./phase.ts";

export class InvalidPhaseDescription extends Error {
  readonly phaseId: string;

  constructor(phaseId: string, reason: string) {
    super(`phase ${JSON.stringify(phaseId)} needs an earned description: ${reason}`);
    this.name = "InvalidPhaseDescription";
    this.phaseId = phaseId;
  }
}

export class MissingPreviousEnvelopePlaceholder extends Error {
  readonly phaseId: string;

  constructor(phaseId: string) {
    super(`phase ${JSON.stringify(phaseId)} receives a previous envelope but its prompt omits ${PREVIOUS_ENVELOPE_PLACEHOLDER}`);
    this.name = "MissingPreviousEnvelopePlaceholder";
    this.phaseId = phaseId;
  }
}

export class InvalidPhaseDefinition extends Error {
  readonly phaseId: string;

  constructor(phaseId: string, reason: string) {
    super(`invalid phase ${JSON.stringify(phaseId)}: ${reason}`);
    this.name = "InvalidPhaseDefinition";
    this.phaseId = phaseId;
  }
}

const RESTATEMENT_FILLER = new Set(["a", "an", "the", "to"]);

/** Normalizes the way the SSSF rule compares an id with the sentence shown in traces. */
export function normalizePhaseDescription(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !RESTATEMENT_FILLER.has(word))
    .join(" ");
}

export function assertEarnedDescription(phaseId: string, description: string): void {
  if (description.trim().length === 0) throw new InvalidPhaseDescription(phaseId, "it is blank");
  const normalizedId = normalizePhaseDescription(phaseId);
  const normalizedDescription = normalizePhaseDescription(description);
  if (normalizedDescription.length === 0 || normalizedDescription === normalizedId) {
    throw new InvalidPhaseDescription(
      phaseId,
      `normalized description ${JSON.stringify(normalizedDescription)} merely restates the phase id`,
    );
  }
}

function renderPrevious(phaseId: string, template: string, previous: EnvelopeBase | null): string {
  if (previous !== null && !template.includes(PREVIOUS_ENVELOPE_PLACEHOLDER)) {
    throw new MissingPreviousEnvelopePlaceholder(phaseId);
  }
  const rendered = previous === null ? "null" : JSON.stringify(previous, null, 2);
  return template.split(PREVIOUS_ENVELOPE_PLACEHOLDER).join(rendered);
}

function compileAgent<T extends EnvelopeBase>(phase: AgentPhaseDefinition<T>): CompiledAgentPhase<T> {
  const promptTemplate = injectOutputSchema(phase.prompt, phase.schemaId);
  return Object.freeze({
    ...phase,
    promptTemplate,
    renderPrompt(previousEnvelope: EnvelopeBase | null): string {
      return renderPrevious(phase.id, promptTemplate, previousEnvelope);
    },
  });
}

export function compilePhase<T extends EnvelopeBase>(phase: PhaseDefinition<T>): CompiledPhase<T> {
  assertEarnedDescription(phase.id, phase.description);
  if (phase.id.trim().length === 0) throw new InvalidPhaseDefinition(phase.id, "id is blank");
  if (phase.owner.trim().length === 0) throw new InvalidPhaseDefinition(phase.id, "owner is blank");
  if (!Number.isInteger(phase.maxCorrections) || phase.maxCorrections < 0) {
    throw new InvalidPhaseDefinition(phase.id, "maxCorrections must be a non-negative integer");
  }
  if (schemaForId(phase.schemaId) !== phase.outputSchema) {
    throw new InvalidPhaseDefinition(phase.id, "outputSchema is not the registered TypeBox source for schemaId");
  }
  return phase.kind === "agent" ? compileAgent(phase) : Object.freeze({ ...phase });
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly phases: readonly PhaseDefinition[];
}

/** A shipped recipe declares the tier whose controls and ceiling it was designed for. */
export interface WorkflowRecipe extends WorkflowDefinition {
  readonly tier: Tier;
}

export interface CompiledWorkflow {
  readonly id: string;
  readonly minimumCalls: number;
  readonly phases: readonly CompiledPhase[];
}

/** Compiles all construction-time invariants before any provider can execute. */
export function compileWorkflow(
  workflow: WorkflowDefinition,
  tier: Tier,
  committedCalls = 0,
  /** The attempt's own ceiling, so a raise the owner already granted is honoured here too. */
  resolvedCeiling?: ResolvedCeiling,
): CompiledWorkflow {
  const ids = new Set<string>();
  for (const phase of workflow.phases) {
    if (ids.has(phase.id)) throw new InvalidPhaseDefinition(phase.id, "phase ids must be unique");
    ids.add(phase.id);
  }
  const minimumCalls = workflow.phases.filter((phase) => phase.kind === "agent").length;
  admitWorkflow({ id: workflow.id, minimumCalls }, tier, committedCalls, resolvedCeiling);
  return Object.freeze({
    id: workflow.id,
    minimumCalls,
    phases: Object.freeze(workflow.phases.map((phase) => compilePhase(phase))),
  });
}
