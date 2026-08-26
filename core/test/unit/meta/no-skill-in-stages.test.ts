import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

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
import { repoRoot } from "./_walk.ts";

// Leg one of INV-3's three-leg fence: no prompt a stage sends carries a
// skill-invocation shape.
//
// THIS TEST CATCHES SHAPES, NOT INTENTIONS. Every assertion below is a regex
// over bytes. A prompt that leans on an installed skill without writing any of
// these shapes passes here, and a prompt that mentions one of them innocently
// fails here. Both outcomes are the intended trade: a shape is checkable and an
// intention is not, and the constraint this serves is worth a mechanical fence
// that a reviewer can read in one sitting.
//
// WHAT THIS ADDS OVER `execution-isolation.test.ts`. That file pins pi's
// `--no-skills` in exact argv order and asserts `.claude/` does not exist at
// the repository root — both claims about the LAUNCH SURFACE. Neither says
// anything about the bytes inside the prompt. This one reads those bytes, and
// it reads them AFTER composition: W06 joins the role contract to
// `prompts/shared/headless-role.md` (plus the reviewer overlay) before a
// provider sees anything, so scanning one role fragment would miss a shape
// introduced by the shared block. Delete neither believing the other covers it.
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
