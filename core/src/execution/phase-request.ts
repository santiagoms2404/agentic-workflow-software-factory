import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition } from "../config/schema.ts";
import { isContinuityCapable, type ContinuityRef, type HarnessAdapter, type ModelRequest } from "../adapters/interface.ts";
import { ContinuityStore, continuityHandle } from "./continuity-store.ts";
import { continuityDigest, InterruptedTurnRefused } from "../contracts/interrupted-turn.ts";
import { sha256 } from "../contracts/owner-amendment.ts";
import type { BarrierRecord } from "./launcher-barrier.ts";

export type PhasePersistenceMode = "ephemeral" | "conversation-correction" | "interrupted-turn-retention" | "unavailable";

/** Retention is not a live-proof capability or permission for another correction. */
export function phasePersistenceMode(agent: AgentDefinition, adapter: HarnessAdapter): PhasePersistenceMode {
  if (agent.harness.continuity === "same-session") return isContinuityCapable(adapter) ? "conversation-correction" : "unavailable";
  if (agent.harness.interrupted_turn !== true) return "ephemeral";
  return isContinuityCapable(adapter) ? "interrupted-turn-retention" : "unavailable";
}

export interface PhasePersistenceEvidence {
  readonly requested: boolean;
  readonly mode: PhasePersistenceMode;
  readonly continuityHandle: string | null;
  readonly descriptorDigest: string;
  readonly originalInputDigest: string;
  readonly systemPromptDigest: string;
  readonly rescue: "continuity-not-enabled" | "proof-unavailable";
}

export function phasePersistenceEvidence(agent: AgentDefinition, adapter: HarnessAdapter, handle: string | null,
  spec: ReturnType<HarnessAdapter["buildSpec"]>, systemPrompt: string): PhasePersistenceEvidence {
  return { requested: agent.harness.interrupted_turn === true, mode: phasePersistenceMode(agent, adapter),
    continuityHandle: handle, descriptorDigest: continuityDigest(spec), originalInputDigest: sha256(spec.stdin),
    systemPromptDigest: sha256(systemPrompt),
    rescue: agent.harness.interrupted_turn === true ? "proof-unavailable" : "continuity-not-enabled" };
}

export interface PhaseRequestInput {
  readonly agent: AgentDefinition;
  readonly prompt: string;
  readonly systemPromptPath?: string;
  readonly cwd: string;
  readonly env: ModelRequest["env"];
  readonly continuity?: ModelRequest["continuity"];
}

/** The same request construction is used by production and external role proofs. */
export function buildPhaseRequest(input: PhaseRequestInput): ModelRequest {
  return {
    model: input.agent.model, prompt: input.prompt, cwd: input.cwd, env: input.env,
    effort: input.agent.thinking, profile: input.agent.tools.profile, tools: input.agent.tools.allow,
    ...(input.systemPromptPath === undefined ? {} : { systemPromptPath: input.systemPromptPath }),
    ...(input.continuity === undefined ? {} : { continuity: input.continuity }),
  };
}

export function redactPhaseProcess(record: BarrierRecord, store: ContinuityStore): BarrierRecord {
  const locators = [...store.locators()].sort((a, b) => b.length - a.length);
  if (locators.length === 0) return record;
  return { ...record, command: record.command.map((argument) =>
    locators.reduce((text, locator) => text.replaceAll(locator, "[continuity-ref]"), argument)) };
}

/** Cold turns never reopen one another, even when their transcripts are retained. */
export async function openRetainedColdTurn(input: {
  readonly agent: AgentDefinition;
  readonly adapter: HarnessAdapter;
  readonly store: ContinuityStore;
  readonly phaseKey: string;
  readonly round: number;
  readonly runtimeDir: string;
}): Promise<{ readonly handle: string; readonly ref: ContinuityRef } | null> {
  const mode = phasePersistenceMode(input.agent, input.adapter);
  if (mode === "unavailable") throw new InterruptedTurnRefused("proof-unavailable", "requested original persistence has no complete continuity transport");
  if (mode !== "interrupted-turn-retention") return null;
  if (!Number.isSafeInteger(input.round) || input.round < 0) throw new Error("invalid retained cold-turn round");
  if (!isContinuityCapable(input.adapter)) throw new Error("retention transport disappeared");
  const phaseId = `${input.phaseKey}:turn:${input.round}`;
  const storeDir = input.adapter.continuityStoreDir(join(input.runtimeDir, `turn-${input.round}`));
  if (storeDir !== null) await mkdir(storeDir, { recursive: true, mode: 0o700 });
  await input.store.open({ phaseId, adapter: input.adapter.id,
    provider: (await input.adapter.getModelInfo(input.agent.model)).provider,
    model: input.agent.model, storeDir });
  const handle = continuityHandle(phaseId);
  return { handle, ref: input.store.ref(handle) };
}
