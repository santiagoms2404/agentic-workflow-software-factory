import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { EnvelopeBase } from "../../src/contracts/envelope-base.ts";
import { PlanOutputSchema } from "../../src/contracts/plan-output.ts";
import { schemaForId } from "../../src/contracts/registry.ts";
import { sealShiftManifest, type ShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { parsePlanTicketBody, ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import {
  InvalidPhaseDescription,
  InvalidReviewBuildProducerCount,
  assertEarnedDescription,
  compilePhase,
  compileWorkflowStructure,
} from "../../src/workflow/compiler.ts";
import type { CompiledAgentPhase, PhaseContext } from "../../src/workflow/phase.ts";
import { reducePhaseContext } from "../../src/workflow/phase-recovery.ts";
import { loadUserPrompt } from "../../src/workflow/recipe-support.ts";
import {
  compileShift,
  serializeShiftRecipe,
  ShiftCompileRefusal,
  ShiftManifestInvalid,
  ShiftTicketBytesMismatch,
  ShiftTicketDigestMismatch,
  ShiftTicketUnreadable,
  type ShiftBriefPhase,
  type ShiftRecipe,
} from "../../src/workflow/shift/compile.ts";

// The compiler is pure, so every input is built here as bytes. Titles and
// prompts are distinct per ticket so any cross-wiring shows up by value.

const PLAN = "fixture-shift";
const CONFIG = { prompts: { builder: loadUserPrompt("builder"), reviewer: loadUserPrompt("reviewer") } };
const CHILD_SCRIPT = join(import.meta.dirname, "_shift-compile-child.ts");

function ticketSource(id: string, extra: { title?: string; handoff?: string; frontmatterId?: string } = {}): string {
  const title = extra.title ?? `Ticket ${id} does its own distinct work`;
  const handoff = extra.handoff ?? `_Empty at authoring time._\n\n### 2026-09-25 — from earlier\n\n**C1. ${id} must use the renamed file.**`;
  return [
    "---",
    `id: ${extra.frontmatterId ?? id}`,
    `title: ${JSON.stringify(title)}`,
    "milestone: M2",
    "state: todo",
    "depends_on: []",
    "---",
    `# ${id} · ${title}`,
    "",
    "## Handoff",
    "",
    handoff,
    "",
    "## Build prompt",
    "",
    "```",
    `TASK ${id}. Build the ${id} widget.`,
    `DONE WHEN`,
    `  the ${id} widget test is green`,
    "```",
    "",
  ].join("\n");
}

interface Fixture {
  readonly manifest: ShiftManifest;
  readonly bodies: Map<string, Uint8Array>;
  readonly sources: Map<string, string>;
}

function fixture(ids: readonly string[], overrides: Record<string, string> = {}): Fixture {
  const sources = new Map(ids.map((id) => [id, overrides[id] ?? ticketSource(id)]));
  const bodies = new Map([...sources].map(([id, source]) => [id, Buffer.from(source, "utf8")] as const));
  const manifest = sealShiftManifest({
    plan: PLAN,
    milestones: ["M2"],
    tickets: ids.map((id) => ({ id, path: `specs/tickets/${PLAN}/${id}.md`, digest: ticketFileDigest(bodies.get(id)!) })),
  });
  return { manifest, bodies, sources };
}

function compile(ids: readonly string[]): ShiftRecipe {
  const { manifest, bodies } = fixture(ids);
  return compileShift(manifest, bodies, CONFIG);
}

const THREE = ["T01", "T02", "T03"] as const;

test("each ticket compiles to brief, build, tests in manifest order, then one review tail", () => {
  const recipe = compile(THREE);
  assert.equal(recipe.id, "shift");
  assert.deepEqual(recipe.phases.map((phase) => phase.id), [
    "t01-brief", "t01-build", "t01-tests",
    "t02-brief", "t02-build", "t02-tests",
    "t03-brief", "t03-build", "t03-tests",
    "shift-review-context", "shift-review",
  ]);
  const shape = recipe.phases.map((phase) => [phase.id.replace(/^t0\d-/u, ""), phase.kind, phase.owner, phase.schemaId, phase.maxCorrections, phase.gates.length]);
  const group = [
    ["brief", "engineer", "host", "awsf.plan-output/v1", 0, 0],
    ["build", "agent", "builder", "awsf.build-output/v1", 1, 0],
    ["tests", "code", "host", "awsf.test-output/v1", 0, 0],
  ];
  assert.deepEqual(shape, [
    ...group, ...group, ...group,
    ["shift-review-context", "code", "host", "awsf.review-context/v1", 0, 0],
    ["shift-review", "agent", "reviewer", "awsf.review-output/v1", 1, 0],
  ]);
  for (const phase of recipe.phases) {
    assert.equal(phase.outputSchema, schemaForId(phase.schemaId), `${phase.id} pairs its schemaId with the registered TypeBox source`);
  }
});

test("the manifest's ticket order is the phase order; the compiler does not re-sort", () => {
  const recipe = compile(["T03", "T01", "T02"]);
  assert.deepEqual(
    recipe.phases.filter((phase) => phase.kind === "agent").map((phase) => phase.id),
    ["t03-build", "t01-build", "t02-build", "shift-review"],
  );
});

test("minimumCalls === tickets.length + 1, asserted directly", () => {
  for (const count of [1, 2, 3, 5]) {
    const ids = Array.from({ length: count }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
    const recipe = compile(ids);
    assert.equal(recipe.phases.filter((phase) => phase.kind === "agent").length, count + 1, `${count} tickets`);
  }
  // The compiler's own count, at the one size its review rule admits today.
  const one = compileWorkflowStructure(compile(["T01"]));
  assert.equal(one.minimumCalls, 2);
  assert.equal(one.reviewBuildPhaseId, "t01-build");
});

test("more than one ticket meets reviewBuildPhaseId's single-producer rule, which T06 amends", () => {
  // Pinned so the amendment is seen to change it: until T06, a shift of N >= 2
  // cannot carry its review phase through compileWorkflowStructure at all.
  assert.throws(
    () => compileWorkflowStructure(compile(THREE)),
    (error: unknown) => error instanceof InvalidReviewBuildProducerCount
      && error.phaseIds.join(",") === "t01-build,t02-build,t03-build",
  );
});

test("every phase earns its description from the ticket's title, never its id", () => {
  const title = "Carry the widget through the gate";
  const { manifest, bodies } = fixture(["T01"], { T01: ticketSource("T01", { title }) });
  const recipe = compileShift(manifest, bodies, CONFIG);
  for (const phase of recipe.phases) {
    assert.doesNotThrow(() => compilePhase(phase), phase.id);
    if (phase.id.startsWith("t01-")) assert.ok(phase.description.includes(title), `${phase.id} names the ticket's title`);
  }
  // The rule the titles are there for: an id-only description is refused.
  assert.throws(() => assertEarnedDescription("t01-build", "T01 build"), InvalidPhaseDescription);
});

test("the brief carries the build prompt verbatim, then the handoff that corrects it, with no model", async () => {
  const { manifest, bodies, sources } = fixture(THREE);
  const recipe = compileShift(manifest, bodies, CONFIG);
  const brief = recipe.phases.find((phase) => phase.id === "t02-brief") as ShiftBriefPhase;
  const { text } = parsePlanTicketBody(sources.get("T02")!);
  assert.equal(brief.ticketId, "T02");
  assert.equal(brief.intent.goals[0], text, "the prompt is the ticket's own block, byte for byte");
  assert.ok(brief.intent.notesForNextPhase.endsWith("_Empty at authoring time._\n\n### 2026-09-25 — from earlier\n\n**C1. T02 must use the renamed file.**"));
  assert.ok(Value.Check(PlanOutputSchema, brief.intent));
  // The handoff reads after the prompt in the envelope a builder is shown.
  const rendered = JSON.stringify(brief.intent, null, 2);
  assert.ok(rendered.indexOf("TASK T02.") < rendered.indexOf("C1. T02 must use"));
  // Host-executed from the compiled bytes: the context is ignored, nothing is spawned.
  const context: PhaseContext = { workflowId: "shift", phaseId: brief.id, worktree: "/nonexistent", previousEnvelope: null };
  assert.equal(await brief.execute(context), brief.intent);
});

test("a ticket with no handoff section leaves the brief's notes empty", () => {
  const source = ticketSource("T01").replace(/## Handoff\n\n[\s\S]*?\n\n## Build prompt/u, "## Build prompt");
  const { manifest, bodies } = fixture(["T01"], { T01: source });
  const brief = compileShift(manifest, bodies, CONFIG).phases[0] as ShiftBriefPhase;
  assert.equal(brief.intent.notesForNextPhase, "");
});

function buildEnvelope(id: string): EnvelopeBase {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: `built ${id}`, artifacts: [],
    notesForNextPhase: "", changedFiles: [`src/${id}.ts`], implementationNotes: [`${id} done`], commandsRun: [],
    proposedCommitMessage: `feat: ${id}`,
  } as EnvelopeBase;
}

function testEnvelope(id: string): EnvelopeBase {
  return { schema: "awsf.test-output/v1", producerStatus: "success", summary: `gated ${id}`, artifacts: [], notesForNextPhase: "" };
}

test("reducePhaseContext is last-wins per schema across tickets, and the builder is rendered its own brief", () => {
  const recipe = compile(THREE);
  const briefs = new Map(recipe.phases
    .filter((phase): phase is ShiftBriefPhase => "intent" in phase)
    .map((phase) => [phase.ticketId, phase.intent] as const));
  // The accepted prefix up to, not including, t03-build.
  const accepted = new Map<string, EnvelopeBase>([
    ["t01-brief", briefs.get("T01")!], ["t01-build", buildEnvelope("t01")], ["t01-tests", testEnvelope("t01")],
    ["t02-brief", briefs.get("T02")!], ["t02-build", buildEnvelope("t02")], ["t02-tests", testEnvelope("t02")],
    ["t03-brief", briefs.get("T03")!],
  ]);
  const seeded = briefs.get("T01")!;
  const before = reducePhaseContext(accepted, seeded);

  // Last wins per schema: ticket n-1's build envelope, not ticket 1's, is the
  // build output in context when ticket n's builder starts.
  assert.equal(before.schemas.get("awsf.build-output/v1"), accepted.get("t02-build"));
  assert.equal(before.schemas.get("awsf.test-output/v1"), accepted.get("t02-tests"));
  assert.equal(before.schemas.get("awsf.plan-output/v1"), briefs.get("T03"));

  // {previous_envelope} is the LAST accepted envelope, which is ticket n's own
  // brief. Ticket n-1's build envelope reaches ticket n's builder only through
  // the schema map and the accumulated tree, not through {previous_envelope}.
  assert.equal(before.previous, briefs.get("T03"));
  const builder = compilePhase(recipe.phases.find((phase) => phase.id === "t03-build")!) as CompiledAgentPhase;
  const prompt = builder.renderPrompt(before.previous);
  assert.ok(prompt.includes(JSON.stringify("TASK T03. Build the T03 widget.\nDONE WHEN\n  the T03 widget test is green").slice(1, -1)));
  assert.ok(!prompt.includes("built t02"), "ticket n-1's build envelope is not rendered as {previous_envelope}");

  accepted.set("t03-build", buildEnvelope("t03"));
  const after = reducePhaseContext(accepted, seeded);
  assert.equal(after.schemas.get("awsf.build-output/v1"), accepted.get("t03-build"));
  assert.equal(after.previous, accepted.get("t03-build"));
});

test("every mismatch between the manifest and the supplied bytes is refused by name", () => {
  const { manifest, bodies } = fixture(THREE);

  const missing = new Map(bodies);
  missing.delete("T02");
  assert.throws(() => compileShift(manifest, missing, CONFIG),
    (error: unknown) => error instanceof ShiftTicketBytesMismatch && error.missing.join() === "T02");

  const extra = new Map(bodies).set("T09", Buffer.from(ticketSource("T09")));
  assert.throws(() => compileShift(manifest, extra, CONFIG),
    (error: unknown) => error instanceof ShiftTicketBytesMismatch && error.unexpected.join() === "T09");

  const moved = new Map(bodies).set("T03", Buffer.from(ticketSource("T03").replace("widget", "wodget")));
  assert.throws(() => compileShift(manifest, moved, CONFIG),
    (error: unknown) => error instanceof ShiftTicketDigestMismatch && error.ticket === "T03");

  assert.throws(() => compileShift({ ...manifest, milestones: ["M3"] }, bodies, CONFIG), ShiftManifestInvalid);
  assert.throws(() => compileShift({ ...manifest, tickets: [] }, bodies, CONFIG), ShiftManifestInvalid);

  const misfiled = fixture(["T01"], { T01: ticketSource("T01", { frontmatterId: "T07" }) });
  assert.throws(() => compileShift(misfiled.manifest, misfiled.bodies, CONFIG),
    (error: unknown) => error instanceof ShiftTicketUnreadable && error.ticket === "T01");

  for (const Refusal of [ShiftTicketBytesMismatch, ShiftTicketDigestMismatch, ShiftManifestInvalid, ShiftTicketUnreadable]) {
    assert.ok(Refusal.prototype instanceof ShiftCompileRefusal, Refusal.name);
  }
});

test("the tier is the T2 floor, raised by a declared ticket tier and never lowered by one", () => {
  const { manifest, bodies } = fixture(THREE);
  assert.equal(compileShift(manifest, bodies, CONFIG).tier, 2);
  const declared = sealShiftManifest({ ...manifest, tickets: manifest.tickets.map((ticket) => ({ ...ticket, tier: 0 as const })) });
  assert.equal(compileShift(declared, bodies, CONFIG).tier, 2);
});

test("the same manifest and bytes compile to a byte-identical recipe, in this process and a fresh one", async () => {
  const { manifest, bodies } = fixture(THREE);
  const first = serializeShiftRecipe(compileShift(manifest, bodies, CONFIG));
  const second = serializeShiftRecipe(compileShift(manifest, new Map(bodies), CONFIG));
  assert.equal(second, first);
  for (const id of THREE) assert.ok(first.includes(JSON.stringify(`TASK ${id}. Build the ${id} widget.\nDONE WHEN\n  the ${id} widget test is green`)));

  const directory = await mkdtemp(join(tmpdir(), "awsf-shift-compile-"));
  try {
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    for (const [id, bytes] of bodies) await writeFile(join(directory, `${id}.md`), bytes);
    const child = execFileSync(process.execPath, ["--experimental-strip-types", CHILD_SCRIPT, directory], { encoding: "utf8" });
    assert.equal(child, first, "a fresh process compiled different bytes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
