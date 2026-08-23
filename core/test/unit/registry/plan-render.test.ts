import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import type { DesignPlanOutput } from "../../../src/contracts/design-plan-output.ts";
import type { PlanContext } from "../../../src/contracts/plan-context.ts";
import { renderPlanDocument, type PlanDocumentEnvelope } from "../../../src/registry/plan-render.ts";
import { spineCoverage } from "../../../src/registry/plan-spine.ts";
import { parseAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";

const envelope: PlanDocumentEnvelope = {
  stem: "rendered-plan",
  plan: {
    schema: "awsf.design-plan-output/v1",
    producerStatus: "success",
    summary: "Render a plan safely",
    artifacts: [],
    notesForNextPhase: "Render the validated plan.",
    milestones: [
      { id: "M1", title: "First milestone" },
      { id: "M2", title: "Second milestone" },
    ],
    steps: [
      {
        id: "T01",
        title: "Parse title: preserve its colon",
        milestone: "M1",
        files: ["core/src/registry/plan-render.ts"],
        serves: ["INV-1"],
        dependsOn: [],
        buildPrompt: "Use `parseAwsfPlanHtmlV1` for the round trip.",
      },
      {
        id: "T02",
        title: "Cover the acceptance criterion",
        milestone: "M2",
        files: ["core/test/unit/registry/plan-render.test.ts"],
        serves: ["AC-1"],
        dependsOn: ["T01"],
        buildPrompt: "Keep rendered tickets byte-identical to Section B.",
      },
    ],
    testStrategy: ["Round-trip the rendered plan."],
    risks: [],
    openQuestions: [],
  } satisfies DesignPlanOutput,
  identifierSet: {
    invariants: [{ id: "INV-1", statement: "A renderer's output stays parseable." }],
    acceptanceCriteria: [{
      id: "AC-1",
      statement: "A ticket's title preserves the owner's apostrophe.",
      verifiedBy: "Parse rendered ticket frontmatter.",
    }],
  } satisfies PlanContext["identifierSet"],
};

function rendered(): Map<string, string> {
  return renderPlanDocument(envelope);
}

function requiredDocument(path: string): string {
  const document = rendered().get(path);
  if (document === undefined) throw new Error(`missing rendered ${path}`);
  return document;
}

function ticketFrontmatter(ticket: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(ticket);
  if (match === null) throw new Error("rendered ticket has frontmatter");
  return parse(match[1] ?? "") as Record<string, unknown>;
}

test("rendered plan round-trips milestones, tasks, checklists, and identifiers", () => {
  const parsed = parseAwsfPlanHtmlV1(requiredDocument("specs/rendered-plan.html"), envelope.stem);

  assert.deepEqual(parsed.map((task) => ({
    number: task.number,
    milestone: task.milestone,
    milestoneMarker: task.milestoneMarker,
    checklist: task.checklist,
    serves: task.serves,
  })), [
    { number: 1, milestone: "M1", milestoneMarker: "", checklist: [""], serves: ["INV-1"] },
    { number: 2, milestone: "M2", milestoneMarker: "", checklist: [""], serves: ["AC-1"] },
  ]);
  assert.deepEqual(parsed.declarations, [
    { id: "INV-1", statement: "A renderer's output stays parseable." },
    { id: "AC-1", statement: "A ticket's title preserves the owner's apostrophe." },
  ]);
});

test("rendered ticket frontmatter uses the fence's YAML reader for colon titles", () => {
  const frontmatter = ticketFrontmatter(requiredDocument("specs/tickets/rendered-plan/T01.md"));

  assert.equal(frontmatter.title, "Parse title: preserve its colon");
  assert.deepEqual(frontmatter.depends_on, []);
  assert.deepEqual(frontmatter.serves, ["INV-1"]);
});

test("rendered documents satisfy spine coverage", () => {
  const parsed = parseAwsfPlanHtmlV1(requiredDocument("specs/rendered-plan.html"), envelope.stem);
  const tickets = envelope.plan.steps.map((step) => ({
    id: step.id,
    serves: ticketFrontmatter(requiredDocument(`specs/tickets/${envelope.stem}/${step.id}.md`)).serves as string[],
  }));

  assert.deepEqual(spineCoverage(
    { label: envelope.stem, declarations: parsed.declarations },
    parsed.map((task) => ({ id: `T${String(task.number).padStart(2, "0")}`, serves: task.serves })),
    tickets,
    [envelope.stem],
  ), []);
});

test("rendering is deterministic", () => {
  assert.deepEqual(renderPlanDocument(envelope), renderPlanDocument(envelope));
});
