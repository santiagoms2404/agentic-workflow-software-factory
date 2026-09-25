import { Value } from "@sinclair/typebox/value";
import { BuildOutputSchema } from "../../contracts/build-output.ts";
import { canonicalJson } from "../../contracts/owner-amendment.ts";
import { PlanOutputSchema, type PlanOutput } from "../../contracts/plan-output.ts";
import { ReviewContextSchema } from "../../contracts/review-context.ts";
import { ReviewOutputSchema } from "../../contracts/review-output.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import {
  ShiftManifestSchema,
  shiftManifestDigest,
  type ShiftManifest,
} from "../../contracts/shift-selection-record.ts";
import {
  parsePlanTicketBody,
  parsePlanTicketHandoff,
  parsePlanTicketIdentity,
  ticketFileDigest,
} from "../../persistence/plan-ticket-body.ts";
import type { Tier } from "../../state/tiers.ts";
import { assertEarnedDescription, type WorkflowRecipe } from "../compiler.ts";
import type { LocalPhaseDefinition, PhaseDefinition } from "../phase.ts";
import { requireHostExecution } from "../recipe-support.ts";

// The shift compiler: a sealed manifest and the ticket bytes it names become
// one recipe. It reads no file, no clock and no provider. The caller supplies
// every byte, so recovery can rebuild the recipe from the recorded manifest and
// the same files, or refuse when one byte moved (INV-4).
//
// Each ticket contributes brief → build → tests, in the manifest's order, which
// was fixed at selection and is not re-derived here. The brief is host-built
// from the ticket's own words: the owner wrote the prompt and it was reviewed,
// so no model is asked to restate it. One review-context and one review close
// the shift, so N tickets cost N + 1 provider calls.

export const SHIFT_WORKFLOW_ID = "shift";

/**
 * No v2 ticket set declares a tier, and both review-bearing shipped recipes
 * are T2. A shift is at least T2, raised by any tier a selected ticket
 * declares; a missing tier never lowers it.
 */
export const SHIFT_TIER_FLOOR: Tier = 2;

export interface ShiftCompileConfig {
  /** The committed builder and reviewer user prompts. The caller reads them; the compiler never does. */
  readonly prompts: { readonly builder: string; readonly reviewer: string };
}

/** A brief carries the intent it emits, so the recipe's bytes include every ticket's words. */
export interface ShiftBriefPhase extends LocalPhaseDefinition<PlanOutput> {
  readonly kind: "engineer";
  readonly ticketId: string;
  readonly intent: PlanOutput;
}

export interface ShiftRecipe extends WorkflowRecipe {
  readonly id: typeof SHIFT_WORKFLOW_ID;
  readonly manifestDigest: string;
  readonly phases: readonly PhaseDefinition[];
}

/** Every refusal below extends this, so a caller can catch the vocabulary whole. */
export abstract class ShiftCompileRefusal extends Error {}

/** The manifest fails its own schema or its digest no longer covers its body. */
export class ShiftManifestInvalid extends ShiftCompileRefusal {
  constructor(reason: string) {
    super(`shift manifest is invalid: ${reason}`);
    this.name = "ShiftManifestInvalid";
  }
}

/** The supplied ticket bytes and the manifest's ticket list are not the same set. */
export class ShiftTicketBytesMismatch extends ShiftCompileRefusal {
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];

  constructor(missing: readonly string[], unexpected: readonly string[]) {
    super(
      `ticket bytes do not match the manifest: ` +
        [
          missing.length === 0 ? null : `missing ${missing.join(", ")}`,
          unexpected.length === 0 ? null : `not in the manifest ${unexpected.join(", ")}`,
        ].filter((part) => part !== null).join("; "),
    );
    this.name = "ShiftTicketBytesMismatch";
    this.missing = Object.freeze([...missing]);
    this.unexpected = Object.freeze([...unexpected]);
  }
}

/** A ticket file moved after selection. The resume is refused rather than run against other words. */
export class ShiftTicketDigestMismatch extends ShiftCompileRefusal {
  readonly ticket: string;
  readonly expected: string;
  readonly actual: string;

  constructor(ticket: string, expected: string, actual: string) {
    super(`ticket ${ticket} changed since selection: manifest digest ${expected}, supplied bytes ${actual}`);
    this.name = "ShiftTicketDigestMismatch";
    this.ticket = ticket;
    this.expected = expected;
    this.actual = actual;
  }
}

/** The bytes under a manifest id are not that ticket: unreadable frontmatter, or another id. */
export class ShiftTicketUnreadable extends ShiftCompileRefusal {
  readonly ticket: string;

  constructor(ticket: string, reason: string) {
    super(`ticket ${ticket} cannot be compiled: ${reason}`);
    this.name = "ShiftTicketUnreadable";
    this.ticket = ticket;
  }
}

const UTF8 = new TextDecoder("utf-8", { ignoreBOM: true });

function briefIntent(id: string, title: string, prompt: string, handoff: string): PlanOutput {
  // Key order is the order a builder reads the rendered envelope in: the
  // prompt (goals) comes before the handoff (notesForNextPhase), because the
  // handoff was written later and corrects the prompt where they disagree.
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: `${id}: ${title}`,
    artifacts: [],
    goals: [prompt],
    notesForNextPhase: handoff.length === 0
      ? ""
      : `Handoff for ${id}, written after its build prompt. Where the two disagree, this wins:\n\n${handoff}`,
    nonGoals: ["Work that belongs to another ticket in this shift"],
    implementationSteps: [{
      id,
      title,
      files: [],
      acceptanceCriteria: ["The configured host gates pass against this ticket's own candidate commit"],
    }],
    testStrategy: ["Run the configured host quality commands against this ticket's candidate before the next ticket starts"],
    risks: [],
    openQuestions: [],
  };
}

function ticketPhases(id: string, bytes: Uint8Array, config: ShiftCompileConfig): PhaseDefinition[] {
  const source = UTF8.decode(bytes);
  const data = parsePlanTicketIdentity(source);
  if (data === null) throw new ShiftTicketUnreadable(id, "its frontmatter is missing or invalid");
  if (data.id !== id) throw new ShiftTicketUnreadable(id, `its frontmatter names ${data.id}`);
  const { text } = parsePlanTicketBody(source, id);
  const intent = Object.freeze(briefIntent(id, data.title, text, parsePlanTicketHandoff(source, id)));
  if (!Value.Check(PlanOutputSchema, intent)) throw new ShiftTicketUnreadable(id, "its brief is not a valid plan output");

  // A literal lower-casing, never a parse: ids are compared as written.
  const key = id.toLowerCase();
  const title = JSON.stringify(data.title);
  const brief: ShiftBriefPhase = {
    id: `${key}-brief`,
    kind: "engineer",
    owner: "host",
    description: `Carry ${id} ${title} into the shift verbatim, its build prompt first and its handoff after`,
    schemaId: "awsf.plan-output/v1",
    outputSchema: PlanOutputSchema,
    maxCorrections: 0,
    gates: [],
    ticketId: id,
    intent,
    execute: async () => intent,
  };
  return [
    brief,
    {
      id: `${key}-build`,
      kind: "agent",
      owner: "builder",
      description: `Build ${id} ${title} on the shift's accumulating head as its own host commit`,
      schemaId: "awsf.build-output/v1",
      outputSchema: BuildOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: config.prompts.builder,
    },
    {
      id: `${key}-tests`,
      kind: "code",
      owner: "host",
      description: `Gate ${id} ${title} against its own candidate before the next ticket may start`,
      schemaId: "awsf.test-output/v1",
      outputSchema: TestOutputSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution(`${key}-tests`, context),
    },
  ];
}

/** Compiles a sealed manifest and its ticket bytes into one shift recipe. Pure. */
export function compileShift(
  manifest: ShiftManifest,
  bodies: ReadonlyMap<string, Uint8Array>,
  config: ShiftCompileConfig,
): ShiftRecipe {
  if (!Value.Check(ShiftManifestSchema, manifest)) throw new ShiftManifestInvalid("it does not match awsf.shift-manifest/v1");
  if (shiftManifestDigest(manifest) !== manifest.manifestDigest) {
    throw new ShiftManifestInvalid("manifestDigest does not cover its plan, milestones and tickets");
  }
  const ids = manifest.tickets.map((ticket) => ticket.id);
  const missing = ids.filter((id) => !bodies.has(id));
  const unexpected = [...bodies.keys()].filter((id) => !ids.includes(id)).sort();
  if (missing.length > 0 || unexpected.length > 0) throw new ShiftTicketBytesMismatch(missing, unexpected);

  const phases: PhaseDefinition[] = [];
  for (const ticket of manifest.tickets) {
    const bytes = bodies.get(ticket.id)!;
    const actual = ticketFileDigest(bytes);
    if (actual !== ticket.digest) throw new ShiftTicketDigestMismatch(ticket.id, ticket.digest, actual);
    phases.push(...ticketPhases(ticket.id, bytes, config));
  }
  phases.push(
    {
      // A host phase: no call, and it exists because the one reviewer has one
      // envelope slot and must judge every ticket's work at once.
      id: "shift-review-context",
      kind: "code",
      owner: "host",
      description: "Compose the accumulated diff, every ticket's intent, and gate evidence for the single shift review",
      schemaId: "awsf.review-context/v1",
      outputSchema: ReviewContextSchema,
      maxCorrections: 0,
      gates: [],
      execute: (context) => requireHostExecution("shift-review-context", context),
    },
    {
      id: "shift-review",
      kind: "agent",
      owner: "reviewer",
      description: "Audit the shift's accumulated candidate on the provider opposite the builders and report concrete defects",
      schemaId: "awsf.review-output/v1",
      outputSchema: ReviewOutputSchema,
      maxCorrections: 1,
      gates: [],
      prompt: config.prompts.reviewer,
    },
  );

  for (const phase of phases) assertEarnedDescription(phase.id, phase.description);
  // Every budget decision in M3 is made against this number, so it is checked
  // here rather than left to follow from the loop above.
  const calls = phases.filter((phase) => phase.kind === "agent").length;
  if (calls !== manifest.tickets.length + 1) {
    throw new Error(`shift compiled ${calls} agent phases for ${manifest.tickets.length} tickets; expected ${manifest.tickets.length + 1}`);
  }
  const tier = manifest.tickets.reduce<Tier>((max, ticket) => Math.max(max, ticket.tier ?? max) as Tier, SHIFT_TIER_FLOOR);
  return Object.freeze({
    id: SHIFT_WORKFLOW_ID,
    tier,
    manifestDigest: manifest.manifestDigest,
    phases: Object.freeze(phases.map((phase) => Object.freeze(phase))),
  });
}

/**
 * The recipe's bytes: every field a run is shaped by, canonically ordered.
 * `outputSchema` is left out because `compilePhase` pins it to `schemaId`, and
 * `execute` because a brief's output is its `intent`, which is included.
 */
export function serializeShiftRecipe(recipe: ShiftRecipe): string {
  return canonicalJson({
    id: recipe.id,
    tier: recipe.tier,
    manifestDigest: recipe.manifestDigest,
    phases: recipe.phases.map((phase) => ({
      id: phase.id,
      kind: phase.kind,
      owner: phase.owner,
      description: phase.description,
      schemaId: phase.schemaId,
      maxCorrections: phase.maxCorrections,
      gates: phase.gates.map((gate) => gate.id),
      ...(phase.kind === "agent" ? { prompt: phase.prompt } : {}),
      ...("intent" in phase ? { intent: (phase as ShiftBriefPhase).intent } : {}),
    })),
  });
}
