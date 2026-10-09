import { scanAwsfPlanHtmlV1 } from "../registry/plan-source.ts";
import { ticketFrontmatter, treeText, type ClosureRegistry, type ClosureTree } from "./tree.ts";

export interface ClosureRow {
  readonly path: string;
  readonly ticket: string;
  readonly taskNumber: number;
  readonly rowIndex: number;
  readonly marker: string;
  readonly text: string;
}
export interface ClosureProposal {
  readonly plan: string;
  readonly tickets: readonly string[];
  readonly rows: readonly ClosureRow[];
  readonly notClosable: readonly string[];
}

/** Selection identity, not a sealed path, resolves today's task and rows. */
export function proposeClosure(tree: ClosureTree, registry: ClosureRegistry, plan: string,
  tickets: readonly string[], built?: ReadonlySet<string>): ClosureProposal {
  const source = registry.plans.find(source => source.label === plan);
  if (source === undefined) throw new Error(`closure has no registered plan ${plan}`);
  const html = treeText(tree, source.planPath);
  const layout = scanAwsfPlanHtmlV1(html);
  const closable = tickets.filter(id => built === undefined || built.has(id));
  const rows = closable.flatMap(ticket => {
    const number = Number(ticket.slice(1));
    const tasks = layout.tasks.filter(task => task.number === number);
    if (tasks.length !== 1 || ticketFrontmatter(treeText(tree, `${source.ticketsPath}/${ticket}.md`), ticket).fields.id !== ticket) {
      throw new Error(`closure has no unique registered task for ${ticket}`);
    }
    return tasks[0]!.tokens.map(token => {
      const opening = html.lastIndexOf("<li", token.start);
      const closing = html.indexOf("</li>", token.end);
      const inRow = opening > html.lastIndexOf("</li>", token.start) && closing !== -1;
      const start = inRow ? opening : html.lastIndexOf("\n", token.start) + 1;
      const newline = html.indexOf("\n", token.end);
      const end = inRow ? closing + 5 : newline === -1 ? html.length : newline;
      return { path: source.planPath, ticket, taskNumber: number, rowIndex: token.rowIndex!,
        marker: token.value, text: html.slice(start, end) };
    });
  });
  return { plan, tickets: closable, rows, notClosable: tickets.filter(id => !closable.includes(id)) };
}

/** Substitution spans come only from the shared parser; no rendering or prose writes. */
export function applyClosureChoices(before: ClosureTree, registry: ClosureRegistry, proposal: ClosureProposal,
  closed: ReadonlySet<ClosureRow>): ClosureTree {
  const after = new Map(before);
  const source = registry.plans.find(source => source.label === proposal.plan)!;
  const html = treeText(before, source.planPath);
  const layout = scanAwsfPlanHtmlV1(html);
  const substitutions: { start: number; end: number; value: string }[] = [];
  for (const row of proposal.rows) {
    const token = layout.tasks.find(task => task.number === row.taskNumber)!.tokens[row.rowIndex]!;
    substitutions.push({ start: token.valueStart, end: token.valueEnd, value: closed.has(row) ? "x" : token.value });
  }
  const substitute = (text: string, spans: typeof substitutions): string => {
    for (const span of [...spans].sort((a, b) => b.start - a.start)) text = text.slice(0, span.start) + span.value + text.slice(span.end);
    return text;
  };
  let nextHtml = substitute(html, substitutions);
  let nextLayout = scanAwsfPlanHtmlV1(nextHtml);
  for (const id of proposal.tickets) {
    const task = nextLayout.tasks.find(task => task.number === Number(id.slice(1)))!;
    const state = task.tokens.length > 0 && task.tokens.every(token => token.value === "x") ? "done" : "wip";
    const path = `${source.ticketsPath}/${id}.md`;
    const text = treeText(before, path);
    const fm = ticketFrontmatter(text, path);
    after.set(path, Buffer.from(substitute(text, [{ start: fm.stateStart, end: fm.stateEnd, value: state }])));
  }
  const milestones = new Set(proposal.tickets.map(id => nextLayout.tasks.find(task => task.number === Number(id.slice(1)))!.milestone));
  const markerSpans = nextLayout.milestones.filter(token => milestones.has(token.milestone)).map(token => {
    const tasks = nextLayout.tasks.filter(task => task.milestone === token.milestone);
    return { start: token.valueStart, end: token.valueEnd,
      value: tasks.every(task => task.tokens.length > 0 && task.tokens.every(row => row.value === "x")) ? "x" : "wip" };
  });
  nextHtml = substitute(nextHtml, markerSpans);
  after.set(source.planPath, Buffer.from(nextHtml));
  return after;
}
