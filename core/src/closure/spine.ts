import { posix } from "node:path";
import { scanAwsfPlanHtmlV1 } from "../registry/plan-source.ts";
import { proposeClosure, type ClosureProposal } from "./propose.ts";
import { registeredTicketPaths, ticketFrontmatter, treeText, type ClosureRegistry, type ClosureTree } from "./tree.ts";

export class SpineClosureError extends Error {
  readonly code = "E_CLOSURE_SPINE";
}

/** A section's local link is the sole mapping. Ticket ids and prose never name the deep plan. */
export function proposeSpineRollUp(tree: ClosureTree, registry: ClosureRegistry, plan: string): ClosureProposal | null {
  const deep = registry.plans.find(source => source.label === plan);
  if (deep === undefined) throw new SpineClosureError(`closure has no registered plan ${plan}`);
  const isSpine = (source: typeof deep): boolean => registeredTicketPaths(tree, source)
    .some(path => /^W\d\d\.md$/u.test(posix.basename(path)));
  // Completing a spine is not completion of a deep plan, even if another spine is registered.
  if (isSpine(deep)) return null;
  const layout = scanAwsfPlanHtmlV1(treeText(tree, deep.planPath));
  if (layout.milestones.length === 0 || !layout.milestones.every(token => token.value === "x")) return null;
  const spines = registry.plans.filter(source => source.label !== plan && isSpine(source));
  // A standalone registered project need not have a spine.
  if (spines.length === 0) return null;
  const matches: { plan: string; ticket: string }[] = [];
  for (const spine of spines) {
    const html = treeText(tree, spine.planPath);
    const sections = scanAwsfPlanHtmlV1(html);
    for (const [index, milestone] of sections.milestones.entries()) {
      const close = html.indexOf("</section>", milestone.start);
      const end = Math.min(sections.milestones[index + 1]?.start ?? html.length, close === -1 ? html.length : close);
      const block = html.slice(milestone.start, end);
      const links = [...block.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gu)];
      if (!links.some(link => {
        const href = link[1]!.split(/[?#]/u)[0]!;
        if (/^[a-z][a-z0-9+.-]*:|^\/\//iu.test(href) || href.startsWith("/")) return false;
        return posix.normalize(posix.join(posix.dirname(spine.planPath), href)) === deep.planPath;
      })) continue;
      const tasks = sections.tasks.filter(task => task.milestone === milestone.milestone);
      if (tasks.length !== 1) throw new SpineClosureError(`spine section linking to ${plan} must hold exactly one workstream task`);
      const paths = registeredTicketPaths(tree, spine).filter(path => {
        const id = ticketFrontmatter(treeText(tree, path), path).fields.id;
        return typeof id === "string" && /^W\d\d$/u.test(id) && Number(id.slice(1)) === tasks[0]!.number;
      });
      if (paths.length !== 1) throw new SpineClosureError(`spine section linking to ${plan} has no unique workstream ticket`);
      matches.push({ plan: spine.label, ticket: posix.basename(paths[0]!, ".md") });
    }
  }
  if (matches.length !== 1) throw new SpineClosureError(matches.length === 0
    ? `spine has no section linking to ${plan}` : `spine links to ${plan} in more than one section`);
  return proposeClosure(tree, registry, matches[0]!.plan, [matches[0]!.ticket]);
}
