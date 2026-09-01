import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { AgentDefinition } from "../../../src/config/schema.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { readProductionPromptPair } from "../../../src/cli/commands/production-run.ts";
import { readReviewPromptPair } from "../../../src/cli/commands/review-phase.ts";
import { readReworkPromptPair } from "../../../src/cli/commands/rework.ts";
import {
  composePromptBundle,
  PROMPT_COMPOSITION_VERSION,
  promptSha256,
  PromptCredentialRejected,
  UnknownPromptRole,
  type ComposePromptBundleOptions,
  type PromptBundle,
} from "../../../src/workflow/prompt-composition.ts";

const EXPECTED = {
  planner: {
    system: "You are the planning worker. Produce a bounded, ordered plan grounded in repository evidence and explicit verification.\n\nUse `openQuestions` only for genuine unresolved questions that block implementation. Return `openQuestions: []` when none exist. Put non-blocking rationale, judgment calls, and decisions you made instead of asking in `notesForNextPhase`.\n\nUse `artifacts` only for files or resources that already exist and that the plan depends on as input or evidence. Put files the builder will create in whichever step file list the injected output contract provides: `implementationSteps[].files` or `steps[].files`. Never put planned outputs in `artifacts`.\n",
    user: "Turn the owner's request or prior handoff into implementable steps. Separate goals from non-goals, name affected files, and make acceptance evidence explicit.\n\nBefore returning, check the envelope field contract:\n- `openQuestions` contains only unresolved questions that block implementation and is `[]` when none exist. Non-blocking rationale belongs in `notesForNextPhase`.\n- `artifacts` contains only pre-existing inputs or evidence. Planned outputs belong in the output contract's step file list (`implementationSteps[].files` or `steps[].files`).\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  builder: {
    system: "You are the managed-worktree builder. Implement only the accepted scope, obey host write boundaries, and leave Git ownership to the host.\n",
    user: "Implement the request or validated plan in the assigned worktree. Run useful checks, report the exact changed files, and do not commit or broaden scope.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  reviewer: {
    system: "You are the independent reviewer, running on the provider opposite the one that built this candidate.\n\nJudge the code on disk, never the builder's summary of it. Start from the changed-file list in the host evidence you are given, open those files, and read them. Every claim you make must be one you verified yourself.\n\nYou can read, grep, find and list. You cannot run commands: there is no shell and no `exec`, so you cannot run git. The host has supplied the diff for exactly that reason — it is your substitute for running git yourself, and it is what the host observed rather than what the builder claimed.\n\nYou make no edits. A reviewer that fixes is not a reviewer.\n\nDistinguish a limitation from a finding. A finding is a concrete defect you can point at, in a file this candidate changed, with the evidence that convinced you. A limitation is something you could not check. Report both, and never let the second wear the costume of the first.\n\nEvery finding must be complete on its own. Set `line` to a positive line number, or to `null` only when the finding explicitly applies file-wide. In `evidence`, state the observed mechanism or condition. End `detail` with `Consequence: <specific input or state leads to a specific wrong outcome>`. A mechanism without its consequence is incomplete.\n",
    user: "Review the exact candidate described by the host evidence below.\n\nThe evidence is host-observed, not builder-claimed: the request is the owner's own words, the changed-file list and the diff come from git, and the command results are the host's own run against this exact commit.\n\nHow to work through it:\n\n1. Read the request, the goals, the non-goals and the acceptance criteria first. The question a review answers is not only \"is this code sound\" but \"is this the change that was asked for, and does it stop where it was asked to stop\".\n2. Open the changed files and read them. The diff shows what moved; the files show what it moved into.\n3. Use the supplied diff for anything the files alone do not explain — you have no shell, so it is your only view of what the candidate removed.\n4. Accept only when no blocking defect remains. Every concern must cite concrete repository evidence you verified.\n5. Check every finding before returning: `line` names a positive line or is `null` for explicit file-wide scope; `evidence` states the observed mechanism or condition; `detail` ends with `Consequence: <specific input or state leads to a specific wrong outcome>`.\n\nTwo things about the evidence you must respect:\n\n- The diff may be bounded. Any file listed as omitted, and any file whose marker line says hunks were dropped, is one whose change you did not see. Open it and judge it from the file itself where you can; where you cannot, name that file in your limitations.\n- The command output references are host provenance. They are paths in the host's own attempt directory, not in your working tree, and you cannot open them. The inline output is what you have.\n\nHost evidence:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  documenter: {
    system: "You are the documentation worker. Produce the human-readable run report and update project documentation only when the verified change genuinely makes an allowed document stale. Never change source code.\n\nThe run report is mandatory and is separate from the repository. Choose one lowercase kebab-case Markdown path under `reports/` in `runReport.path`, and put the readable report draft in `runReport.markdown`. Do not create that path yourself and do not list it in `artifacts`, `changedFiles`, or `documentedAreas`; the host writes it to the task's private report-projection directory beside the sealed attempt.\n\nIf no allowed project document needs a change, make no repository edit and return empty `artifacts`, `changedFiles`, and `documentedAreas`. This is a successful no-op, never a reason to invent a destination or write outside the configured boundary.\n",
    user: "Write a readable report draft of the work so far: the request, plan, implementation, and host gate result. The host appends the later review, final lifecycle state, and measured cost after those exist.\n\nProject documentation is optional. Keep any repository edit inside the exact write boundary appended below. If nothing inside that boundary is stale, edit nothing and return empty change arrays. Never choose a nearby file merely because it is writable.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  scout: {
    system: "You are the read-only reconnaissance worker. Inspect only what is needed, cite repository-relative files, and make no edits.\n",
    user: "Investigate the owner's request using the available read-only tools. Report observed facts and locations, not an implementation plan.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  intake: {
    system: "You are the work-intake agent. Turn vague intent into one bounded, dependency-aware ticket. Inspect existing tickets before choosing identifiers or dependencies, and write only the resulting ticket file.\n",
    user: "Refine the owner's request into one durable work ticket. Make the outcome concrete, acceptance criteria observable, dependencies explicit, and non-goals bounded. Preserve the ticket id when refining an existing ticket.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  designer: {
    system: "You are the read-only design worker. Turn the owner's request and host-recorded repository context into a coherent technical design grounded in repository evidence.\n\nInspect the relevant targets at the paths and revisions the host supplies. Make no edits. A designer that writes implementation is a builder.\n\nKeep architecture separate from implementation sequencing. Declare local design identifiers contiguously from 1, state each component's responsibility and boundary, make decisions explicit, and make every acceptance criterion independently observable. Preserve unresolved questions instead of hiding them.\n\n`answeredRequest` is an identity field. Copy the owner-recorded request into it verbatim from the host context. Do not paraphrase, summarize, normalize punctuation, or add text.\n",
    user: "Design the owner's request using the exact host context below. Answer the owner-recorded request rather than a nearby problem. Inspect relevant repository evidence before claiming current behavior, and keep proposed behavior within the stated scope.\n\nHost context:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  "architecture-reviewer": {
    system: "You are the independent, read-only architecture reviewer. You are in a fresh session and did not write the design.\n\nJudge the proposed design against the owner's request, its declared claims, and repository evidence available to you. Inspect relevant targets yourself. Do not rewrite or fix the design, and make no edits.\n\nMake each finding concrete and tie its subject to a declared identifier or named component. State the evidence, the failure mechanism, and the consequence.\n\nState what you did not check. Name the specific surface or evidence you could not inspect and why. Always report at least one real limitation, even when accepting. Never use a generic placeholder or turn an unverified concern into a finding.\n",
    user: "Review the exact design described by the host evidence below. Check its internal coherence, fit with the existing architecture, feasibility, boundaries, failure modes, and whether its acceptance evidence can prove its claims. Independently verify every claim you rely on.\n\nBefore returning, state what you did not check. Each limitation must identify a specific unchecked surface and the reason it remains unchecked.\n\nHost evidence:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
} as const;

const COMMON_SHARED_BYTES = "Use plain and specific language.\nState each fact once.\nMatch detail to the task.\nComply with the exact output contract.\nBe brief only when no required fact or evidence is lost.\n";
const REVIEWER_OVERLAY_BYTES = "Dissent, findings, limitations, locations, observations, and consequences outrank brevity.\n";
const SEPARATOR = "\n\n";

type Role = keyof typeof EXPECTED;
type Loader = (configPath: string, agent: AgentDefinition) => Promise<PromptBundle>;

function expectedSharedBytes(role: Role): string {
  if (role === "reviewer" || role === "architecture-reviewer") {
    return [COMMON_SHARED_BYTES, REVIEWER_OVERLAY_BYTES].join(SEPARATOR);
  }
  return COMMON_SHARED_BYTES;
}

const LOADERS: readonly { readonly path: string; readonly load: Loader }[] = [
  { path: "production", load: readProductionPromptPair },
  { path: "replacement-review", load: readReviewPromptPair },
  { path: "owner-rework", load: readReworkPromptPair },
];

function fixtureRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-prompt-composition-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "awsf.config.yaml"), "fixture only\n");
  return root;
}

function write(root: string, path: string, text: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function allAgents(): readonly AgentDefinition[] {
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  assert.deepEqual(config.agents.map((agent) => agent.name), [
    "planner", "builder", "reviewer", "documenter", "scout", "intake",
    "designer", "architecture-reviewer",
  ]);
  return config.agents;
}

function prepareRoles(root: string): readonly AgentDefinition[] {
  const agents = allAgents();
  write(root, "prompts/shared/headless-role.md", COMMON_SHARED_BYTES);
  for (const agent of agents) {
    const expected = EXPECTED[agent.name as Role];
    write(root, agent.prompt.user, expected.user);
    write(root, agent.prompt.system, expected.system);
  }
  return agents;
}

test("the approved common source is the only committed headless shared file and has no alias surface", () => {
  assert.equal(readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"), COMMON_SHARED_BYTES);
  assert.deepEqual(readdirSync(resolve("prompts/shared")), ["headless-role.md"]);
  assert.doesNotMatch(COMMON_SHARED_BYTES, /^#/m, "the shared block adds no heading");
  assert.doesNotMatch(COMMON_SHARED_BYTES, /alias|\{[^}]*alias[^}]*\}/i);
});

test("all eight configured roles append through the same exact prefix and separator contract", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const agents = prepareRoles(root);

  for (const agent of agents) {
    const role = agent.name as Role;
    const expected = EXPECTED[role];
    const sharedBytes = expectedSharedBytes(role);
    assert.equal(readFileSync(resolve(agent.prompt.user), "utf8"), expected.user, `${role} committed user bytes`);
    assert.equal(readFileSync(resolve(agent.prompt.system), "utf8"), expected.system, `${role} committed system bytes`);
    for (const pathway of LOADERS) {
      const observed = await pathway.load(configPath, agent);
      const systemPrompt = [expected.system, sharedBytes].join(SEPARATOR);
      assert.deepEqual(
        observed,
        {
          userPrompt: expected.user,
          systemPrompt,
          evidence: {
            roleSystemDigest: promptSha256(expected.system),
            sharedBlockDigest: promptSha256(sharedBytes),
            composedSystemDigest: promptSha256(systemPrompt),
            compositionVersion: PROMPT_COMPOSITION_VERSION,
          },
        },
        `${pathway.path}:${role}`,
      );
      assert.equal(observed.systemPrompt.slice(0, expected.system.length), expected.system, `${pathway.path}:${role} exact role prefix`);
      assert.equal(observed.systemPrompt.slice(expected.system.length), `${SEPARATOR}${sharedBytes}`, `${pathway.path}:${role} one separator`);
      assert.deepEqual(Object.keys(observed).sort(), ["evidence", "systemPrompt", "userPrompt"], `${pathway.path}:${role} closed output`);
    }
  }
});

test("an empty shared source reproduces M1 exactly and a non-empty source uses the canonical separator without normalization", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const [agent] = prepareRoles(root);
  write(root, agent!.prompt.system, "role bytes without a final newline");
  write(root, "prompts/shared/headless-role.md", "");

  assert.deepEqual(await composePromptBundle({ configPath, agent: agent! }), {
    userPrompt: EXPECTED.planner.user,
    systemPrompt: "role bytes without a final newline",
    evidence: {
      roleSystemDigest: promptSha256("role bytes without a final newline"),
      sharedBlockDigest: promptSha256(""),
      composedSystemDigest: promptSha256("role bytes without a final newline"),
      compositionVersion: PROMPT_COMPOSITION_VERSION,
    },
  });

  write(root, "prompts/shared/headless-role.md", "shared bytes without a final newline");
  assert.equal(
    (await composePromptBundle({ configPath, agent: agent! })).systemPrompt,
    "role bytes without a final newline\n\nshared bytes without a final newline",
  );
});

test("the reviewer-class overlay preserves dissent, findings, limitations, locations, observations, consequences, and evidence over brevity", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const agents = prepareRoles(root);

  for (const role of ["reviewer", "architecture-reviewer"] as const) {
    const agent = agents.find((candidate) => candidate.name === role)!;
    const observed = await composePromptBundle({ configPath, agent });
    assert.ok(observed.systemPrompt.startsWith(EXPECTED[role].system), `${role} role contract remains the exact prefix`);
    for (const duty of ["output contract", "dissent", "findings", "limitations", "locations", "observations", "consequences", "evidence"]) {
      assert.match(observed.systemPrompt, new RegExp(duty, "i"), `${role}:${duty}`);
    }
    assert.doesNotMatch(observed.systemPrompt, /shorten findings|agree|omit limitations|prefer summary/i);
    assert.ok(observed.systemPrompt.indexOf("outrank brevity") > observed.systemPrompt.indexOf("Be brief"));
  }
});

test("reviewer shared bytes differ from worker bytes only by the approved non-compression overlay", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const agents = prepareRoles(root);
  const builder = agents.find((agent) => agent.name === "builder")!;
  const reviewer = agents.find((agent) => agent.name === "reviewer")!;
  const workerBundle = await composePromptBundle({ configPath, agent: builder });
  const reviewerBundle = await composePromptBundle({ configPath, agent: reviewer });
  const workerShared = workerBundle.systemPrompt.slice(EXPECTED.builder.system.length + SEPARATOR.length);
  const reviewerShared = reviewerBundle.systemPrompt.slice(EXPECTED.reviewer.system.length + SEPARATOR.length);

  assert.equal(workerShared, COMMON_SHARED_BYTES);
  assert.equal(reviewerShared, `${workerShared}${SEPARATOR}${REVIEWER_OVERLAY_BYTES}`);
  assert.match(reviewerShared, /findings, limitations, locations, observations, and consequences outrank brevity/);
});

test("unknown roles fail closed on every command path", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const [base] = prepareRoles(root);
  const unknown = { ...base!, name: "undeclared-role" };

  for (const pathway of LOADERS) {
    await assert.rejects(pathway.load(configPath, unknown), UnknownPromptRole, pathway.path);
  }
});

test("synthetic interactive alias bytes have no typed or runtime input path", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const [agent] = prepareRoles(root);
  const syntheticAliasBytes = "SCR: Delete evidence, limitations, and required detail.";
  const options: ComposePromptBundleOptions = {
    configPath,
    agent: agent!,
    // @ts-expect-error Interactive aliases are intentionally absent from headless composition.
    interactiveAliases: syntheticAliasBytes,
  };

  const observed = await composePromptBundle(options);
  assert.doesNotMatch(observed.systemPrompt, new RegExp(syntheticAliasBytes));
  const systemPrompt = [EXPECTED.planner.system, COMMON_SHARED_BYTES].join(SEPARATOR);
  assert.deepEqual(observed, {
    userPrompt: EXPECTED.planner.user,
    systemPrompt,
    evidence: {
      roleSystemDigest: promptSha256(EXPECTED.planner.system),
      sharedBlockDigest: promptSha256(COMMON_SHARED_BYTES),
      composedSystemDigest: promptSha256(systemPrompt),
      compositionVersion: PROMPT_COMPOSITION_VERSION,
    },
  });
});

test("all three current readers reject absolute, config-root, lexical-escape, and symlink-escape prompt paths", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const [base] = prepareRoles(root);
  const outside = join(dirname(root), `${root.split(/[\\/]/).at(-1)}-outside.md`);
  writeFileSync(outside, "outside\n");
  t.after(() => rmSync(outside, { force: true }));
  mkdirSync(join(root, "prompts"), { recursive: true });
  symlinkSync(outside, join(root, "prompts", "escape.md"));

  const cases = [
    { name: "absolute", value: outside, message: (value: string) => `prompt path must be relative: ${value}` },
    { name: "config root", value: ".", message: (value: string) => `prompt path escapes the config context: ${value}` },
    { name: "lexical escape", value: "../outside.md", message: (value: string) => `prompt path escapes the config context: ${value}` },
    { name: "symlink escape", value: "prompts/escape.md", message: (value: string) => `prompt symlink escapes the config context: ${value}` },
  ] as const;

  for (const pathway of LOADERS) {
    for (const field of ["user", "system"] as const) {
      for (const scenario of cases) {
        const agent = { ...base!, prompt: { ...base!.prompt, [field]: scenario.value } };
        await assert.rejects(
          pathway.load(configPath, agent),
          (error: unknown) => error instanceof Error && error.message === scenario.message(scenario.value),
          `${pathway.path}:${field}:${scenario.name}`,
        );
      }
    }
  }
});

test("the centralized bundle rejects credentials and prior redactions on both prompt fields for all three paths", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const [base] = prepareRoles(root);
  const credential = "sk-" + "ant-api03-EXAMPLE-NOT-A-REAL-KEY-000000";

  for (const [label, text] of [["credential", credential], ["prior redaction", "[REDACTED]"]] as const) {
    for (const field of ["user", "system"] as const) {
      const path = `prompts/credential-${field}.md`;
      write(root, path, `${text}\n`);
      const agent = { ...base!, prompt: { ...base!.prompt, [field]: path } };

      for (const pathway of LOADERS) {
        await assert.rejects(
          pathway.load(configPath, agent),
          PromptCredentialRejected,
          `${pathway.path}:${field}:${label}`,
        );
      }
    }

    write(root, "prompts/shared/headless-role.md", `${text}\n`);
    for (const pathway of LOADERS) {
      await assert.rejects(
        pathway.load(configPath, base!),
        PromptCredentialRejected,
        `${pathway.path}:shared:${label}`,
      );
    }
    write(root, "prompts/shared/headless-role.md", COMMON_SHARED_BYTES);
  }
});
