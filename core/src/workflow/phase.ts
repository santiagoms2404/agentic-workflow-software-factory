import type { TSchema } from "@sinclair/typebox";
import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { GateReport } from "../gates/interface.ts";
import type { PhaseSession, PhaseState } from "../state/phase-machine.ts";

export type PhaseKind = "agent" | "code" | "engineer";

export interface PhaseContext {
  readonly workflowId: string;
  readonly phaseId: string;
  readonly worktree: string;
  readonly previousEnvelope: EnvelopeBase | null;
}

export interface PhaseGateContext<TOutput extends EnvelopeBase = EnvelopeBase> extends PhaseContext {
  readonly envelope: TOutput;
  readonly correctionRound: number;
}

export interface GateDefinition<TOutput extends EnvelopeBase = EnvelopeBase> {
  readonly id: string;
  run(context: PhaseGateContext<TOutput>): Promise<GateReport> | GateReport;
}

interface PhaseBase<TOutput extends EnvelopeBase> {
  readonly id: string;
  readonly kind: PhaseKind;
  readonly owner: string;
  readonly description: string;
  readonly schemaId: string;
  readonly outputSchema: TSchema;
  readonly maxCorrections: number;
  readonly gates: readonly GateDefinition<TOutput>[];
}

export interface AgentPhaseDefinition<TOutput extends EnvelopeBase = EnvelopeBase> extends PhaseBase<TOutput> {
  readonly kind: "agent";
  /** Must contain {output_schema}; {previous_envelope} is host-rendered when present. */
  readonly prompt: string;
}

export interface LocalPhaseDefinition<TOutput extends EnvelopeBase = EnvelopeBase> extends PhaseBase<TOutput> {
  readonly kind: "code" | "engineer";
  execute(context: PhaseContext): Promise<TOutput>;
}

export type PhaseDefinition<TOutput extends EnvelopeBase = EnvelopeBase> =
  | AgentPhaseDefinition<TOutput>
  | LocalPhaseDefinition<TOutput>;

export interface CompiledAgentPhase<TOutput extends EnvelopeBase = EnvelopeBase>
  extends Omit<AgentPhaseDefinition<TOutput>, "prompt"> {
  readonly promptTemplate: string;
  renderPrompt(previousEnvelope: EnvelopeBase | null): string;
}

export type CompiledPhase<TOutput extends EnvelopeBase = EnvelopeBase> =
  | CompiledAgentPhase<TOutput>
  | LocalPhaseDefinition<TOutput>;

/** A phase starts non-successful. Only `succeed` after validation can earn success. */
export class PhaseExecution {
  readonly phaseId: string;
  readonly #onState: ((state: PhaseState) => void) | undefined;
  #state: PhaseState = "QUEUED";

  constructor(phaseId: string, onState?: (state: PhaseState) => void) {
    this.phaseId = phaseId;
    this.#onState = onState;
    this.#onState?.(this.#state);
  }

  #set(state: PhaseState): void {
    this.#state = state;
    this.#onState?.(state);
  }

  get state(): PhaseState {
    return this.#state;
  }

  running(): void {
    if (this.#state !== "QUEUED" && this.#state !== "CORRECTING") {
      throw new Error(`phase ${this.phaseId}: cannot run from ${this.#state}`);
    }
    this.#set("RUNNING");
  }

  validating(): void {
    if (this.#state !== "RUNNING") throw new Error(`phase ${this.phaseId}: cannot validate from ${this.#state}`);
    this.#set("VALIDATING");
  }

  correcting(): void {
    if (this.#state !== "VALIDATING") throw new Error(`phase ${this.phaseId}: cannot correct from ${this.#state}`);
    this.#set("CORRECTING");
  }

  succeed(): void {
    if (this.#state !== "VALIDATING") throw new Error(`phase ${this.phaseId}: success was not earned through validation`);
    this.#set("SUCCEEDED");
  }

  fail(): void {
    if (this.#state !== "SUCCEEDED" && this.#state !== "SKIPPED" && this.#state !== "CANCELLED") {
      this.#set("FAILED");
    }
  }
}

export interface AgentSessionIdentity extends PhaseSession {}
