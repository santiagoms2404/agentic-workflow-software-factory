import { BUILD_OUTPUT_SCHEMA_ID } from "../contracts/build-output.ts";
import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import {
  PREVIOUS_ENVELOPE_PLACEHOLDER,
  injectOutputSchema,
} from "../contracts/json-schema.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../contracts/review-output.ts";
import { schemaForId } from "../contracts/registry.ts";
import { admitWorkflow } from "../execution/call-budget.ts";
import type { ResolvedCeiling, Tier } from "../state/tiers.ts";
import type {
  AgentPhaseDefinition,
  CompiledAgentPhase,
  CompiledPhase,
  PhaseDefinition,
} from "./phase.ts";
import { InvalidReviewInversion } from "./review-routing.ts";

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

export class InvalidReviewBuildProducerCount extends Error {
  readonly count: number;
  readonly phaseIds: readonly string[];

  constructor(phaseIds: readonly string[]) {
    super(
      `a workflow with a review phase requires at least one build-producing agent phase ` +
        `with schema ${JSON.stringify(BUILD_OUTPUT_SCHEMA_ID)}, all on one provider; found ${phaseIds.length}` +
        (phaseIds.length === 0 ? "" : ` (${phaseIds.join(", ")})`),
    );
    this.name = "InvalidReviewBuildProducerCount";
    this.count = phaseIds.length;
    this.phaseIds = Object.freeze([...phaseIds]);
  }
}

/** The build producers of one review resolved to more than one provider. */
export class ReviewBuildProvidersDisagree extends InvalidReviewInversion {
  readonly providers: readonly { readonly provider: string; readonly phaseIds: readonly string[] }[];

  constructor(providers: readonly { readonly provider: string; readonly phaseIds: readonly string[] }[]) {
    super(
      "every build producer must resolve to one provider for the review to invert against; " +
        providers.map(({ provider, phaseIds }) => `${phaseIds.join(", ")} on ${JSON.stringify(provider)}`).join("; "),
    );
    this.name = "ReviewBuildProvidersDisagree";
    this.providers = Object.freeze(providers.map(({ provider, phaseIds }) =>
      Object.freeze({ provider, phaseIds: Object.freeze([...phaseIds]) })));
  }
}

/**
 * A review inverts against the provider that built the candidate. The rule
 * that guards it is: the build producers resolve to exactly one distinct
 * provider.
 *
 * It used to read "exactly one build-producing agent phase". The runner only
 * ever used that phase to look up a provider, so the phase count was
 * incidental. A shift has one builder per ticket, and the inversion is as well
 * defined for N builders on one provider as for one builder.
 *
 * The compiler knows phases, not providers, so the rule is checked in two
 * places. Here, a review with no build producer is refused, and because
 * `compileWorkflowStructure` calls this, recovery refuses it too.
 * `reviewWorkerProvider` is the provider half: the runner calls it once every
 * route is resolved and before any process starts, and it refuses producers
 * on more than one provider, naming each phase.
 *
 * What it still refuses: a review with no build producer, and build producers
 * on two or more providers. What it no longer refuses: several build producers
 * on one provider, even on different models of that provider, because
 * inversion is by provider. The count check alone is "at least one", which is
 * why the provider half is not optional.
 */
function reviewBuildPhaseIds(phases: readonly PhaseDefinition[]): readonly string[] {
  const hasReview = phases.some(
    (phase) => phase.kind === "agent" && phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID,
  );
  if (!hasReview) return Object.freeze([]);

  const buildPhaseIds = phases
    .filter((phase) => phase.kind === "agent" && phase.schemaId === BUILD_OUTPUT_SCHEMA_ID)
    .map((phase) => phase.id);
  if (buildPhaseIds.length === 0) throw new InvalidReviewBuildProducerCount(buildPhaseIds);
  return Object.freeze(buildPhaseIds);
}

/**
 * The one provider every build producer resolves to, which the review inverts
 * against. `providerFor` is the caller's route lookup, so this stays pure.
 */
export function reviewWorkerProvider(
  compiled: Pick<CompiledWorkflow, "reviewBuildPhaseIds">,
  providerFor: (phaseId: string) => string,
): string {
  if (compiled.reviewBuildPhaseIds.length === 0) throw new InvalidReviewBuildProducerCount([]);
  const byProvider = new Map<string, string[]>();
  for (const phaseId of compiled.reviewBuildPhaseIds) {
    const provider = providerFor(phaseId);
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), phaseId]);
  }
  if (byProvider.size !== 1) {
    throw new ReviewBuildProvidersDisagree([...byProvider].map(([provider, phaseIds]) => ({ provider, phaseIds })));
  }
  return [...byProvider.keys()][0]!;
}

export interface CompiledWorkflow {
  readonly id: string;
  readonly minimumCalls: number;
  /**
   * The build producer an optional review inverts against, when there is
   * exactly one. Null with no review phase, and null when several producers
   * share the review: none of them alone is the worker, and a reader that
   * took one would skip the check `reviewWorkerProvider` makes.
   */
  readonly reviewBuildPhaseId: string | null;
  /** Every build producer a review covers, in phase order. Empty with no review phase. */
  readonly reviewBuildPhaseIds: readonly string[];
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
  const compiled = compileWorkflowStructure(workflow);
  admitWorkflow(compiled, tier, committedCalls, resolvedCeiling);
  return compiled;
}

/** Recovery preserves the whole recipe while admitting only its unstarted calls. */
export function compileWorkflowStructure(workflow: WorkflowDefinition): CompiledWorkflow {
  const ids = new Set<string>();
  for (const phase of workflow.phases) {
    if (ids.has(phase.id)) throw new InvalidPhaseDefinition(phase.id, "phase ids must be unique");
    ids.add(phase.id);
  }
  const minimumCalls = workflow.phases.filter((phase) => phase.kind === "agent").length;
  const buildPhaseIds = reviewBuildPhaseIds(workflow.phases);
  return Object.freeze({
    id: workflow.id,
    minimumCalls,
    reviewBuildPhaseId: buildPhaseIds.length === 1 ? buildPhaseIds[0]! : null,
    reviewBuildPhaseIds: buildPhaseIds,
    phases: Object.freeze(workflow.phases.map((phase) => compilePhase(phase))),
  });
}
