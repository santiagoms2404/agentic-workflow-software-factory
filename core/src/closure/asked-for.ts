import { parseAwsfPlanHtmlV1, scanAwsfPlanHtmlV1, UnsupportedPlanFormatError, type PlanTaskSlice } from "../registry/plan-source.ts";
import { parsePlanTicketBody } from "../persistence/plan-ticket-body.ts";
import { ClosureTreeError, ticketFrontmatter, treeText, type ClosureRegistry, type ClosureTree } from "./tree.ts";

export type AskedForSelection =
  | { readonly kind: "plan"; readonly plan: string; readonly ticket: string }
  | { readonly kind: "light"; readonly ticket: string };
export interface PlanTicketAsk {
  readonly prompt: string;
  readonly title: unknown;
  readonly milestone: unknown;
  readonly depends_on: unknown;
  readonly serves: unknown;
  readonly checklist: readonly string[];
  readonly declarations: readonly { readonly id: string; readonly statement: string }[];
}
export interface LightTicketAsk {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}
export interface AskedForDifference {
  readonly selection: AskedForSelection;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}
export type AskedForResult =
  | { readonly ok: true; readonly differences: readonly [] }
  | { readonly ok: false; readonly refusal: {
    readonly code: "E_CLOSURE_ASK_CHANGED"; readonly differences: readonly AskedForDifference[];
  } }
  | { readonly ok: false; readonly refusal: {
    readonly code: "E_CLOSURE_TREE"; readonly path: string; readonly message: string;
  } };

/** Remove only actual Markdown Handoff sections, never headings inside fences. */
export function withoutHandoffs(body: string): string {
  const lines = body.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const kept: string[] = [];
  let fence: { char: string; length: number } | undefined;
  let handoff = false;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = { char: marker[0]!, length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && /^ {0,3}(`+|~+)\s*$/u.test(line)) fence = undefined;
      if (!handoff) kept.push(line);
      continue;
    }
    if (fence === undefined && /^#{1,2} /u.test(line)) {
      const nextHandoff = /^## Handoff(?:\r?\n|$)/u.test(line);
      if (nextHandoff) {
        // The blank separator introducing the excluded section belongs to it.
        while (kept.length > 0 && /^\r?\n$/u.test(kept[kept.length - 1]!)) kept.pop();
      } else if (handoff && kept.length > 0) {
        // Retain the ordinary separator before the next included section.
        kept.push(line.endsWith("\r\n") ? "\r\n" : "\n");
      }
      handoff = nextHandoff;
    }
    if (!handoff) kept.push(line);
  }
  return kept.join("");
}

function checklistRows(html: string, task: PlanTaskSlice): readonly string[] {
  const slice = html.slice(task.start, task.end);
  return Object.freeze(task.tokens.map((token) => {
    const start = token.start - task.start;
    const end = token.end - task.start;
    // Normal plans use li rows. The parser also consumes status elements on
    // bare lines, so those lines must retain their ask text too.
    const opening = [...slice.slice(0, start).matchAll(/<li\b[^>]*>/gu)].at(-1)?.index ?? -1;
    const previousClose = slice.lastIndexOf("</li>", start);
    const closing = slice.indexOf("</li>", end);
    const rowStart = opening > previousClose && closing !== -1 ? opening : slice.lastIndexOf("\n", start) + 1;
    const newline = slice.indexOf("\n", end);
    const rowEnd = opening > previousClose && closing !== -1 ? closing + "</li>".length : newline === -1 ? slice.length : newline;
    const row = slice.slice(rowStart, rowEnd);
    // Only this task's parser-consumed values, using immutable segment joins.
    const spans = task.tokens.filter((candidate) => candidate.valueStart >= task.start + rowStart
      && candidate.valueEnd <= task.start + rowEnd);
    let result = "";
    let cursor = 0;
    for (const span of spans) {
      const valueStart = span.valueStart - task.start - rowStart;
      const valueEnd = span.valueEnd - task.start - rowStart;
      result += row.slice(cursor, valueStart);
      cursor = valueEnd;
    }
    return result + row.slice(cursor);
  }));
}

/** Pure extraction: Handoff is above the build prompt and is not part of it. */
export function planTicketAsk(planHtml: string, ticketSource: string, taskNumber: number, label = "plan"): PlanTicketAsk {
  const plan = parseAwsfPlanHtmlV1(planHtml, label);
  const matches = scanAwsfPlanHtmlV1(planHtml).tasks.filter((task) => task.number === taskNumber);
  if (matches.length !== 1) throw new ClosureTreeError(label, `expected one task ${taskNumber}, found ${matches.length}`);
  const fm = ticketFrontmatter(ticketSource, label).fields;
  return Object.freeze({ prompt: parsePlanTicketBody(ticketSource, label).prompt,
    title: fm.title, milestone: fm.milestone, depends_on: fm.depends_on ?? [], serves: fm.serves,
    checklist: checklistRows(planHtml, matches[0]!), declarations: plan.declarations });
}

export function lightTicketAsk(ticketSource: string, label = "ticket"): LightTicketAsk {
  const fm = ticketFrontmatter(ticketSource, label, true);
  const { state: _state, ...frontmatter } = fm.fields;
  return Object.freeze({ frontmatter: Object.freeze(frontmatter), body: withoutHandoffs(fm.body) });
}

function selectionAsk(tree: ClosureTree, registry: ClosureRegistry, selection: AskedForSelection): PlanTicketAsk | LightTicketAsk {
  if (selection.kind === "light") {
    const path = registry.lightTickets?.get(selection.ticket);
    if (path === undefined) throw new ClosureTreeError(selection.ticket, "light ticket has no registered source");
    const text = treeText(tree, path);
    if (ticketFrontmatter(text, path, true).fields.id !== selection.ticket) throw new ClosureTreeError(path, "ticket identity differs from selection");
    return lightTicketAsk(text, path);
  }
  const sources = registry.plans.filter((source) => source.label === selection.plan);
  if (sources.length !== 1) throw new ClosureTreeError(selection.plan, "plan selection has no unique registered source");
  if (!/^[TW]\d\d$/u.test(selection.ticket)) throw new ClosureTreeError(selection.ticket, "invalid selected ticket id");
  const source = sources[0]!;
  if (source.format !== "awsf-plan-html/v1") throw new UnsupportedPlanFormatError(source.format, source.label);
  const path = `${source.ticketsPath}/${selection.ticket}.md`;
  const ticket = treeText(tree, path);
  if (ticketFrontmatter(ticket, path).fields.id !== selection.ticket) throw new ClosureTreeError(path, "ticket identity differs from selection");
  return planTicketAsk(treeText(tree, source.planPath), ticket, Number(selection.ticket.slice(1)), source.label);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Resolve both snapshots independently. No sealed file path participates. */
export function compareAskedFor(before: ClosureTree, after: ClosureTree, registry: ClosureRegistry,
  selected: readonly AskedForSelection[], afterRegistry: ClosureRegistry = registry): AskedForResult {
  const differences: AskedForDifference[] = [];
  try {
    for (const selection of selected) {
      const left = selectionAsk(before, registry, selection);
      const right = selectionAsk(after, afterRegistry, selection);
      if (selection.kind === "plan") {
        for (const field of ["prompt", "title", "milestone", "depends_on", "serves", "checklist", "declarations"] as const) {
          const a = (left as PlanTicketAsk)[field];
          const b = (right as PlanTicketAsk)[field];
          if (stable(a) !== stable(b)) differences.push({ selection, field, before: a, after: b });
        }
      } else {
        const a = left as LightTicketAsk;
        const b = right as LightTicketAsk;
        for (const field of [...new Set([...Object.keys(a.frontmatter), ...Object.keys(b.frontmatter)])].sort()) {
          if (stable(a.frontmatter[field]) !== stable(b.frontmatter[field])) differences.push({ selection,
            field: `frontmatter.${field}`, before: a.frontmatter[field], after: b.frontmatter[field] });
        }
        if (a.body !== b.body) differences.push({ selection, field: "body", before: a.body, after: b.body });
      }
    }
    return differences.length === 0 ? { ok: true, differences: [] }
      : { ok: false, refusal: { code: "E_CLOSURE_ASK_CHANGED", differences: Object.freeze(differences) } };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { ok: false, refusal: { code: "E_CLOSURE_TREE",
      path: error instanceof ClosureTreeError ? error.path : "selection", message: error.message } };
  }
}
