import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectCatalog } from "./catalog-schema.ts";
import type { Placement } from "./placement-schema.ts";
import {
  isPlanDeclarationIdentifier,
  isPlanIdentifierClaim,
  planDeclarationSequenceIssue,
  type PlanIdentifierKind,
  type PlanSpineDeclaration,
} from "./plan-spine.ts";

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
  readonly serves: readonly string[];
}

export interface ParsedAwsfPlan extends ReadonlyArray<ParsedPlanTask> {
  readonly declarations: readonly PlanSpineDeclaration[];
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

export class PlanIdentifierGrammarError extends Error {
  readonly code = "E_PLAN_IDENTIFIER_GRAMMAR";
  readonly plan: string;
  readonly format: ImplementedPlanFormat;
  readonly identifier: string;

  constructor(plan: string, identifier: string, reason: string) {
    super(`plan ${JSON.stringify(plan)} has invalid identifier ${JSON.stringify(identifier)}: ${reason}`);
    this.name = "PlanIdentifierGrammarError";
    this.plan = plan;
    this.format = "awsf-plan-html/v1";
    this.identifier = identifier;
  }
}

function declarationStatement(html: string): string {
  return html.replace(/<[^>]*>/gu, "").replace(/&(?:nbsp|#160);/gu, " ").trim();
}

function parseDeclarations(html: string, plan: string): readonly PlanSpineDeclaration[] {
  const section = /<section\b[^>]*\bid="spine"[^>]*>([\s\S]*?)<\/section>/u.exec(html)?.[1];
  if (section === undefined) return Object.freeze([]);

  const declarationCodes = [...section.matchAll(/<code class="(inv|ac)">([\s\S]*?)<\/code>/gu)];
  const pairs = [...section.matchAll(
    /<dt>\s*<code class="(inv|ac)">([\s\S]*?)<\/code>\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gu,
  )];
  const pairedCodeIndexes = new Set(pairs.map((pair) => {
    const codeOffset = pair[0].indexOf("<code");
    return (pair.index ?? 0) + codeOffset;
  }));

  for (const code of declarationCodes) {
    const identifier = (code[2] ?? "").trim();
    if (!pairedCodeIndexes.has(code.index ?? -1)) {
      throw new PlanIdentifierGrammarError(plan, identifier, "a declaration must be paired with a statement");
    }
  }

  const declarations = pairs.map((pair) => {
    const kind = (pair[1] ?? "") as PlanIdentifierKind;
    const identifier = (pair[2] ?? "").trim();
    if (!isPlanDeclarationIdentifier(identifier, kind)) {
      throw new PlanIdentifierGrammarError(
        plan,
        identifier,
        kind === "inv"
          ? "declarations must match ^INV-[1-9][0-9]*$ and must not be qualified"
          : "declarations must match ^AC-[1-9][0-9]*$ and must not be qualified",
      );
    }

    const statement = declarationStatement(pair[3] ?? "");
    if (statement.length === 0) {
      throw new PlanIdentifierGrammarError(plan, identifier, "a declaration statement must be non-empty");
    }
    return Object.freeze({ id: identifier, statement });
  });

  const sequenceIssue = planDeclarationSequenceIssue(declarations);
  if (sequenceIssue !== undefined) {
    throw new PlanIdentifierGrammarError(plan, sequenceIssue.identifier, sequenceIssue.reason);
  }
  return Object.freeze(declarations);
}

function parseServes(taskHtml: string, plan: string): readonly string[] {
  const serves = [...taskHtml.matchAll(/<code class="serves">([\s\S]*?)<\/code>/gu)]
    .map((match) => (match[1] ?? "").trim());
  for (const identifier of serves) {
    if (!isPlanIdentifierClaim(identifier)) {
      throw new PlanIdentifierGrammarError(
        plan,
        identifier,
        "claims must be a bare identifier or <plan-stem>#<identifier> with no leading zero",
      );
    }
  }
  return Object.freeze(serves);
}

function parsedTask(
  number: number,
  milestone: string,
  milestoneMarker: string,
  checklist: readonly string[],
  serves: readonly string[],
): ParsedPlanTask {
  const task = { number, milestone, milestoneMarker, checklist };
  // Keep the additive field out of legacy structural comparisons while making
  // it available as an immutable property to coverage consumers.
  Object.defineProperty(task, "serves", { value: serves, enumerable: false });
  return Object.freeze(task) as ParsedPlanTask;
}

/**
 * Parses the sole implemented plan grammar without accepting foreign heading
 * forms. The identifier spine is additive and optional in v1. Making the spine
 * mandatory is the trigger for a new plan format id.
 */
export function parseAwsfPlanHtmlV1(html: string, plan: string): ParsedAwsfPlan {
  const milestones = [...html.matchAll(/<h3><code class="status">\[([^\]]*)\]<\/code> Milestone (M\d+):/g)];
  if (milestones.length === 0) throw new PlanGrammarMismatchError(plan);

  const declarations = parseDeclarations(html, plan);
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
      tasks.push(parsedTask(
        Number(head[1]),
        milestone[2] ?? "",
        milestone[1] ?? "",
        Object.freeze(checklist),
        parseServes(slice, plan),
      ));
    }
  }
  const parsed = tasks.filter((task) => task.number > 0);
  if (parsed.length === 0) throw new PlanGrammarMismatchError(plan);
  Object.defineProperty(parsed, "declarations", { value: declarations, enumerable: false });
  return Object.freeze(parsed) as ParsedAwsfPlan;
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
