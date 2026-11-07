import { createHash } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, rmdirSync, rmSync, writeSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { stringify } from "yaml";
import { PlanAdmissionTicketSchema, PLAN_ADMISSION_SCHEMA_ID, type PlanAdmissionTicket, type PlanAdmissionRecord } from "../contracts/plan-admission.ts";
import { agreementTicket, sectionBBlocks } from "../closure/tree.ts";
import { planAgreement } from "./plan-agreement.ts";
import { parseAwsfPlanHtmlV1 } from "./plan-source.ts";
import { loadCatalog } from "./catalog.ts";
import { runGit, systemGitRunner } from "../git/changes.ts";

export interface PlanAdmissionInput {
  readonly stem: string;
  readonly planHtml: string;
  readonly buildPrompts: string;
  readonly tickets: readonly PlanAdmissionTicket[];
  readonly knownStems?: readonly string[];
  readonly plansRoot?: string;
}
export class PlanAdmissionRefused extends Error {
  readonly code = "E_PLAN_ADMISSION";
  constructor(detail: string) { super(`plan admission refused: ${detail}`); this.name = "PlanAdmissionRefused"; }
}

/** A failed materialization whose exclusive rollback retained uncertain paths. */
export class PlanAdmissionMaterializationError extends Error {
  readonly retainedPaths: readonly string[];

  constructor(cause: unknown, retainedPaths: readonly string[]) {
    super(`plan admission materialization failed; rollback retained path(s): ${retainedPaths.join(", ")}`, { cause });
    this.name = "PlanAdmissionMaterializationError";
    this.retainedPaths = Object.freeze([...retainedPaths]);
  }
}

function refuse(detail: string): never { throw new PlanAdmissionRefused(detail); }
function digest(content: string): string { return createHash("sha256").update(content).digest("hex"); }

function escapeRegex(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pure host derivation: a caller cannot supply ticket paths, states, bodies or prompts. */
export function planAdmissionDocuments(
  input: PlanAdmissionInput,
  knownStems: readonly string[] = input.knownStems ?? [],
  plansRoot = input.plansRoot ?? "specs",
): ReadonlyMap<string, string> {
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
  const root = (plansRoot || "specs").replace(/\/+$/u, "");
  const documents = new Map<string, string>([
    [`${root}/${input.stem}.html`, input.planHtml],
    [`${root}/${input.stem}-build-prompts.md`, input.buildPrompts],
    [`${root}/tickets/${input.stem}/README.md`, `# Tickets — ${input.stem}\n\nPlan: [\`../../${input.stem}.html\`](../../${input.stem}.html).\n\nFrontmatter is derived from the admission table; every state starts todo.\nBuild prompts are copied byte-for-byte from Section B, never authored separately.\n`],
  ]);
  const tickets = input.tickets.map((row, index) => {
    const expected = `T${String(index + 1).padStart(2, "0")}`;
    if (row.id !== expected) refuse("table ids must be ordered T01..Tnn with no gaps");
    const block = blocks.get(index + 1);
    if (block === undefined || block.title !== row.title || block.prompt.length === 0) refuse(`${row.id}: Section B title or prompt differs`);
    const path = `${root}/tickets/${input.stem}/${row.id}.md`;
    const content = ["---", stringify({ ...row, state: "todo" }).trimEnd(), "---", "",
      `# ${row.id} · ${row.title}`, "", `> **Plan:** [\`../../${input.stem}.html\`](../../${input.stem}.html)`, "",
      "## Build prompt", "", block.prompt, ""].join("\n");
    documents.set(path, content);
    return agreementTicket(content, path);
  });
  const allKnownStems = [...new Set([...(input.knownStems ?? []), ...knownStems, input.stem])];
  const problems = planAgreement({ label: input.stem, plan, tickets, sectionB: blocks, knownStems: allKnownStems });
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

declare const rollbackBrand: unique symbol;
export interface PlanAdmissionRollbackCapability { readonly [rollbackBrand]: true }
interface CreatedFile {
  readonly relativePath: string;
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  expected: Buffer;
}
interface CreatedDirectory { readonly path: string; readonly dev: number; readonly ino: number }
interface AdmissionRollbackProof {
  readonly worktree: string;
  readonly headSha: string;
  readonly files: Map<string, CreatedFile>;
  readonly unverifiedPaths: string[];
  readonly directories: CreatedDirectory[];
  consumed: boolean;
}
const issuedRollbacks = new WeakMap<object, AdmissionRollbackProof>();

export interface PlanAdmissionRollbackResult {
  readonly removed: readonly string[];
  readonly retained: readonly string[];
}

function statIfPresent(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function parents(worktree: string, path: string, create: boolean, createdDirs?: CreatedDirectory[]): void {
  if (realpathSync(worktree) !== worktree) refuse("worktree root is redirected");
  let parent = worktree;
  for (const component of path.split("/").slice(0, -1)) {
    parent = join(parent, component);
    const stat = statIfPresent(parent);
    if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) refuse("rendered plan parent is not a managed directory");
    if (stat === null && create) {
      mkdirSync(parent);
      const created = lstatSync(parent);
      if (!created.isDirectory() || created.isSymbolicLink()) refuse("created plan parent is not a managed directory");
      if (createdDirs && !createdDirs.some((entry) => entry.path === parent)) {
        createdDirs.push({ path: parent, dev: created.dev, ino: created.ino });
      }
    }
  }
}
function basePaths(worktree: string, baseSha: string): string[] {
  if (!/^[a-f0-9]{40}$/u.test(baseSha)) refuse("base must be a full commit SHA");
  const git = systemGitRunner(worktree);
  runGit(git, ["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  // Include trees: an empty-looking subtree or ancestor symlink is not new content.
  return runGit(git, ["ls-tree", "-r", "-t", "--name-only", "-z", baseSha]).split("\0").filter(Boolean);
}

const basePathsCache = new Map<string, string[]>();
function cachedBasePaths(worktree: string, baseSha: string): string[] {
  const key = `${worktree}\0${baseSha}`;
  const existing = basePathsCache.get(key);
  if (existing !== undefined) return existing;
  const paths = basePaths(worktree, baseSha);
  basePathsCache.set(key, paths);
  return paths;
}

function plansRootFrom(worktree?: string, inputPlansRoot?: string): string {
  if (inputPlansRoot !== undefined) return inputPlansRoot.replace(/\/+$/u, "");
  if (worktree !== undefined) {
    const catalogPath = join(worktree, "awsf.project.yaml");
    const stat = statIfPresent(catalogPath);
    if (stat !== null && stat.isFile()) {
      try {
        const catalog = loadCatalog(readFileSync(catalogPath, "utf8"));
        return catalog.plans.root.replace(/\/+$/u, "");
      } catch {
        // fall back to default
      }
    }
  }
  return "specs";
}

function isMountWithoutExecBit(worktree: string): boolean {
  if (process.platform === "win32") return true;
  try {
    const stat = lstatSync(worktree);
    return (stat.mode & 0o777) === 0o777;
  } catch {
    return false;
  }
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
  const isPortableMount = (stat.mode & 0o777) === 0o777 || isMountWithoutExecBit(proof.worktree);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (!isPortableMount && (stat.mode & 0o111) !== 0)) {
    refuse(`${path}: not a regular non-executable admission file`);
  }
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

function unchangedCreatedFile(entry: CreatedFile, worktree: string): boolean {
  try {
    parents(worktree, entry.relativePath, false);
    const before = lstatSync(entry.path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.dev !== entry.dev ||
      before.ino !== entry.ino || (before.mode & 0o777) !== entry.mode) return false;
    const bytes = readFileSync(entry.path);
    const after = lstatSync(entry.path);
    return after.isFile() && !after.isSymbolicLink() && after.nlink === 1 && after.dev === entry.dev &&
      after.ino === entry.ino && (after.mode & 0o777) === entry.mode && bytes.equals(entry.expected);
  } catch { return false; }
}

function rollbackUncommittedAdmission(proof: AdmissionRollbackProof): PlanAdmissionRollbackResult {
  const allPaths = [...proof.files.keys(), ...proof.unverifiedPaths];
  if (proof.consumed) return { removed: [], retained: allPaths };
  proof.consumed = true;
  try {
    const git = systemGitRunner(proof.worktree);
    if (runGit(git, ["rev-parse", "HEAD"]).trim() !== proof.headSha) return { removed: [], retained: allPaths };
    for (const path of allPaths) {
      if (runGit(git, ["ls-files", "--stage", "-z", "--", path]).split("\0").some(Boolean) ||
        runGit(git, ["ls-tree", "-z", "HEAD", "--", path]).split("\0").some(Boolean)) {
        return { removed: [], retained: allPaths };
      }
    }
  } catch { return { removed: [], retained: allPaths }; }

  const removed: string[] = [];
  const retained: string[] = [...proof.unverifiedPaths];
  for (const entry of [...proof.files.values()].reverse()) {
    const file = entry.path;
    try {
      if (!unchangedCreatedFile(entry, proof.worktree)) { retained.push(entry.relativePath); continue; }
      try { rmSync(file, { force: true }); } catch { /* best effort */ }
      if (statIfPresent(file) === null) removed.push(entry.relativePath);
      else retained.push(entry.relativePath);
    } catch { retained.push(entry.relativePath); }
  }
  for (const entry of [...proof.directories].reverse()) {
    const dir = entry.path;
    try {
      const stat = lstatSync(dir);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === entry.dev && stat.ino === entry.ino && readdirSync(dir).length === 0) {
        const confirmed = lstatSync(dir);
        if (confirmed.isDirectory() && !confirmed.isSymbolicLink() && confirmed.dev === entry.dev && confirmed.ino === entry.ino) {
          rmdirSync(dir);
        }
      }
    } catch { /* preserve directories with content or uncertain identity */ }
  }
  return { removed, retained };
}

/** Rolls back only this admission's unchanged, uncommitted files; an unknown token is inert. */
export function rollbackPlanAdmission(value: unknown): PlanAdmissionRollbackResult | null {
  if (typeof value !== "object" || value === null) return null;
  const proof = issuedRollbacks.get(value);
  return proof === undefined ? null : rollbackUncommittedAdmission(proof);
}

interface CachedProofCheck {
  readonly headSha: string;
  readonly verifiedAt: number;
}
const verifiedProofCache = new WeakMap<AdmissionProof, CachedProofCheck>();

/** Recheck content and create-only evidence when the gate runs, not just when minted. */
export function planAdmissionExemptionAllows(value: unknown, path: string): boolean {
  const proof = proofFor(value);
  if (proof === undefined || !proof.documents.has(path)) return false;
  try {
    const cached = verifiedProofCache.get(proof);
    if (cached !== undefined && Date.now() - cached.verifiedAt < 5000) {
      assertCurrentBytes(proof, path);
      return true;
    }
    const git = systemGitRunner(proof.worktree);
    const head = runGit(git, ["rev-parse", "HEAD"]).trim();
    if (cached !== undefined && cached.headSha === head) {
      assertCurrentBytes(proof, path);
      return true;
    }
    assertAbsentAtBase(proof, cachedBasePaths(proof.worktree, proof.baseSha));
    for (const admitted of proof.documents.keys()) assertCurrentBytes(proof, admitted);
    assertGitBytes(proof);
    verifiedProofCache.set(proof, { headSha: head, verifiedAt: Date.now() });
    return true;
  } catch { return false; }
}

/** Host-only verification supports a later gate/replay without granting write authority. */
export function verifyPlanAdmission(input: PlanAdmissionInput & { readonly worktree: string; readonly baseSha: string }): PlanAdmissionCapability {
  const worktree = resolve(input.worktree);
  const root = plansRootFrom(worktree, input.plansRoot);
  const paths = cachedBasePaths(worktree, input.baseSha);
  const pattern = new RegExp(`^${escapeRegex(root)}/([^/]+)\\.html$`, "u");
  const baseStems = paths.map(path => pattern.exec(path)?.[1]).filter((s): s is string => s !== undefined);
  const knownStems = [...new Set([...(input.knownStems ?? []), ...baseStems])];
  const proof = { worktree, baseSha: input.baseSha, documents: planAdmissionDocuments(input, knownStems, root) };
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
  readonly rollback: PlanAdmissionRollbackCapability;
  readonly record: PlanAdmissionRecord;
} {
  const worktree = resolve(input.worktree);
  const git = systemGitRunner(worktree);
  const headSha = runGit(git, ["rev-parse", "HEAD"]).trim();
  const root = plansRootFrom(worktree, input.plansRoot);
  const paths = cachedBasePaths(worktree, input.baseSha);
  const pattern = new RegExp(`^${escapeRegex(root)}/([^/]+)\\.html$`, "u");
  const baseStems = paths.map(path => pattern.exec(path)?.[1]).filter((s): s is string => s !== undefined);
  const knownStems = [...new Set([...(input.knownStems ?? []), ...baseStems])];
  const documents = planAdmissionDocuments(input, knownStems, root);
  assertAbsentAtBase({ worktree, baseSha: input.baseSha, documents }, paths);
  if (input.at.trim().length === 0) refuse("admission timestamp is missing");
  const ticketDirectory = `${root}/tickets/${input.stem}`;
  parents(worktree, `${ticketDirectory}/README.md`, false);
  if (statIfPresent(join(worktree, ticketDirectory)) !== null) refuse("admission ticket directory already exists");
  // Preflight the entire set before creating even a parent directory.
  for (const path of documents.keys()) {
    parents(worktree, path, false);
    if (statIfPresent(join(worktree, path)) !== null) refuse(`${path}: admission target already exists`);
  }
  const rollbackProof: AdmissionRollbackProof = { worktree, headSha, files: new Map(), unverifiedPaths: [], directories: [], consumed: false };
  try {
    for (const [path, content] of documents) {
      parents(worktree, path, true, rollbackProof.directories);
      const target = join(worktree, path);
      const fd = openSync(target, "wx", 0o644);
      try {
        let stat: Stats;
        try { stat = fstatSync(fd); }
        catch (error) { rollbackProof.unverifiedPaths.push(path); throw error; }
        if (!stat.isFile() || stat.nlink !== 1) {
          rollbackProof.unverifiedPaths.push(path);
          refuse(`${path}: admission target is not an exclusive regular file`);
        }
        const owned: CreatedFile = { relativePath: path, path: target, dev: stat.dev, ino: stat.ino,
          mode: stat.mode & 0o777, expected: Buffer.alloc(0) };
        rollbackProof.files.set(path, owned);
        const bytes = Buffer.from(content, "utf8");
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
          if (written === 0) refuse(`${path}: admission write made no progress`);
          offset += written;
          owned.expected = Buffer.from(bytes.subarray(0, offset));
        }
        fsyncSync(fd);
      } finally { closeSync(fd); }
    }
    const capability = verifyPlanAdmission({ ...input, plansRoot: root, knownStems });
    const record: PlanAdmissionRecord = { schema: PLAN_ADMISSION_SCHEMA_ID, stem: input.stem,
      baseSha: input.baseSha, at: input.at, files: [...documents].map(([path, content]) => ({ path, sha256: digest(content) })) };
    const rollback = Object.freeze(Object.create(null)) as PlanAdmissionRollbackCapability;
    issuedRollbacks.set(rollback, rollbackProof);
    return Object.freeze({ documents, capability, rollback, record });
  } catch (error) {
    const rollback = rollbackUncommittedAdmission(rollbackProof);
    if (rollback.retained.length > 0) throw new PlanAdmissionMaterializationError(error, rollback.retained);
    throw error;
  }
}
