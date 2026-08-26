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
  readonly phases: readonly { readonly kind: string; readonly owner: string }[];
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
