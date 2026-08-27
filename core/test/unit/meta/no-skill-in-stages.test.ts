import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

import type { AgentDefinition } from "../../../src/config/schema.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { STAGES } from "../../../src/stages/contract.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";
import { buildWorkflow } from "../../../src/workflow/recipes/build.ts";
import { designToPlanWorkflow } from "../../../src/workflow/recipes/design-to-plan.ts";
import { intakeWorkflow } from "../../../src/workflow/recipes/intake.ts";
import { planBuildTestWorkflow } from "../../../src/workflow/recipes/plan-build-test.ts";
import { simpleSdlcWorkflow } from "../../../src/workflow/recipes/simple-sdlc.ts";
import { DRIVING_REL } from "./_driving.ts";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

// INV-3's fence, legs one and two. Leg one reads the bytes a stage's prompt
// sends. Leg two reads what a stage module's code can reach.
//
// THIS TEST CATCHES SHAPES, NOT INTENTIONS. Every assertion below is a matcher
// over bytes. A prompt that leans on an installed skill without writing any of
// these shapes passes here, and a prompt that mentions one of them innocently
// fails here. Both outcomes are the intended trade: a shape is checkable and an
// intention is not, and the constraint this serves is worth a mechanical fence
// that a reviewer can read in one sitting.
//
// WHAT `execution-isolation.test.ts` ALREADY COVERS. Two claims, both about the
// LAUNCH SURFACE, and neither of them is what this file asserts:
//
//   1. `pi-codex` emits `--no-skills` with its four sibling clean-room flags,
//      pinned in the exact argv ORDER the adapter emits them. A bare
//      `argv.includes` would stay satisfied while the flag drifted to a
//      position that means something else, which is why that pin is exact.
//   2. `.claude/` does not exist at the repository root. A Claude-route phase's
//      cwd is a managed worktree of this repository and `claude-code` has no
//      verified discovery-suppressing flag, so placement is the control. That
//      claim is ABSENCE — no tree at the path a CLI would scan — which is
//      strictly weaker than isolation and is the one this repository can hold.
//
// WHAT THIS FILE ADDS. Leg one reads the bytes inside the prompt, which neither
// of those claims touches, and reads them AFTER composition: W06 joins the role
// contract to `prompts/shared/headless-role.md` (plus the reviewer overlay)
// before a provider sees anything, so scanning one role fragment would miss a
// shape introduced by the shared block. Leg two walks the relative-import graph
// out of `core/src/stages/**` and reads the path literals every reachable file
// spells — an in-repository reach that survives `--no-skills` untouched and
// that an absent `.claude/` at the root says nothing about, because the driving
// tree it would reach lives at `docs/driving/`. Three disjoint claims: delete
// none of them believing another covers it.
//
// A STAGE OWNED BY THE HOST SENDS NO PROMPT. The contract records `owner:
// "host"` on all five stages, because the host drives every one of them; the
// distinction that matters here is whether the WORK inside a stage is done by a
// role. That is the phase-level `owner`, so this test resolves each stage's
// producer to its recipe and takes every `kind: "agent"` phase's owner. A stage
// whose producer is a host command contributes no role and no bytes.

const CONFIG_PATH = join(repoRoot(), "awsf.config.yaml");
const SHARED_PROMPT_PATH = "prompts/shared/headless-role.md";

interface RecipePhases {
  readonly id: string;
  readonly phases: readonly {
    readonly id: string;
    readonly kind: string;
    readonly owner: string;
    /** Leg three's subject: the gates a stage's producer attaches to its phases. */
    readonly gates: readonly { readonly id: string }[];
  }[];
}

/** Every shipped recipe, so a producer this contract names always resolves. */
const RECIPES: ReadonlyMap<string, RecipePhases> = new Map<string, RecipePhases>(
  ([
    buildWorkflow,
    buildReviewWorkflow,
    designToPlanWorkflow,
    intakeWorkflow,
    planBuildTestWorkflow,
    simpleSdlcWorkflow,
  ] as readonly RecipePhases[]).map((recipe) => [recipe.id, recipe]),
);

interface NamedPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

const SKILL_SHAPES: readonly NamedPattern[] = [
  // A leading-slash command invocation: `/land`, `/code-review`. Anchored to a
  // line start or an opening delimiter so a schema id like
  // `awsf.design-output/v1` and a URL's `//` are not matches.
  { name: "slash-command", pattern: /(?:^|[\s("'`])(\/[a-z][a-z0-9-]*)\b/gm },
  // The filename a packaged skill is always declared in.
  { name: "skill-manifest", pattern: /\bSKILL\.md\b/g },
  // A `skills/` path segment, wherever the tree it points at happens to live.
  { name: "skills-path-segment", pattern: /(?:^|[^\w-])(skills\/)/gi },
  // Any `.claude` path. The driving tree is at `docs/driving/` precisely so a
  // worker's cwd holds nothing a provider CLI would scan.
  { name: "dot-claude-path", pattern: /(\.claude)\b/g },
  // The shape that makes a phase depend on a document without ever naming a
  // skill: "read <document> before <deciding>". Bounded to one sentence so an
  // unrelated `read` and an unrelated `before` paragraphs apart are not joined.
  { name: "read-document-before", pattern: /(\bread\b[^.!?\n]{0,80}?\bbefore\b)/gi },
];

interface PromptSource {
  readonly role: string;
  /** The file the matched bytes came from, resolved through the composed span. */
  readonly file: string;
  readonly bytes: string;
}

function agentFor(role: string): AgentDefinition {
  const config = loadConfig(readFileSync(CONFIG_PATH, "utf8"));
  const agent = config.agents.find((candidate) => candidate.name === role);
  assert.ok(agent !== undefined, `config declares no agent named ${role}`);
  return agent;
}

/** The roles a stage's own phases hand work to; empty for a host command. */
function rolesForStage(stage: (typeof STAGES)[number]): readonly string[] {
  const recipe = RECIPES.get(stage.producer);
  if (recipe === undefined) {
    assert.equal(
      stage.granularity,
      "command",
      `stage ${stage.id} names producer ${stage.producer}, which is neither a shipped recipe nor a host command`,
    );
    return [];
  }
  return [...new Set(recipe.phases.filter((phase) => phase.kind === "agent").map((phase) => phase.owner))].sort();
}

function stageRoles(): readonly string[] {
  return [...new Set(STAGES.flatMap((stage) => rolesForStage(stage)))].sort();
}

/**
 * Splits the composed system bytes back into the two files they came from, so a
 * failure names a file a person can open. The scan itself still reads the
 * composed bytes; this only attributes a match once one is found.
 */
function composedSources(role: string, agent: AgentDefinition, systemPrompt: string, userPrompt: string): readonly PromptSource[] {
  const roleSystemBytes = readFileSync(join(repoRoot(), agent.prompt.system), "utf8");
  const sources: PromptSource[] = [{ role, file: agent.prompt.user, bytes: userPrompt }];
  if (systemPrompt.startsWith(roleSystemBytes)) {
    sources.push({ role, file: agent.prompt.system, bytes: roleSystemBytes });
    sources.push({ role, file: SHARED_PROMPT_PATH, bytes: systemPrompt.slice(roleSystemBytes.length) });
  } else {
    sources.push({ role, file: `${agent.prompt.system} + ${SHARED_PROMPT_PATH}`, bytes: systemPrompt });
  }
  return sources;
}

function offendersIn(source: PromptSource): readonly string[] {
  const offenders: string[] = [];
  for (const { name, pattern } of SKILL_SHAPES) {
    for (const match of source.bytes.matchAll(pattern)) {
      const matched = match[1] ?? match[0];
      const line = source.bytes.slice(0, match.index).split("\n").length;
      offenders.push(`${source.file}:${String(line)} (${source.role}, ${name}) ${JSON.stringify(matched.trim())}`);
    }
  }
  return offenders;
}

async function scanComposedPrompts(): Promise<{ readonly offenders: readonly string[]; readonly scanned: readonly PromptSource[] }> {
  const offenders: string[] = [];
  const scanned: PromptSource[] = [];
  for (const role of stageRoles()) {
    const agent = agentFor(role);
    const bundle = await composePromptBundle({ configPath: CONFIG_PATH, agent });
    for (const source of composedSources(role, agent, bundle.systemPrompt, bundle.userPrompt)) {
      scanned.push(source);
      offenders.push(...offendersIn(source));
    }
  }
  return { offenders: offenders.sort(), scanned };
}

test("every role a stage hands work to is resolvable and composes real bytes", async () => {
  const roles = stageRoles();
  assert.ok(roles.length > 0, "no stage hands work to a role; this fence would be vacuously green");
  const { scanned } = await scanComposedPrompts();
  for (const source of scanned) {
    assert.ok(source.bytes.length > 0, `${source.role} composed no bytes for ${source.file}`);
  }
});

test("no composed stage prompt carries a skill-invocation shape", async () => {
  const { offenders } = await scanComposedPrompts();
  assert.deepEqual(offenders, []);
});

test("each shape is proven to match the thing it names", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["slash-command", "Then run /land to finish.\n"],
    ["skill-manifest", "Follow the steps in SKILL.md.\n"],
    ["skills-path-segment", "The recipe lives under skills/land/.\n"],
    ["dot-claude-path", "Open .claude/commands/land.md first.\n"],
    ["read-document-before", "Read the driving cookbook before you decide.\n"],
  ];
  for (const [name, sample] of cases) {
    const offenders = offendersIn({ role: "synthetic", file: "synthetic.md", bytes: sample });
    assert.ok(
      offenders.some((offender) => offender.includes(`, ${name})`)),
      `pattern ${name} did not match its own sample: ${JSON.stringify(sample)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Leg two: nothing reachable from the stage module reaches a document tree.
//
// The walk is the one `quota-fence.test.ts` introduced, and for the same
// reason it was written: a direct-import scan is satisfied by putting one
// intermediate file between the two ends. `core/src/stages/x.ts` importing
// `core/src/y.ts` which spells `docs/driving/...` is the shape a one-hop scan
// misses, so this follows the full relative-import closure and reports EVERY
// HOP of an offending chain. An endpoint alone tells a reader what was reached
// but not which edge to cut.
//
// The reach is read for PATH LITERALS, not for imports of the tree: the driving
// documents are markdown and nothing imports them. What a file can spell is
// `join(root, "docs", "driving", ...)` or `".claude/skills/..."`, so the
// matcher works on string literals — including the segments of a `join`/
// `resolve` call and of a template — and compares them segment by segment.
// Comments are not scanned. A comment naming the tree reaches nothing.
//
// INV-5's absence rides on this same closure for free: the resolver answers and
// never acts, so nothing in the reach may import `core/src/execution/**` at
// all. That is a wider claim than `no-stage-advance.test.ts` makes — that file
// bars the two process-launch boundaries by name, because its subject is
// advancing; this one bars the directory, because its subject is acting.
// ---------------------------------------------------------------------------

const SOURCE_ROOT = join(repoRoot(), "core", "src");
const STAGES_PREFIX = "core/src/stages/";
const EXECUTION_PREFIX = "core/src/execution/";
const DRIVING_SEGMENTS = DRIVING_REL.split("/");
const DOT_CLAUDE_SEGMENT = ".claude";

const RELATIVE_IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[\w$*{},\s]+\s+from\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*(["'])(\.\.?\/[^"'`\r\n]+)\1/g,
  /\bimport\s*\(\s*(["'])(\.\.?\/[^"'`\r\n]+)\1\s*\)/g,
] as const;

interface ImportEdge {
  readonly target: string;
  readonly line: number;
}

function sourceFileAt(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function relativeImports(file: string, sourceFiles: ReadonlySet<string>): readonly ImportEdge[] {
  const source = readFileSync(file, "utf8");
  const edges = new Map<string, number>();
  for (const pattern of RELATIVE_IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const unresolved = resolve(dirname(file), specifier);
      const candidates = extname(unresolved) === ""
        ? [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, join(unresolved, "index.ts"), join(unresolved, "index.tsx")]
        : [unresolved];
      const target = candidates.find((candidate) => sourceFiles.has(candidate));
      if (target === undefined) continue;
      const relativeTarget = relRepo(target);
      if (!edges.has(relativeTarget)) edges.set(relativeTarget, source.slice(0, match.index).split("\n").length);
    }
  }
  return [...edges].map(([target, line]) => ({ target, line }));
}

function buildRelativeImportGraph(): ReadonlyMap<string, readonly ImportEdge[]> {
  const files = walkFiles(SOURCE_ROOT);
  const sourceFiles = new Set(files);
  return new Map(files.map((file) => [relRepo(file), relativeImports(file, sourceFiles)]));
}

/** Each map value is the shortest relative-import chain from a stage source, hop by hop. */
function stageReach(graph: ReadonlyMap<string, readonly ImportEdge[]>): ReadonlyMap<string, readonly string[]> {
  const starts = [...graph.keys()].filter((file) => file.startsWith(STAGES_PREFIX)).sort();
  const chains = new Map<string, readonly string[]>(starts.map((start) => [start, [start]]));
  const queue = [...starts];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current === undefined) continue;
    const chain = chains.get(current)!;
    for (const edge of graph.get(current) ?? []) {
      if (chains.has(edge.target)) continue;
      chains.set(edge.target, [...chain, edge.target]);
      queue.push(edge.target);
    }
  }
  return chains;
}

/** The document tree a path spells, compared segment by segment so `docs/drivings` is not a match. */
function documentTreeName(candidate: string): string | null {
  const segments = candidate.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
  if (segments.includes(DOT_CLAUDE_SEGMENT)) return "dot-claude-path";
  for (let start = 0; start + DRIVING_SEGMENTS.length <= segments.length; start += 1) {
    if (DRIVING_SEGMENTS.every((segment, offset) => segments[start + offset] === segment)) return "driving-tree-path";
  }
  return null;
}

/**
 * Every way a file spells a path in one string: a literal, the string segments
 * of a `join`/`resolve` call, and the fixed parts of a template.
 */
function pathCandidates(source: ts.SourceFile): readonly { readonly text: string; readonly line: number }[] {
  const candidates: { text: string; line: number }[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      candidates.push({ text: node.text, line: lineOf(node) });
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      candidates.push({ text: parts.join("/"), line: lineOf(node) });
    } else if (ts.isCallExpression(node)) {
      const segments = node.arguments.filter(ts.isStringLiteralLike).map((argument) => argument.text);
      if (segments.length > 1) candidates.push({ text: segments.join("/"), line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates;
}

function offendersInSource(relativeFile: string, source: ts.SourceFile): readonly string[] {
  const offenders: string[] = [];
  for (const candidate of pathCandidates(source)) {
    const name = documentTreeName(candidate.text);
    if (name !== null) offenders.push(`${relativeFile}:${String(candidate.line)} (${name}) ${JSON.stringify(candidate.text)}`);
  }
  return offenders;
}

function documentPathOffenders(relativeFile: string): readonly string[] {
  return offendersInSource(relativeFile, sourceFileAt(join(repoRoot(), relativeFile)));
}

test("the stage module's transitive reach is non-empty, so leg two is not vacuously green", () => {
  const graph = buildRelativeImportGraph();
  const starts = [...graph.keys()].filter((file) => file.startsWith(STAGES_PREFIX));
  assert.ok(starts.length > 0, `no source file under ${STAGES_PREFIX}; this leg would walk nothing`);
  assert.ok(
    stageReach(graph).size > starts.length,
    "the stage module imports nothing at all; confirm the import graph still resolves before trusting this leg",
  );
});

test("nothing reachable from the stage module resolves a path into a document tree", () => {
  const chains = stageReach(buildRelativeImportGraph());
  const offenders: string[] = [];

  for (const [file, chain] of chains) {
    for (const offender of documentPathOffenders(file)) {
      offenders.push(`${offender}\n    via ${chain.join(" -> ")}`);
    }
  }

  assert.deepEqual(offenders.sort(), []);
});

test("nothing reachable from the stage module imports core/src/execution", () => {
  const graph = buildRelativeImportGraph();
  const chains = stageReach(graph);
  const offenders: string[] = [];

  for (const [file, chain] of chains) {
    for (const edge of graph.get(file) ?? []) {
      if (!edge.target.startsWith(EXECUTION_PREFIX)) continue;
      offenders.push(`${file}:${String(edge.line)} imports ${edge.target}\n    via ${[...chain, edge.target].join(" -> ")}`);
    }
  }

  assert.deepEqual(offenders.sort(), []);
});

test("the document-tree matcher matches the paths it names and nothing beside them", () => {
  const matches: readonly (readonly [string, string])[] = [
    ["driving-tree-path", `${DRIVING_REL}/skills/land.md`],
    ["driving-tree-path", "../../docs/driving"],
    ["driving-tree-path", "docs\\driving\\cookbook.md"],
    ["dot-claude-path", ".claude/commands/land.md"],
    ["dot-claude-path", "/home/owner/.claude"],
  ];
  for (const [name, sample] of matches) {
    assert.equal(documentTreeName(sample), name, `${JSON.stringify(sample)} should match ${name}`);
  }

  for (const sample of ["docs/drivings/x.md", "docs/design/driving-notes.md", "src/claude-code.ts", "dotclaude/x"]) {
    assert.equal(documentTreeName(sample), null, `${JSON.stringify(sample)} is not a document-tree path`);
  }
});

test("each way a file can spell a document path is proven to be read", () => {
  const spellings: readonly (readonly [string, string])[] = [
    ["a bare literal", `const doc = "${DRIVING_REL}/cookbook.md";\n`],
    ["join segments", 'const doc = join(repoRoot(), "docs", "driving", "cookbook.md");\n'],
    ["a template", "const doc = `${root}/.claude/commands/land.md`;\n"],
  ];
  for (const [spelling, sample] of spellings) {
    const source = ts.createSourceFile("synthetic.ts", sample, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.notEqual(
      offendersInSource("synthetic.ts", source).length,
      0,
      `${spelling} was not read as a path: ${JSON.stringify(sample)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Leg three: no gate the stage contract names reaches its verdict by reading a
// file.
//
// WHAT A GREEN RESULT HERE MEANS, STATED AS NARROWLY AS IT IS TRUE. A gate this
// contract names does not READ a document. Neither its `run` closure nor
// anything that closure can transitively call performs a filesystem read, and
// the closure's only inputs are `context.envelope`, `context.previousEnvelope`,
// and whatever the host passed it as an argument.
//
// WHAT IT DOES NOT MEAN. It does not prove the document is irrelevant to
// whoever WROTE the gate. Someone can read a cookbook, transcribe its rule into
// a comparison over envelope fields, and pass here — correctly, because the
// gate that then runs depends on the envelope and on nothing else. No test can
// reach the author's desk, and this one does not pretend to. What it removes is
// the runtime dependency: a gate whose verdict changes when a file changes.
//
// SCOPE: THE GATES THIS WORKSTREAM'S STAGE CONTRACT NAMES, AND NO OTHERS. Q8
// decided this. `core/src/gates/git-diff.ts` compares a producer's claims
// against the worktree the host observed, `core/src/gates/command-evidence.ts`
// windows the output of a command the host ran, and
// `core/src/gates/contract-digest.ts` reads the repository outright — observing
// the repository IS their evidence. A fence over `GATE_IDS` would go red on its
// first run for a reason that is not a defect. So a green result here is a
// claim about the gates below, and never a claim about the gate registry.
//
// WHY THE WALK IS CLOSURE-SCOPED RATHER THAN FILE-SCOPED. The recipe file that
// declares these gates also calls `loadUserPrompt` at module scope, which reads
// a prompt off disk before any gate object exists. That read is legitimate and
// sits outside every gate, so "does the file import `fs`" is the wrong question
// and would answer yes for the wrong reason. The walk starts at the `run`
// property and follows only what `run` can actually call.
// ---------------------------------------------------------------------------

const SOURCE_PREFIX = "core/src/";
const RECIPES_PREFIX = "core/src/workflow/recipes/";
const GATES_PREFIX = "core/src/gates/";
const PHASE_MODULE = "core/src/workflow/phase.ts";
const GATE_CONTEXT_TYPE = "PhaseGateContext";

/**
 * The context members a gate may read. The rest of `PhaseGateContext` is host
 * bookkeeping — and `worktree` is a directory path, which is where reading a
 * document starts. The allowlist is checked against the real interface below,
 * so a typo here cannot silently widen it.
 */
const GATE_CONTEXT_INPUTS: ReadonlySet<string> = new Set(["envelope", "previousEnvelope"]);

const FS_MODULE_PATTERN = /^(?:node:)?fs(?:\/promises)?$/;

/**
 * Read shapes by NAME, matched wherever the name appears in the reach. The
 * symbol check below already catches every real `node:fs` binding, including
 * renamed and namespace imports; this list is the backstop for a hand-rolled
 * wrapper, which by convention borrows the well-known name. Names are matched
 * whole, so `readFileSync` matches and `readFileName` does not.
 */
const FILESYSTEM_READ_SHAPES: readonly NamedPattern[] = [
  { name: "read-file", pattern: /^readFile(?:Sync)?$/ },
  { name: "read-directory", pattern: /^(?:readdir|opendir)(?:Sync)?$/ },
  { name: "path-exists", pattern: /^(?:exists|existsSync|accessSync)$/ },
  { name: "stat-path", pattern: /^[lf]?stat(?:Sync)?$/ },
  { name: "resolve-link", pattern: /^(?:realpath|readlink)(?:Sync)?$/ },
  { name: "open-handle", pattern: /^(?:openSync|createReadStream)$/ },
  { name: "directory-walk", pattern: /^(?:glob|globSync|walkFiles|walkDirectory)$/ },
];

/**
 * A gate reading an ambient value is the same defect wearing different clothes.
 * The process environment, the process working directory and the module's own
 * directory are each one step from a path, and none of them is an input the
 * host passed in.
 */
const AMBIENT_VALUE_SHAPES: readonly NamedPattern[] = [
  { name: "process-global", pattern: /^process$/ },
  { name: "global-object", pattern: /^globalThis$/ },
  { name: "module-path-global", pattern: /^__(?:dirname|filename)$/ },
  { name: "commonjs-require", pattern: /^require$/ },
];

interface NamedGate {
  readonly stage: string;
  readonly recipe: string;
  readonly phase: string;
  readonly gate: string;
}

interface GateClosure extends NamedGate {
  /** The `run` function node, taken from the recipe source rather than the value. */
  readonly run: ts.Node;
}

/** One declaration the walk entered, with the hop-by-hop chain that reached it. */
interface Reached {
  readonly node: ts.Node;
  readonly chain: readonly string[];
  readonly depth: number;
}

let cachedProgram: { readonly program: ts.Program; readonly checker: ts.TypeChecker } | undefined;

/** A checked program over `core/src`, so a symbol can be followed to its declaration. */
function sourceProgram(): { readonly program: ts.Program; readonly checker: ts.TypeChecker } {
  if (cachedProgram !== undefined) return cachedProgram;
  const configPath = join(repoRoot(), "tsconfig.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, repoRoot());
  const program = ts.createProgram({ rootNames: walkFiles(SOURCE_ROOT), options: parsed.options });
  cachedProgram = { program, checker: program.getTypeChecker() };
  return cachedProgram;
}

function stringProperty(node: ts.ObjectLiteralExpression, name: string): string | null {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) || property.name.text !== name) continue;
    if (ts.isStringLiteralLike(property.initializer)) return property.initializer.text;
  }
  return null;
}

function arrayProperty(node: ts.ObjectLiteralExpression, name: string): ts.ArrayLiteralExpression | null {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) || property.name.text !== name) continue;
    if (ts.isArrayLiteralExpression(property.initializer)) return property.initializer;
  }
  return null;
}

/** `run` written either as a property holding a function or as a method. */
function runProperty(node: ts.ObjectLiteralExpression): ts.Node | null {
  for (const property of node.properties) {
    if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name) && property.name.text === "run") {
      return property;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    if (ts.isIdentifier(property.name) && property.name.text === "run") return property.initializer;
  }
  return null;
}

function objectElements(array: ts.ArrayLiteralExpression): readonly ts.ObjectLiteralExpression[] {
  return array.elements.filter((element): element is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(element));
}

/** Every recipe object literal in the recipes directory, keyed by the id it declares. */
function recipeLiterals(program: ts.Program): ReadonlyMap<string, ts.ObjectLiteralExpression> {
  const literals = new Map<string, ts.ObjectLiteralExpression>();
  for (const source of program.getSourceFiles()) {
    if (!relRepo(source.fileName).startsWith(RECIPES_PREFIX)) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const id = stringProperty(node, "id");
        if (id !== null && arrayProperty(node, "phases") !== null) literals.set(id, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return literals;
}

/** Every gate a stage's producer attaches, read from the recipe values. */
function namedGates(): readonly NamedGate[] {
  return STAGES.flatMap((stage) => {
    const recipe = RECIPES.get(stage.producer);
    if (recipe === undefined) return [];
    return recipe.phases.flatMap((phase) =>
      phase.gates.map((gate) => ({
        stage: stage.id,
        recipe: recipe.id,
        phase: phase.id,
        gate: gate.id,
      })));
  });
}

/**
 * Binds each named gate to its `run` node in the recipe source. Every lookup
 * asserts rather than skips: a gate the value declares and the AST cannot find
 * has to fail loudly, because silently shrinking the fence is how it goes green
 * while catching nothing.
 */
function gateClosures(): readonly GateClosure[] {
  const { program } = sourceProgram();
  const literals = recipeLiterals(program);
  return namedGates().map((named) => {
    const where = `${named.stage}/${named.phase}/${named.gate}`;
    const recipe = literals.get(named.recipe);
    assert.ok(recipe !== undefined, `${where}: no recipe literal under ${RECIPES_PREFIX} declares id ${named.recipe}`);
    const phases = arrayProperty(recipe, "phases");
    assert.ok(phases !== null, `${where}: recipe ${named.recipe} has no phases array literal`);
    const phase = objectElements(phases).find((element) => stringProperty(element, "id") === named.phase);
    assert.ok(phase !== undefined, `${where}: recipe ${named.recipe} declares no phase literal ${named.phase}`);
    const gates = arrayProperty(phase, "gates");
    assert.ok(gates !== null, `${where}: phase ${named.phase} has no gates array literal`);
    const gate = objectElements(gates).find((element) => stringProperty(element, "id") === named.gate);
    assert.ok(gate !== undefined, `${where}: phase ${named.phase} declares no gate literal ${named.gate}`);
    const run = runProperty(gate);
    assert.ok(run !== null, `${where}: gate declares no run`);
    return { ...named, run };
  });
}

function resolvedDeclarations(symbol: ts.Symbol, checker: ts.TypeChecker): readonly ts.Declaration[] {
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
  return resolved.declarations ?? [];
}

function positionOf(node: ts.Node): string {
  const source = node.getSourceFile();
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  return `${relRepo(source.fileName)}:${String(line)}`;
}

/**
 * What the walk steps into: a module-level value declaration or a class member.
 * A local binding already sits inside a body being scanned, so entering it
 * again would double-count without reaching anything new.
 */
function reachTarget(declaration: ts.Declaration): boolean {
  if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) return true;
  if (ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration)) return true;
  if (ts.isGetAccessorDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) return true;
  if (ts.isVariableDeclaration(declaration)) {
    const statement = declaration.parent.parent;
    return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent);
  }
  return false;
}

/**
 * The `run` closure and everything it can transitively call, breadth-first, so
 * each declaration carries the SHORTEST chain that reached it. An offender
 * reported with only its endpoint tells a reader what was reached but not which
 * edge to cut.
 */
function closureReach(closure: GateClosure, checker: ts.TypeChecker): readonly Reached[] {
  const entered = new Set<ts.Node>([closure.run]);
  const reached: Reached[] = [{ node: closure.run, chain: [`gate ${closure.gate}`], depth: 0 }];
  let cursor = 0;
  while (cursor < reached.length) {
    const current = reached[cursor];
    cursor += 1;
    if (current === undefined) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        for (const declaration of symbol === undefined ? [] : resolvedDeclarations(symbol, checker)) {
          const source = declaration.getSourceFile();
          if (source.isDeclarationFile) continue;
          if (!relRepo(source.fileName).startsWith(SOURCE_PREFIX)) continue;
          if (!reachTarget(declaration) || entered.has(declaration)) continue;
          entered.add(declaration);
          reached.push({
            node: declaration,
            chain: [...current.chain, `${positionOf(declaration)} ${node.text}`],
            depth: current.depth + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(current.node);
  }
  return reached;
}

/** The `node:fs` module an identifier's symbol was declared in, if any. */
function fsModuleOf(node: ts.Identifier, checker: ts.TypeChecker): string | null {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return null;
  for (const declaration of resolvedDeclarations(symbol, checker)) {
    for (let scope: ts.Node | undefined = declaration; scope !== undefined; scope = scope.parent) {
      if (ts.isModuleDeclaration(scope) && ts.isStringLiteral(scope.name) && FS_MODULE_PATTERN.test(scope.name.text)) {
        return scope.name.text;
      }
    }
  }
  return null;
}

/** `require("fs")` and `import("node:fs")`: reaching fs without an import statement. */
function fsModuleRequest(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const callsRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!callsRequire && node.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const [specifier] = node.arguments;
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return null;
  return FS_MODULE_PATTERN.test(specifier.text) ? specifier.text : null;
}

function shapeOf(shapes: readonly NamedPattern[], name: string): string | null {
  return shapes.find((shape) => shape.pattern.test(name))?.name ?? null;
}

/** True when the identifier reads a value, rather than naming a member, key, or binding. */
function readsAValue(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isQualifiedName(parent)) return parent.left === node;
  if (ts.isBindingElement(parent)) return parent.propertyName !== node && parent.name !== node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) return parent.name !== node;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isParameter(parent) || ts.isVariableDeclaration(parent)) return parent.name !== node;
  if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name !== node;
  if (ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) return parent.name !== node;
  return true;
}

function offenderLine(reached: Reached, node: ts.Node, shape: string, detail: string): string {
  return `${positionOf(node)} (${shape}) ${detail}\n    via ${reached.chain.join(" -> ")}`;
}

function filesystemOffenders(reached: Reached, checker: ts.TypeChecker): readonly string[] {
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    const request = fsModuleRequest(node);
    if (request !== null) offenders.push(offenderLine(reached, node, "fs-module-request", JSON.stringify(request)));
    if (ts.isIdentifier(node)) {
      const fsModule = fsModuleOf(node, checker);
      if (fsModule !== null) {
        offenders.push(offenderLine(reached, node, "node-fs-binding", `${node.text} from ${JSON.stringify(fsModule)}`));
      }
      const shape = shapeOf(FILESYSTEM_READ_SHAPES, node.text);
      if (shape !== null) offenders.push(offenderLine(reached, node, shape, node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(reached.node);
  return offenders;
}

function ambientOffenders(reached: Reached): readonly string[] {
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      offenders.push(offenderLine(reached, node, "import-meta", node.getText(node.getSourceFile())));
    }
    if (ts.isIdentifier(node) && readsAValue(node)) {
      const shape = shapeOf(AMBIENT_VALUE_SHAPES, node.text);
      if (shape !== null) offenders.push(offenderLine(reached, node, shape, node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(reached.node);
  return offenders;
}

/**
 * The positive half: what the closure takes IN. The gate contract passes one
 * context, so a closure may read that context's `envelope` and
 * `previousEnvelope`, take an argument the host bound, or take nothing at all.
 * Handing the whole context to a callee is refused too: the callee would then
 * hold `worktree`, one property access away from a path.
 */
function contextInputOffenders(closure: GateClosure, checker: ts.TypeChecker): readonly string[] {
  const run = closure.run;
  if (!ts.isArrowFunction(run) && !ts.isFunctionExpression(run) && !ts.isMethodDeclaration(run)) {
    return [`${closure.gate}: run is ${ts.SyntaxKind[run.kind]}, which this walk cannot read as a closure`];
  }
  const parameters = run.parameters;
  if (parameters.length === 0) return [];
  if (parameters.length > 1) {
    return [`${closure.gate}: run takes ${String(parameters.length)} parameters; the gate contract passes one context`];
  }
  const binding = parameters[0]!.name;
  const offenders: string[] = [];

  if (ts.isObjectBindingPattern(binding)) {
    for (const element of binding.elements) {
      const key = element.propertyName ?? element.name;
      const name = ts.isIdentifier(key) ? key.text : key.getText(key.getSourceFile());
      if (!GATE_CONTEXT_INPUTS.has(name)) {
        offenders.push(`${positionOf(element)} ${closure.gate} destructures context.${name}`);
      }
    }
    return offenders;
  }
  if (!ts.isIdentifier(binding)) {
    return [`${positionOf(binding)} ${closure.gate} binds the gate context with an array pattern`];
  }

  const parameterSymbol = checker.getSymbolAtLocation(binding);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== binding && checker.getSymbolAtLocation(node) === parameterSymbol) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (!GATE_CONTEXT_INPUTS.has(parent.name.text)) {
          offenders.push(`${positionOf(node)} ${closure.gate} reads context.${parent.name.text}`);
        }
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        offenders.push(`${positionOf(node)} ${closure.gate} reads the gate context through a computed key`);
      } else {
        offenders.push(`${positionOf(node)} ${closure.gate} passes the whole gate context on`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(run);
  return offenders;
}

/** Every member `PhaseGateContext` actually declares, including what it inherits. */
function gateContextMembers(): readonly string[] {
  const { program, checker } = sourceProgram();
  const expected = resolve(repoRoot(), PHASE_MODULE);
  const source = program.getSourceFiles().find((candidate) => resolve(candidate.fileName) === expected);
  assert.ok(source !== undefined, `missing source file ${PHASE_MODULE}`);
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === GATE_CONTEXT_TYPE);
  assert.ok(declaration !== undefined, `${PHASE_MODULE} declares no interface ${GATE_CONTEXT_TYPE}`);
  const symbol = checker.getSymbolAtLocation(declaration.name);
  assert.ok(symbol !== undefined, `${GATE_CONTEXT_TYPE} has no symbol`);
  return checker.getDeclaredTypeOfSymbol(symbol).getProperties().map((property) => property.name).sort();
}

test("every gate the stage contract names resolves to a closure the walk enters transitively", () => {
  const { checker } = sourceProgram();
  const closures = gateClosures();
  assert.ok(closures.length > 0, "the stage contract names no gate; this leg would be vacuously green");

  const files = new Set<string>();
  let deepest = 0;
  let deepestChain: readonly string[] = [];
  for (const closure of closures) {
    for (const reached of closureReach(closure, checker)) {
      files.add(relRepo(reached.node.getSourceFile().fileName));
      if (reached.depth > deepest) {
        deepest = reached.depth;
        deepestChain = reached.chain;
      }
    }
  }

  assert.ok(
    [...files].some((file) => file.startsWith(GATES_PREFIX)),
    `no gate closure reached a file under ${GATES_PREFIX}; the walk stopped at ${[...files].sort().join(", ")}`,
  );
  assert.ok(
    deepest >= 2,
    `the deepest chain is ${String(deepest)} hop(s): ${deepestChain.join(" -> ")}. A one-hop walk is a direct scan, and this leg is transitive by design`,
  );
});

test("no gate the stage contract names reaches a filesystem read", () => {
  const { checker } = sourceProgram();
  const offenders: string[] = [];
  for (const closure of gateClosures()) {
    for (const reached of closureReach(closure, checker)) {
      offenders.push(...filesystemOffenders(reached, checker));
    }
  }
  assert.deepEqual(offenders.sort(), []);
});

test("every gate the stage contract names draws its inputs from the envelope or its arguments", () => {
  const { checker } = sourceProgram();
  const offenders: string[] = [];
  for (const closure of gateClosures()) {
    offenders.push(...contextInputOffenders(closure, checker));
    for (const reached of closureReach(closure, checker)) {
      offenders.push(...ambientOffenders(reached));
    }
  }
  assert.deepEqual(offenders.sort(), []);
});

test("the gate-context input allowlist names real members of PhaseGateContext", () => {
  const members = gateContextMembers();
  const unknown = [...GATE_CONTEXT_INPUTS].filter((input) => !members.includes(input)).sort();
  assert.deepEqual(
    unknown,
    [],
    `the allowlist names members ${GATE_CONTEXT_TYPE} does not declare; its members are ${members.join(", ")}`,
  );
  const barred = members.filter((member) => !GATE_CONTEXT_INPUTS.has(member)).sort();
  assert.ok(
    barred.length > 0,
    `the allowlist covers every member of ${GATE_CONTEXT_TYPE}, so it bars nothing`,
  );
});

test("each filesystem-read and ambient shape is proven to match the thing it names", () => {
  const reads: readonly (readonly [string, string])[] = [
    ["read-file", "readFileSync"],
    ["read-directory", "readdirSync"],
    ["path-exists", "existsSync"],
    ["stat-path", "statSync"],
    ["resolve-link", "realpathSync"],
    ["open-handle", "createReadStream"],
    ["directory-walk", "walkFiles"],
  ];
  for (const [name, sample] of reads) {
    assert.equal(shapeOf(FILESYSTEM_READ_SHAPES, sample), name, `${sample} should match ${name}`);
  }
  for (const sample of ["readFileName", "readEnvelope", "statement", "opendirection", "globalThis"]) {
    assert.equal(shapeOf(FILESYSTEM_READ_SHAPES, sample), null, `${sample} is not a filesystem read`);
  }

  const ambient: readonly (readonly [string, string])[] = [
    ["process-global", "process"],
    ["global-object", "globalThis"],
    ["module-path-global", "__dirname"],
    ["module-path-global", "__filename"],
    ["commonjs-require", "require"],
  ];
  for (const [name, sample] of ambient) {
    assert.equal(shapeOf(AMBIENT_VALUE_SHAPES, sample), name, `${sample} should match ${name}`);
  }
  for (const sample of ["preprocess", "processed", "requireHostExecution", "dirname"]) {
    assert.equal(shapeOf(AMBIENT_VALUE_SHAPES, sample), null, `${sample} is not an ambient value`);
  }

  for (const specifier of ["fs", "node:fs", "fs/promises", "node:fs/promises"]) {
    const sample = `const handle = require(${JSON.stringify(specifier)});\n`;
    const source = ts.createSourceFile("synthetic.ts", sample, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const requests: string[] = [];
    const visit = (node: ts.Node): void => {
      const request = fsModuleRequest(node);
      if (request !== null) requests.push(request);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.deepEqual(requests, [specifier], `${JSON.stringify(sample)} was not read as an fs request`);
  }
});
