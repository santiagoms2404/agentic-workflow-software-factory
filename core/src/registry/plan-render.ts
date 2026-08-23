import type { DesignPlanOutput } from "../contracts/design-plan-output.ts";
import type { PlanContext } from "../contracts/plan-context.ts";

/**
 * Host-carried inputs needed to render a plan without recovering design data
 * from prose or machine-local state.
 */
export interface PlanDocumentEnvelope {
  readonly stem: string;
  readonly plan: DesignPlanOutput;
  readonly identifierSet: PlanContext["identifierSet"];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderDeclarations(envelope: PlanDocumentEnvelope): string {
  const declarations = [
    ...envelope.identifierSet.invariants.map((declaration) => ({ ...declaration, kind: "inv" } as const)),
    ...envelope.identifierSet.acceptanceCriteria.map((declaration) => ({ ...declaration, kind: "ac" } as const)),
  ];

  return declarations
    .map((declaration) => [
      `      <dt><code class="${declaration.kind}">${escapeHtml(declaration.id)}</code></dt>`,
      `      <dd>${escapeHtml(declaration.statement)}</dd>`,
    ].join("\n"))
    .join("\n");
}

function renderClaims(serves: readonly string[]): string {
  if (serves.length === 0) return "";
  const claims = serves
    .map((identifier) => `<code class="serves">${escapeHtml(identifier)}</code>`)
    .join(" ");
  return `      <p class="serves">${claims}</p>\n`;
}

function renderPlanHtml(envelope: PlanDocumentEnvelope): string {
  const milestoneBlocks = envelope.plan.milestones.map((milestone) => {
    const tasks = envelope.plan.steps
      .filter((step) => step.milestone === milestone.id)
      .map((step) => {
        const number = Number(step.id.slice(1));
        return [
          `      <h4>${String(number)}. ${escapeHtml(step.title)}</h4>`,
          renderClaims(step.serves).trimEnd(),
          "      <ul class=\"checklist\">",
          `        <li><code class="status">[]</code> Complete ${escapeHtml(step.title)}</li>`,
          "      </ul>",
        ].filter((line) => line.length > 0).join("\n");
      })
      .join("\n\n");

    return [
      "    <div class=\"phase\">",
      `      <h3><code class="status">[]</code> Milestone ${escapeHtml(milestone.id)}: ${escapeHtml(milestone.title)}</h3>`,
      tasks,
      "    </div>",
    ].join("\n");
  }).join("\n\n");

  const declarations = renderDeclarations(envelope);
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    `  <title>${escapeHtml(envelope.plan.summary)}</title>`,
    "</head>",
    "<body>",
    "  <header>",
    `    <h1>${escapeHtml(envelope.plan.summary)}</h1>`,
    "  </header>",
    "  <section id=\"spine\">",
    "    <h2>Identifier Spine</h2>",
    "    <dl>",
    declarations,
    "    </dl>",
    "  </section>",
    "  <section id=\"implementation\">",
    "    <h2>Implementation Phases</h2>",
    milestoneBlocks,
    "  </section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

interface RenderedStepDocuments {
  readonly promptBlock: string;
  readonly ticketPath: string;
  readonly ticket: string;
}

function renderStepDocuments(envelope: PlanDocumentEnvelope): RenderedStepDocuments[] {
  return envelope.plan.steps.map((step) => {
    // Normalize the envelope value once, then write this exact string into both
    // documents. The sync fence trims the Section B block but only strips final
    // newlines from the ticket, so retaining boundary whitespace would make its
    // two readers disagree even though both copies came from the same field.
    const buildPrompt = step.buildPrompt.trim();
    const title = JSON.stringify(step.title);
    const ticket = [
      "---",
      `id: ${step.id}`,
      `title: ${title}`,
      `milestone: ${step.milestone}`,
      "state: todo",
      `depends_on: ${JSON.stringify(step.dependsOn)}`,
      `serves: ${JSON.stringify(step.serves)}`,
      "---",
      "",
      `# ${step.id} · ${step.title}`,
      "",
      `> **Plan:** [\`../../${envelope.stem}.html\`](../../${envelope.stem}.html) · Milestone ${step.milestone}`,
      "",
      "## Build prompt",
      "",
      buildPrompt,
      "",
    ].join("\n");

    return {
      promptBlock: [`### ${step.id} — ${step.title}`, "", buildPrompt].join("\n"),
      ticketPath: `specs/tickets/${envelope.stem}/${step.id}.md`,
      ticket,
    };
  });
}

function renderBuildPrompts(envelope: PlanDocumentEnvelope, steps: readonly RenderedStepDocuments[]): string {
  return [
    `# Build Prompts — ${envelope.plan.summary}`,
    "",
    "# Section B — Task prompts (recommended)",
    "",
    steps.map((step) => step.promptBlock).join("\n\n"),
    "",
  ].join("\n");
}

function renderTicketReadme(envelope: PlanDocumentEnvelope): string {
  return [
    `# Tickets — ${envelope.plan.summary}`,
    "",
    `One file per step rendered from \`specs/${envelope.stem}.html\`. Build prompts are written from`,
    "the same normalized envelope string as their Section B blocks; do not format either copy independently.",
    "",
    "## Derived-field rule",
    "",
    "- **`milestone`** is copied from each step's `milestone` field.",
    "- **`depends_on`** is copied from each step's `dependsOn` field. It is never inferred from ticket order.",
    "- **`state`** is always `todo` because rendered plans claim no completed work.",
    "- **`serves`** is copied from each step's `serves` field. It is never derived from prose.",
    "- **`tier`** and **`workflow`** are omitted because the envelope defines neither vocabulary.",
    "- **`title`** is copied from the step and always YAML-quoted. The build prompt is normalized once.",
    "",
  ].join("\n");
}

/** Pure rendering only. The caller owns all filesystem writes. */
export function renderPlanDocument(envelope: PlanDocumentEnvelope): Map<string, string> {
  const steps = renderStepDocuments(envelope);
  return new Map([
    [`specs/${envelope.stem}.html`, renderPlanHtml(envelope)],
    [`specs/${envelope.stem}-build-prompts.md`, renderBuildPrompts(envelope, steps)],
    [`specs/tickets/${envelope.stem}/README.md`, renderTicketReadme(envelope)],
    ...steps.map((step) => [step.ticketPath, step.ticket] as const),
  ]);
}
