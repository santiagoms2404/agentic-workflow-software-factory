import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  existsSync,
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
    system: "You are the planning worker. Produce a bounded, ordered plan grounded in repository evidence and explicit verification.\n",
    user: "Turn the owner's request or prior handoff into implementable steps. Separate goals from non-goals, name affected files, and make acceptance evidence explicit.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  builder: {
    system: "You are the managed-worktree builder. Implement only the accepted scope, obey host write boundaries, and leave Git ownership to the host.\n",
    user: "Implement the request or validated plan in the assigned worktree. Run useful checks, report the exact changed files, and do not commit or broaden scope.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  reviewer: {
    system: "You are the independent reviewer, running on the provider opposite the one that built this candidate.\n\nJudge the code on disk, never the builder's summary of it. Start from the changed-file list in the host evidence you are given, open those files, and read them. Every claim you make must be one you verified yourself.\n\nYou can read, grep, find and list. You cannot run commands: there is no shell and no `exec`, so you cannot run git. The host has supplied the diff for exactly that reason — it is your substitute for running git yourself, and it is what the host observed rather than what the builder claimed.\n\nYou make no edits. A reviewer that fixes is not a reviewer.\n\nDistinguish a limitation from a finding. A finding is a concrete defect you can point at, in a file this candidate changed, with the evidence that convinced you. A limitation is something you could not check. Report both, and never let the second wear the costume of the first.\n",
    user: "Review the exact candidate described by the host evidence below.\n\nThe evidence is host-observed, not builder-claimed: the request is the owner's own words, the changed-file list and the diff come from git, and the command results are the host's own run against this exact commit.\n\nHow to work through it:\n\n1. Read the request, the goals, the non-goals and the acceptance criteria first. The question a review answers is not only \"is this code sound\" but \"is this the change that was asked for, and does it stop where it was asked to stop\".\n2. Open the changed files and read them. The diff shows what moved; the files show what it moved into.\n3. Use the supplied diff for anything the files alone do not explain — you have no shell, so it is your only view of what the candidate removed.\n4. Accept only when no blocking defect remains. Every concern must cite concrete repository evidence you verified.\n\nTwo things about the evidence you must respect:\n\n- The diff may be bounded. Any file listed as omitted, and any file whose marker line says hunks were dropped, is one whose change you did not see. Open it and judge it from the file itself where you can; where you cannot, name that file in your limitations.\n- The command output references are host provenance. They are paths in the host's own attempt directory, not in your working tree, and you cannot open them. The inline output is what you have.\n\nHost evidence:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  documenter: {
    system: "You are the documentation worker. Update only allowed documentation and describe verified behavior without changing source code.\n",
    user: "Bring documentation into agreement with the tested candidate. Keep changes bounded to the configured documentation paths.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
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
    system: "You are the synthetic design worker fixture. Declare the design spine without writing files.\n",
    user: "Design from the prior host context.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
  },
  "architecture-reviewer": {
    system: "You are the synthetic independent architecture-reviewer fixture. Report limitations and make no edits.\n",
    user: "Review the design and state what you did not check.\n\nPrevious phase envelope:\n{previous_envelope}\n\nReturn only an envelope satisfying this host-generated contract:\n{output_schema}\n",
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

function syntheticAgent(role: "designer" | "architecture-reviewer", base: AgentDefinition): AgentDefinition {
  return {
    ...base,
    name: role,
    purpose: role === "designer" ? "Produce a design spine." : "Review a design independently.",
    prompt: { system: `prompts/${role}/system.md`, user: `prompts/${role}/user.md` },
    writes: [],
  };
}

function allAgents(): readonly AgentDefinition[] {
  const config = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8"));
  assert.deepEqual(config.agents.map((agent) => agent.name), [
    "planner", "builder", "reviewer", "documenter", "scout", "intake",
  ]);
  const planner = config.agents.find((agent) => agent.name === "planner")!;
  const reviewer = config.agents.find((agent) => agent.name === "reviewer")!;
  return [
    ...config.agents,
    syntheticAgent("designer", planner),
    syntheticAgent("architecture-reviewer", reviewer),
  ];
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

test("all six configured roles and two synthetic W05 roles append through the same exact prefix and separator contract", async (t) => {
  const root = fixtureRoot(t);
  const configPath = join(root, "awsf.config.yaml");
  const agents = prepareRoles(root);

  assert.equal(existsSync(resolve("prompts/designer/system.md")), false);
  assert.equal(existsSync(resolve("prompts/architecture-reviewer/system.md")), false);

  for (const agent of agents) {
    const role = agent.name as Role;
    const expected = EXPECTED[role];
    const sharedBytes = expectedSharedBytes(role);
    if (role !== "designer" && role !== "architecture-reviewer") {
      assert.equal(readFileSync(resolve(agent.prompt.user), "utf8"), expected.user, `${role} committed user bytes`);
      assert.equal(readFileSync(resolve(agent.prompt.system), "utf8"), expected.system, `${role} committed system bytes`);
    }
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
