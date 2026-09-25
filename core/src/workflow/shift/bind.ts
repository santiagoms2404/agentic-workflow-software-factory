import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILD_OUTPUT_SCHEMA_ID } from "../../contracts/build-output.ts";
import { REVIEW_CONTEXT_SCHEMA_ID } from "../../contracts/review-context.ts";
import { REVIEW_OUTPUT_SCHEMA_ID } from "../../contracts/review-output.ts";
import { TEST_OUTPUT_SCHEMA_ID } from "../../contracts/test-output.ts";
import type { ShiftManifest } from "../../contracts/shift-selection-record.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import type { PhaseDefinition } from "../phase.ts";
import { compileShift, type ShiftCompileConfig } from "./compile.ts";

// The binding between an attempt and its sealed selection. `compile.ts` stays
// pure; this is the one place a shift's ticket bytes are read, so the first
// run, `awsf start` and every recovery rebuild the recipe from the same
// source. The bytes come from the canonical repository, whose HEAD recovery
// already pins to the attempt's base, never from the worktree the builders
// are changing. A ticket edited after selection refuses the compile by digest
// (INV-4) rather than silently running other words.

/** Compiles the recipe an attempt's recorded selection names. */
export async function bindShiftRecipe(
  repository: string,
  manifest: ShiftManifest,
  config: ShiftCompileConfig,
): Promise<WorkflowRecipe> {
  const bodies = new Map<string, Uint8Array>();
  for (const ticket of manifest.tickets) bodies.set(ticket.id, await readFile(join(repository, ticket.path)));
  return compileShift(manifest, bodies, config);
}

/**
 * The ticket a compiled phase belongs to, or null for the shared review tail
 * and for any recipe that is not a shift. Membership is read off the recipe's
 * own structure, a brief opening each ticket's group, and never off the shape
 * of a phase id.
 */
export function shiftTicketOf(phases: readonly PhaseDefinition[], phaseId: string): string | null {
  let current: string | null = null;
  for (const phase of phases) {
    if ("ticketId" in phase && typeof phase.ticketId === "string") current = phase.ticketId;
    else if (phase.schemaId === REVIEW_CONTEXT_SCHEMA_ID) current = null;
    if (phase.id === phaseId) return current;
  }
  return null;
}

/**
 * The shipped phase whose role a compiled shift phase repeats, or null for a
 * phase no shift compiled. The runner keys its output-ownership table, its
 * builder gates and its commit message by that role, so a ticket's build is
 * held to exactly the write, diff and risk checks a shipped builder is, and
 * can never slip past them for carrying a compiled id.
 */
export function shiftPhaseRole(phases: readonly PhaseDefinition[], phaseId: string): string | null {
  const phase = phases.find((candidate) => candidate.id === phaseId);
  if (phase === undefined || !phases.some((candidate) => "ticketId" in candidate)) return null;
  if ("ticketId" in phase) return "request";
  if (phase.schemaId === BUILD_OUTPUT_SCHEMA_ID) return "builder";
  if (phase.schemaId === TEST_OUTPUT_SCHEMA_ID) return "tests";
  if (phase.schemaId === REVIEW_CONTEXT_SCHEMA_ID) return "review-context";
  if (phase.schemaId === REVIEW_OUTPUT_SCHEMA_ID) return "reviewer";
  return null;
}
