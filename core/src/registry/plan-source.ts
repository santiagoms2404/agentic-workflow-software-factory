import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectCatalog } from "./catalog-schema.ts";
import type { Placement } from "./placement-schema.ts";

export const IMPLEMENTED_PLAN_FORMATS = ["awsf-plan-html/v1"] as const;

export type ImplementedPlanFormat = (typeof IMPLEMENTED_PLAN_FORMATS)[number];

export interface ResolvedPlanSource {
  readonly project: string;
  readonly repositoryId: string;
  readonly planPath: string;
  readonly promptsPath: string;
  readonly ticketsPath: string;
  readonly format: ImplementedPlanFormat;
}

export interface ParsedPlanTask {
  readonly number: number;
  readonly milestone: string;
  readonly milestoneMarker: string;
  readonly checklist: readonly string[];
}

export class UnsupportedPlanFormatError extends Error {
  readonly code = "E_UNSUPPORTED_PLAN_FORMAT";
  readonly format: string;
  readonly plan: string;

  constructor(format: string, plan: string) {
    const implemented = IMPLEMENTED_PLAN_FORMATS.map((value) => JSON.stringify(value)).join(", ");
    super(
      `plan ${JSON.stringify(plan)} declares unsupported format ${JSON.stringify(format)}; `
      + `exactly one format is implemented: ${implemented}`,
    );
    this.name = "UnsupportedPlanFormatError";
    this.format = format;
    this.plan = plan;
  }
}

export class PlanGrammarMismatchError extends Error {
  readonly code = "E_PLAN_GRAMMAR_MISMATCH";
  readonly plan: string;
  readonly format: ImplementedPlanFormat;

  constructor(plan: string) {
    super(
      `plan ${JSON.stringify(plan)} declares format ${JSON.stringify("awsf-plan-html/v1")} `
      + "but contains no Milestone M<digits> headings",
    );
    this.name = "PlanGrammarMismatchError";
    this.plan = plan;
    this.format = "awsf-plan-html/v1";
  }
}

/** Parses the sole implemented plan grammar without accepting foreign heading forms. */
export function parseAwsfPlanHtmlV1(html: string, plan: string): readonly ParsedPlanTask[] {
  const milestones = [...html.matchAll(/<h3><code class="status">\[([^\]]*)\]<\/code> Milestone (M\d+):/g)];
  if (milestones.length === 0) throw new PlanGrammarMismatchError(plan);

  const tasks: ParsedPlanTask[] = [];
  for (const [index, milestone] of milestones.entries()) {
    const start = milestone.index;
    // Bound the final milestone at its section so plan-wide checklists cannot
    // become part of its final task and create false ticket-state drift.
    const closing = html.indexOf("</section>", start);
    const end = Math.min(milestones[index + 1]?.index ?? html.length, closing === -1 ? html.length : closing);
    const block = html.slice(start, end);
    const heads = [...block.matchAll(/<h4>(\d+)\./g)];
    for (const [headIndex, head] of heads.entries()) {
      const slice = block.slice(head.index, heads[headIndex + 1]?.index ?? block.length);
      const checklist = [...slice.matchAll(/<code class="status">\[([^\]]*)\]<\/code>/g)]
        .map((match) => match[1] ?? "");
      tasks.push(Object.freeze({
        number: Number(head[1]),
        milestone: milestone[2] ?? "",
        milestoneMarker: milestone[1] ?? "",
        checklist: Object.freeze(checklist),
      }));
    }
  }
  const parsed = tasks.filter((task) => task.number > 0);
  if (parsed.length === 0) throw new PlanGrammarMismatchError(plan);
  return Object.freeze(parsed);
}

function checkoutRoot(start: string): string {
  let candidate = resolve(start);
  while (true) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return resolve(start);
    candidate = parent;
  }
}

function isInside(path: string, root: string): boolean {
  const offset = relative(root, path);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function planRepositoryId(catalog: ProjectCatalog): string {
  const entry = Object.entries(catalog.repositories).find(([, repository]) => repository.role === "plan");
  if (entry === undefined) throw new Error(`project ${JSON.stringify(catalog.project.slug)} has no plan repository`);
  return entry[0];
}

function planStems(plansRoot: string): string[] {
  return readdirSync(plansRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name.slice(0, -".html".length))
    .sort();
}

function implementedFormat(format: string, plan: string): ImplementedPlanFormat {
  if ((IMPLEMENTED_PLAN_FORMATS as readonly string[]).includes(format)) return format as ImplementedPlanFormat;
  throw new UnsupportedPlanFormatError(format, plan);
}

/** Resolves every plan in a catalog to its self checkout or explicit foreign placement. */
export function resolvePlanSources(
  catalogPath: string,
  catalog: ProjectCatalog,
  placement?: Placement,
): readonly ResolvedPlanSource[] {
  const repositoryId = planRepositoryId(catalog);
  const localCheckout = checkoutRoot(process.cwd());
  const resolvedCatalogPath = resolve(catalogPath);

  let repositoryRoot: string;
  if (isInside(resolvedCatalogPath, localCheckout)) {
    // Self-placement is decided before placement is touched, keeping this path hermetic.
    repositoryRoot = localCheckout;
  } else {
    if (placement === undefined || placement.project !== catalog.project.slug) return Object.freeze([]);
    const located = placement.repositories[repositoryId];
    if (located === undefined) return Object.freeze([]);
    repositoryRoot = located.path;
  }

  const plansRoot = join(repositoryRoot, catalog.plans.root);
  const stems = planStems(plansRoot);
  return Object.freeze(stems.map((stem) => {
    const format = implementedFormat(catalog.plans.format, stem);
    return Object.freeze({
      project: catalog.project.slug,
      repositoryId,
      planPath: join(plansRoot, `${stem}.html`),
      promptsPath: join(plansRoot, `${stem}-build-prompts.md`),
      ticketsPath: join(plansRoot, "tickets", stem),
      format,
    });
  }));
}
