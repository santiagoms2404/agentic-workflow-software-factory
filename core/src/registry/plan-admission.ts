import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { stringify } from "yaml";
import { PlanAdmissionTicketSchema, PLAN_ADMISSION_SCHEMA_ID, type PlanAdmissionTicket, type PlanAdmissionRecord } from "../contracts/plan-admission.ts";
import { agreementTicket, sectionBBlocks } from "../closure/tree.ts";
import { planAgreement } from "./plan-agreement.ts";
import { parseAwsfPlanHtmlV1 } from "./plan-source.ts";
import { runGit, systemGitRunner } from "../git/changes.ts";

export interface PlanAdmissionInput {
  readonly stem: string;
  readonly planHtml: string;
  readonly buildPrompts: string;
  readonly tickets: readonly PlanAdmissionTicket[];
}
export class PlanAdmissionRefused extends Error {
  readonly code = "E_PLAN_ADMISSION";
  constructor(detail: string) { super(`plan admission refused: ${detail}`); this.name = "PlanAdmissionRefused"; }
}
function refuse(detail: string): never { throw new PlanAdmissionRefused(detail); }
function digest(content: string): string { return createHash("sha256").update(content).digest("hex"); }

/** Pure host derivation: a caller cannot supply ticket paths, states, bodies or prompts. */
export function planAdmissionDocuments(input: PlanAdmissionInput, knownStems: readonly string[] = []): ReadonlyMap<string, string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.stem)) refuse("invalid new stem");
  if (input.tickets.length === 0 || input.tickets.length > 99) refuse("expected 1..99 tickets");
  for (const row of input.tickets) {
    if (!Value.Check(PlanAdmissionTicketSchema, row)) refuse("invalid frontmatter table (state is host-owned)");
  }
  const sectionHeads = input.buildPrompts.match(/^# Section B — Task prompts \(recommended\)$/gm) ?? [];
  const promptHeads = [...input.buildPrompts.matchAll(/^### T(\d+) — (.+)$/gm)];
  const blocks = sectionBBlocks(input.buildPrompts);
  if (sectionHeads.length !== 1 || promptHeads.length !== input.tickets.length || blocks.size !== input.tickets.length) refuse("Section B must have exactly one block per ticket");
  const plan = parseAwsfPlanHtmlV1(input.planHtml, input.stem);
  if (plan.length !== input.tickets.length) refuse("plan task coverage differs from the table");
  for (const marker of input.planHtml.matchAll(/<code class="status">\[([^\]]*)\]<\/code>/gu)) {
    if (marker[1] !== "") refuse("every admitted marker must be idle");
  }
  const documents = new Map<string, string>([
    [`specs/${input.stem}.html`, input.planHtml],
    [`specs/${input.stem}-build-prompts.md`, input.buildPrompts],
    [`specs/tickets/${input.stem}/README.md`, `# Tickets — ${input.stem}\n\nPlan: [\`../../${input.stem}.html\`](../../${input.stem}.html).\n\nFrontmatter is derived from the admission table; every state starts todo.\nBuild prompts are copied byte-for-byte from Section B, never authored separately.\n`],
  ]);
  const tickets = input.tickets.map((row, index) => {
    const expected = `T${String(index + 1).padStart(2, "0")}`;
    if (row.id !== expected) refuse("table ids must be ordered T01..Tnn with no gaps");
    const block = blocks.get(index + 1);
    if (block === undefined || block.title !== row.title || block.prompt.length === 0) refuse(`${row.id}: Section B title or prompt differs`);
    const path = `specs/tickets/${input.stem}/${row.id}.md`;
    const content = ["---", stringify({ ...row, state: "todo" }).trimEnd(), "---", "",
      `# ${row.id} · ${row.title}`, "", `> **Plan:** [\`../../${input.stem}.html\`](../../${input.stem}.html)`, "",
      "## Build prompt", "", block.prompt, ""].join("\n");
    documents.set(path, content);
    return agreementTicket(content, path);
  });
  const problems = planAgreement({ label: input.stem, plan, tickets, sectionB: blocks, knownStems: [...new Set([...knownStems, input.stem])] });
  if (problems.length > 0) refuse(problems.map(problem => problem.message).join("; "));
  return documents;
}

/** Opaque gate-only proof, never a role write permission or a data-shaped exemption. */
declare const admissionBrand: unique symbol;
export interface PlanAdmissionCapability { readonly [admissionBrand]: true }
interface AdmissionProof {
  readonly worktree: string;
  readonly baseSha: string;
  readonly documents: ReadonlyMap<string, string>;
}
const issued = new WeakMap<object, AdmissionProof>();
function proofFor(value: unknown): AdmissionProof | undefined {
  return typeof value === "object" && value !== null ? issued.get(value) : undefined;
}
export function isPlanAdmissionCapability(value: unknown): boolean { return proofFor(value) !== undefined; }

function statIfPresent(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function parents(worktree: string, path: string, create: boolean): void {
  if (realpathSync(worktree) !== worktree) refuse("worktree root is redirected");
  let parent = worktree;
  for (const component of path.split("/").slice(0, -1)) {
    parent = join(parent, component);
    const stat = statIfPresent(parent);
    if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) refuse("rendered plan parent is not a managed directory");
    if (stat === null && create) mkdirSync(parent);
  }
}
function basePaths(worktree: string, baseSha: string): string[] {
  if (!/^[a-f0-9]{40}$/u.test(baseSha)) refuse("base must be a full commit SHA");
  const git = systemGitRunner(worktree);
  runGit(git, ["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  // Include trees: an empty-looking subtree or ancestor symlink is not new content.
  return runGit(git, ["ls-tree", "-r", "-t", "--name-only", "-z", baseSha]).split("\0").filter(Boolean);
}
function assertAbsentAtBase(proof: AdmissionProof, paths: readonly string[]): void {
  for (const path of proof.documents.keys()) {
    const lower = path.toLowerCase();
    if (paths.some(existing => {
      const base = existing.toLowerCase();
      return base === lower || base.startsWith(`${lower}/`);
    })) refuse(`${path}: path exists at the base`);
  }
  const ticketRoot = [...proof.documents.keys()].find(path => path.endsWith("/README.md"))!;
  const prefix = `${dirname(ticketRoot).toLowerCase()}/`;
  if (paths.some(path => path.toLowerCase().startsWith(prefix))) refuse("ticket set exists at the base");
}
function assertCurrentBytes(proof: AdmissionProof, path: string): void {
  parents(proof.worktree, path, false);
  const target = join(proof.worktree, path);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o111) !== 0) refuse(`${path}: not a regular non-executable admission file`);
  if (readFileSync(target, "utf8") !== proof.documents.get(path)) refuse(`${path}: admitted bytes changed`);
}
function assertGitBytes(proof: AdmissionProof): void {
  const git = systemGitRunner(proof.worktree);
  for (const [path, content] of proof.documents) {
    const index = runGit(git, ["ls-files", "--stage", "-z", "--", path]).split("\0").filter(Boolean);
    const head = runGit(git, ["ls-tree", "-z", "HEAD", "--", path]).split("\0").filter(Boolean);
    if (index.length > 1 || (head.length > 0 && index.length !== 1)) refuse(`${path}: admission index is missing or conflicted`);
    if (index.length === 1 && (!index[0]!.startsWith("100644 ") || !index[0]!.includes(` 0\t${path}`)
      || runGit(git, ["show", `:${path}`]) !== content)) refuse(`${path}: staged admission bytes or mode changed`);
    if (head.length > 0 && (!head[0]!.startsWith("100644 blob ")
      || runGit(git, ["show", `HEAD:${path}`]) !== content)) refuse(`${path}: committed admission bytes or mode changed`);
  }
}

/** Recheck content and create-only evidence when the gate runs, not just when minted. */
export function planAdmissionExemptionAllows(value: unknown, path: string): boolean {
  const proof = proofFor(value);
  if (proof === undefined || !proof.documents.has(path)) return false;
  try {
    assertAbsentAtBase(proof, basePaths(proof.worktree, proof.baseSha));
    for (const admitted of proof.documents.keys()) assertCurrentBytes(proof, admitted);
    assertGitBytes(proof);
    return true;
  } catch { return false; }
}

/** Host-only verification supports a later gate/replay without granting write authority. */
export function verifyPlanAdmission(input: PlanAdmissionInput & { readonly worktree: string; readonly baseSha: string }): PlanAdmissionCapability {
  const worktree = resolve(input.worktree);
  const paths = basePaths(worktree, input.baseSha);
  const knownStems = paths.filter(path => /^specs\/[^/]+\.html$/u.test(path)).map(path => path.slice(6, -5));
  const proof = { worktree, baseSha: input.baseSha, documents: planAdmissionDocuments(input, knownStems) };
  assertAbsentAtBase(proof, paths);
  for (const path of proof.documents.keys()) assertCurrentBytes(proof, path);
  assertGitBytes(proof);
  const capability = Object.freeze(Object.create(null)) as PlanAdmissionCapability;
  issued.set(capability, proof);
  return capability;
}

/** Writes exactly one validated new plan set; never commits, overwrites or grants role writes. */
export function admitPlanSet(input: PlanAdmissionInput & { readonly worktree: string; readonly baseSha: string; readonly at: string }): {
  readonly documents: ReadonlyMap<string, string>;
  readonly capability: PlanAdmissionCapability;
  readonly record: PlanAdmissionRecord;
} {
  const worktree = resolve(input.worktree);
  const paths = basePaths(worktree, input.baseSha);
  const knownStems = paths.filter(path => /^specs\/[^/]+\.html$/u.test(path)).map(path => path.slice(6, -5));
  const documents = planAdmissionDocuments(input, knownStems);
  assertAbsentAtBase({ worktree, baseSha: input.baseSha, documents }, paths);
  if (input.at.trim().length === 0) refuse("admission timestamp is missing");
  const ticketDirectory = `specs/tickets/${input.stem}`;
  parents(worktree, `${ticketDirectory}/README.md`, false);
  if (statIfPresent(join(worktree, ticketDirectory)) !== null) refuse("admission ticket directory already exists");
  // Preflight the entire set before creating even a parent directory.
  for (const path of documents.keys()) {
    parents(worktree, path, false);
    if (statIfPresent(join(worktree, path)) !== null) refuse(`${path}: admission target already exists`);
  }
  for (const [path, content] of documents) {
    parents(worktree, path, true);
    writeFileSync(join(worktree, path), content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  }
  const capability = verifyPlanAdmission(input);
  const record: PlanAdmissionRecord = { schema: PLAN_ADMISSION_SCHEMA_ID, stem: input.stem,
    baseSha: input.baseSha, at: input.at, files: [...documents].map(([path, content]) => ({ path, sha256: digest(content) })) };
  return Object.freeze({ documents, capability, record });
}
