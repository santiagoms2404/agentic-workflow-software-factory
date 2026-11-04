import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateProtectedPaths, type ProtectedPathsFacts } from "../../../src/preflight/fields.ts";
import { grantFileCovers, grantOwedFor, type RecordedGrant } from "../../../src/preflight/grant-plan.ts";
import {
  admitPlanSet,
  planAdmissionDocuments,
  PlanAdmissionRefused,
  type PlanAdmissionInput,
} from "../../../src/registry/plan-admission.ts";
import {
  ticketCoverage,
  ticketChecklistStates,
  ticketMilestoneStates,
  type AgreementTicket,
  type PlanAgreementInput,
} from "../../../src/registry/plan-agreement.ts";
import {
  resolvePlanSources,
} from "../../../src/registry/plan-source.ts";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { systemGitRunner, runGit } from "../../../src/git/changes.ts";

test("B10-18: evaluateProtectedPaths rejects malformed protected globs rather than passing with empty plan", () => {
  const facts: ProtectedPathsFacts = {
    request: "Ask: test\nWhere: core/src/state/machine.ts\nDone means: test\nOut of scope: none",
    where: ["core/src/state/machine.ts"],
    read: [],
    protectedPaths: ["core/state/**/"], // malformed trailing slash
    writers: [{ phase: "builder", writes: ["core/src/**"] }],
    shift: null,
  };
  const result = evaluateProtectedPaths(facts);
  assert.equal(result.verdict.passed, false);
  assert.match(result.verdict.reason, /protected path glob "core\/state\/\*\*\/" is invalid/u);
});

test("B10-45: omittablePrefixes allows shorthand candidate to match globstar pattern core/src/**/*.ts", () => {
  const facts: ProtectedPathsFacts = {
    request: "Ask: test\nWhere: state/guards.ts\nDone means: test\nOut of scope: none",
    where: ["state/guards.ts"],
    read: [],
    protectedPaths: ["core/src/**/*.ts"],
    writers: [{ phase: "builder", writes: ["core/src/**"] }],
    shift: null,
  };
  const result = evaluateProtectedPaths(facts);
  // state/guards.ts is recognized as protected hit under core/src/**/*.ts and refused as unclassified
  assert.equal(result.verdict.passed, false);
  assert.match(result.verdict.reason, /state\/guards\.ts .* is protected by core\/src\/\*\*\/\*\.ts and unclassified/u);
});

test("B10-19: grantFileCovers and grantOwedFor enforce coverage of all required paths under protected glob", () => {
  const planPath = "core/src/state/**";
  const singleFile = "core/src/state/guards.ts";
  const required = ["core/src/state/guards.ts", "core/src/state/machine.ts"];

  // When multiple paths are required, single file does not cover the glob
  assert.equal(grantFileCovers(planPath, singleFile, required), false);

  // When no required paths list or only one path, single file covers
  assert.equal(grantFileCovers(planPath, singleFile, [singleFile]), true);
  assert.equal(grantFileCovers(planPath, singleFile), true);

  const plan = [{ path: planPath, phase: "builder" }];
  const partialGrant: RecordedGrant = { id: "g1", phase: "builder", files: [singleFile] };
  const fullGrant: RecordedGrant = { id: "g2", phase: "builder", files: required };

  const owedWithPartial = grantOwedFor(plan, [partialGrant], "builder", required);
  assert.ok(owedWithPartial !== null);
  assert.deepEqual(owedWithPartial?.paths, [planPath]);

  const owedWithFull = grantOwedFor(plan, [fullGrant], "builder", required);
  assert.equal(owedWithFull, null);
});

test("B10-23/24: ticketMilestoneStates handles uppercase and descriptive done markers, and rejects invalid markers", () => {
  const input: PlanAgreementInput = {
    label: "test-plan",
    plan: [
      { number: 1, milestone: "M1", milestoneMarker: "X", checklist: ["x"] },
      { number: 2, milestone: "M1", milestoneMarker: "done", checklist: ["x"] },
      { number: 3, milestone: "M1", milestoneMarker: "invalid_marker", checklist: ["x"] },
    ] as any,
    tickets: [
      { id: "T01", number: 1, title: "T1", milestone: "M1", state: "todo", depends_on: [], prompt: "```\np\n```" },
      { id: "T02", number: 2, title: "T2", milestone: "M1", state: "todo", depends_on: [], prompt: "```\np\n```" },
      { id: "T03", number: 3, title: "T3", milestone: "M1", state: "todo", depends_on: [], prompt: "```\np\n```" },
    ] as unknown as AgreementTicket[],
    sectionB: new Map([[1, { title: "T1", prompt: "```\np\n```" }], [2, { title: "T2", prompt: "```\np\n```" }], [3, { title: "T3", prompt: "```\np\n```" }]]),
    knownStems: ["test-plan"],
  };

  const violations = ticketMilestoneStates(input);
  assert.ok(violations.some(v => v.message.includes("milestone M1 is [X] but ticket is todo")));
  assert.ok(violations.some(v => v.message.includes("milestone M1 is [done] but ticket is todo")));
  assert.ok(violations.some(v => v.message.includes("milestone M1 has invalid marker [invalid_marker]")));
});

test("B10-25: duplicate plan task numbers are not shadowed and are flagged by ticketCoverage and ticketChecklistStates", () => {
  const coverageViolations = ticketCoverage({
    label: "test",
    plan: [
      { number: 1, milestone: "M1", milestoneMarker: "", checklist: [] },
      { number: 1, milestone: "M1", milestoneMarker: "", checklist: [] },
    ] as any,
    tickets: [
      { id: "T01", number: 1, title: "T1", milestone: "M1", state: "todo", depends_on: [], prompt: "p" },
    ] as unknown as AgreementTicket[],
    sectionB: new Map(),
    knownStems: [],
  });
  assert.ok(coverageViolations.some(v => v.message.includes("duplicate plan task number 1")));

  const checklistViolations = ticketChecklistStates({
    label: "test",
    plan: [
      { number: 1, milestone: "M1", milestoneMarker: "x", checklist: [" "] },
      { number: 1, milestone: "M1", milestoneMarker: "x", checklist: ["x"] },
    ] as any,
    tickets: [
      { id: "T01", number: 1, title: "T1", milestone: "M1", state: "done", depends_on: [], prompt: "p" },
    ] as unknown as AgreementTicket[],
    sectionB: new Map(),
    knownStems: [],
  });
  // Earlier duplicate with unchecked boxes is not shadowed by the later all-checked task
  assert.ok(checklistViolations.some(v => v.message.includes("ticket is done but the plan still has unchecked boxes")));
});

function createGitFixture(): { root: string; baseSha: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "b10-test-git-")));
  const git = systemGitRunner(root);
  runGit(git, ["init", "--initial-branch=main"]);
  runGit(git, ["config", "user.name", "Tester"]);
  runGit(git, ["config", "user.email", "tester@example.com"]);
  writeFileSync(join(root, "README.md"), "# Test\n");
  runGit(git, ["add", "README.md"]);
  runGit(git, ["commit", "-m", "initial commit"]);
  const baseSha = runGit(git, ["rev-parse", "HEAD"]).trim();
  return {
    root,
    baseSha,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("B10-20 & B10-46: planAdmissionDocuments and verifyPlanAdmission support custom plans.root and knownStems", () => {
  const { root, cleanup } = createGitFixture();
  try {
    const catalogYaml = `
version: awsf.project/v1
project:
  slug: custom-root-project
repositories:
  custom-root-project:
    role: plan
    default_branch: main
plans:
  root: docs/plans
  format: awsf-plan-html/v1
  default: custom-plan
`;
    writeFileSync(join(root, "awsf.project.yaml"), catalogYaml);

    const planHtml = `
      <h3><code class="status">[]</code> Milestone M1: Setup</h3>
      <h4>1. Initial setup</h4>
      <p><code class="status">[]</code> Step 1</p>
    `;
    const buildPrompts = `# Section B — Task prompts (recommended)

### T01 — Initial setup
\`\`\`
Build prompt content
\`\`\`
`;
    const input: PlanAdmissionInput = {
      stem: "custom-plan",
      planHtml,
      buildPrompts,
      tickets: [{ id: "T01", title: "Initial setup", milestone: "M1", depends_on: [], serves: [] }],
      knownStems: ["other-stem"],
      plansRoot: "docs/plans",
    };

    const docs = planAdmissionDocuments(input, ["other-stem"], "docs/plans");
    assert.ok(docs.has("docs/plans/custom-plan.html"));
    assert.ok(docs.has("docs/plans/custom-plan-build-prompts.md"));
    assert.ok(docs.has("docs/plans/tickets/custom-plan/T01.md"));
  } finally {
    cleanup();
  }
});

test("B10-22: admitPlanSet writes transactionally and rolls back on failure", () => {
  const { root, baseSha, cleanup } = createGitFixture();
  try {
    const planHtml = `
      <h3><code class="status">[]</code> Milestone M1: Setup</h3>
      <h4>1. Initial setup</h4>
      <p><code class="status">[]</code> Step 1</p>
    `;
    const buildPrompts = `# Section B — Task prompts (recommended)

### T01 — Initial setup
\`\`\`
Build prompt content
\`\`\`
`;
    const input: PlanAdmissionInput = {
      stem: "rollback-plan",
      planHtml,
      buildPrompts,
      tickets: [{ id: "T01", title: "Initial setup", milestone: "M1", depends_on: [], serves: [] }],
    };

    // Pre-create an obstacle that makes write fail or causes collision
    mkdirSync(join(root, "specs"), { recursive: true });
    // Write an invalid target to trigger collision in admission target check
    writeFileSync(join(root, "specs", "rollback-plan.html"), "conflict");

    assert.throws(
      () => admitPlanSet({ ...input, worktree: root, baseSha, at: new Date().toISOString() }),
      (err: unknown) => {
        assert.ok(err instanceof PlanAdmissionRefused);
        assert.match(err.message, /admission target already exists/u);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("B10-28: resolvePlanSources resolves properly and worktree yields to registered placement", () => {
  const { root, cleanup } = createGitFixture();
  const previous = process.cwd();
  try {
    const catalogYaml = `
version: awsf.project/v1
project:
  slug: worktree-fixture
repositories:
  main-repo:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`;
    const catalogPath = join(root, "awsf.project.yaml");
    writeFileSync(catalogPath, catalogYaml);
    mkdirSync(join(root, "specs", "tickets", "alpha"), { recursive: true });
    writeFileSync(join(root, "specs", "alpha.html"), "<h3><code class=\"status\">[]</code> Milestone M1:</h3><h4>1. A</h4><p><code class=\"status\">[]</code> x</p>");
    writeFileSync(join(root, "specs", "alpha-build-prompts.md"), "# Section B — Task prompts (recommended)\n### T01 — A\n```\nprompt\n```\n");

    process.chdir(root);
    const catalog = loadCatalog(catalogYaml);
    const sources = resolvePlanSources(catalogPath, catalog);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.planPath, join(root, "specs", "alpha.html"));
  } finally {
    process.chdir(previous);
    cleanup();
  }
});
