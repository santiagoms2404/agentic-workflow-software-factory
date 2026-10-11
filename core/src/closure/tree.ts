import { isMap, isScalar, parseDocument } from "yaml";
import { parsePlanTicketBody } from "../persistence/plan-ticket-body.ts";
import { planAgreement, lightTicketAgreement, type AgreementTicket, type PlanAgreementViolation, type SectionBBlock } from "../registry/plan-agreement.ts";
import { parseAwsfPlanHtmlV1, UnsupportedPlanFormatError, type ResolvedPlanSource } from "../registry/plan-source.ts";

/** Complete tree snapshots; paths and registered sources use the same namespace. */
export type ClosureTree = ReadonlyMap<string, Uint8Array>;
export interface ClosurePlanSource extends ResolvedPlanSource {
  readonly label: string;
}
export interface ClosureRegistry {
  /** Supplied by the host's registered source resolver, never inferred from adjacency. */
  readonly plans: readonly ClosurePlanSource[];
  /** The flat store's explicit id-to-path mapping, supplied by its resolver. */
  readonly lightTickets?: ReadonlyMap<string, string>;
}

export class ClosureTreeError extends Error {
  readonly code = "E_CLOSURE_TREE";
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "ClosureTreeError";
    this.path = path;
  }
}

export function treeText(tree: ClosureTree, path: string): string {
  const bytes = tree.get(path);
  if (bytes === undefined) throw new ClosureTreeError(path, "missing registered file");
  const text = Buffer.from(bytes).toString("utf8");
  if (!Buffer.from(text).equals(Buffer.from(bytes))) throw new ClosureTreeError(path, "invalid UTF-8");
  return text;
}

export interface TicketFrontmatter {
  readonly fields: Record<string, unknown>;
  readonly body: string;
  readonly stateStart: number;
  readonly stateEnd: number;
  readonly state: string;
}

/** One top-level, single-line state scalar. Quotes, comments and spacing remain outside its value. */
export function ticketFrontmatter(source: string, path: string, light = false): TicketFrontmatter {
  const match = (light ? /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/ : /^---\n([\s\S]*?)\n---\n([\s\S]*)$/).exec(source);
  if (match === null) throw new ClosureTreeError(path, "missing frontmatter block");
  const fm = match[1] ?? "";
  const document = parseDocument(fm);
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new ClosureTreeError(path, "invalid YAML frontmatter");
  }
  const states = document.contents.items.filter((pair) => isScalar(pair.key) && pair.key.value === "state");
  const scalar = states[0]?.value;
  if (states.length !== 1 || !isScalar(scalar) || typeof scalar.value !== "string" || scalar.range === undefined) {
    throw new ClosureTreeError(path, "expected exactly one string state line");
  }
  const raw = fm.slice(scalar.range[0], scalar.range[1]);
  const quoted = raw.startsWith('"') || raw.startsWith("'");
  const inner = quoted ? raw.slice(1, -1) : raw;
  // Multiline/block/escaped scalars are not one state value line. Preserve
  // syntax rather than hiding a quoting or comment edit under the mask.
  if (!/^[a-z]+$/u.test(inner) || inner !== scalar.value) {
    throw new ClosureTreeError(path, "state must be a literal single-line word");
  }
  const offset = source.indexOf("\n") + 1;
  return { fields: document.toJSON() as Record<string, unknown>, body: match[2] ?? "",
    state: scalar.value, stateStart: offset + scalar.range[0] + (quoted ? 1 : 0),
    stateEnd: offset + scalar.range[1] - (quoted ? 1 : 0) };
}

export function registeredTicketPaths(tree: ClosureTree, source: ClosurePlanSource): readonly string[] {
  const prefix = `${source.ticketsPath}/`;
  return [...tree.keys()].filter((path) => path.startsWith(prefix) && /^[TW]\d\d\.md$/u.test(path.slice(prefix.length))).sort();
}

export function sectionBBlocks(md: string): ReadonlyMap<number, SectionBBlock> {
  const section = md.split("# Section B — Task prompts (recommended)")[1] ?? "";
  const heads = [...section.matchAll(/^### T(\d+) — (.+)$/gm)];
  return new Map(heads.map((head, index) => [Number(head[1]), {
    title: (head[2] ?? "").trim(),
    prompt: section.slice(head.index + head[0].length, heads[index + 1]?.index ?? section.length).trim(),
  }]));
}

function ticketPrompt(source: string, path: string): string {
  try {
    return parsePlanTicketBody(source, path).prompt;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new ClosureTreeError(path, error.message);
  }
}

export function agreementTicket(source: string, path: string): AgreementTicket {
  const fm = ticketFrontmatter(source, path).fields;
  if (fm.depends_on !== undefined && (!Array.isArray(fm.depends_on) || fm.depends_on.some((dep) => typeof dep !== "string"))) {
    throw new ClosureTreeError(path, "depends_on must be a string array");
  }
  return {
    id: String(fm.id), number: Number(String(fm.id).slice(1)), title: String(fm.title),
    milestone: String(fm.milestone), tier: fm.tier === undefined ? undefined : Number(fm.tier),
    state: String(fm.state), depends_on: (fm.depends_on as string[]) ?? [],
    workflow: fm.workflow === undefined ? undefined : String(fm.workflow),
    task_class: fm.task_class, serves: fm.serves === undefined ? undefined : fm.serves as string[],
    prompt: ticketPrompt(source, path),
  };
}

/** The same agreement rules as the fence, over the host-resolved after tree. */
export function treeAgreement(tree: ClosureTree, registry: ClosureRegistry): readonly PlanAgreementViolation[] {
  const knownStems = registry.plans.map((source) => source.label);
  const out: PlanAgreementViolation[] = [];
  for (const source of registry.plans) {
    if (source.format !== "awsf-plan-html/v1") throw new UnsupportedPlanFormatError(source.format, source.label);
    let plan;
    try {
      plan = parseAwsfPlanHtmlV1(treeText(tree, source.planPath), source.label);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new ClosureTreeError(source.planPath, error.message);
    }
    const paths = registeredTicketPaths(tree, source);
    // Legacy registered plans without a paired set are parsed but have no
    // agreement input, just as the sync fence discovers no set for them.
    if (paths.length === 0) continue;
    out.push(...planAgreement({ label: source.label, plan,
      tickets: paths.map((path) => agreementTicket(treeText(tree, path), path)),
      sectionB: sectionBBlocks(treeText(tree, source.promptsPath)), knownStems }));
  }
  const lights = [...(registry.lightTickets ?? new Map<string, string>())].map(([id, path]) => {
    const frontmatter = ticketFrontmatter(treeText(tree, path), path, true).fields;
    if (frontmatter.id !== id) throw new ClosureTreeError(path, "light ticket identity differs from registered filename");
    return { path, frontmatter };
  });
  out.push(...lightTicketAgreement(lights));
  return Object.freeze(out);
}
