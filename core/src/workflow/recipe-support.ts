import { readFileSync } from "node:fs";
import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { PhaseContext } from "./phase.ts";

export class UnboundLocalPhase extends Error {
  readonly phaseId: string;

  constructor(phaseId: string) {
    super(`local phase ${JSON.stringify(phaseId)} must be bound to a host executor before a workflow runs`);
    this.name = "UnboundLocalPhase";
    this.phaseId = phaseId;
  }
}

/** Recipes stay declarative; the owner CLI binds engineer/code execution in M6. */
export async function requireHostExecution<T extends EnvelopeBase>(
  phaseId: string,
  _context: PhaseContext,
): Promise<T> {
  throw new UnboundLocalPhase(phaseId);
}

/** Loads the same committed user prompt path named by awsf.config.yaml. */
export function loadUserPrompt(role: "scout" | "planner" | "builder" | "documenter" | "reviewer" | "intake"): string {
  return readFileSync(new URL(`../../../prompts/${role}/user.md`, import.meta.url), "utf8");
}
