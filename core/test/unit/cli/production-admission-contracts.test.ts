import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import {
  inspectAdmissionJournal,
  phaseGates,
  ProductionPlanAdmissionRecoveryRequired,
  renderProductionPlanIntoWorktree,
  rethrowPlanAdmissionFailure,
} from "../../../src/cli/commands/production-run.ts";
import { registerProject } from "../../../src/cli/commands/project.ts";
import { contractByteDigest } from "../../../src/contracts/hash.ts";
import { validDesignPlanOutput, validPlanContext } from "../contracts/fixtures.ts";
import { trustedContractBaselineForAttempt, trustedContractRequirementsForAttempt } from "../../../src/registry/production-contracts.ts";
import type { AwsfConfig } from "../../../src/config/schema.ts";
import type { Tier } from "../../../src/state/tiers.ts";
import type { PlanAdmissionRecord } from "../../../src/contracts/plan-admission.ts";
import { PlanAdmissionMaterializationError } from "../../../src/registry/plan-admission.ts";
import { journalFilePath } from "../../../src/persistence/platform-paths.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function initializeRepository(repository: string): void {
  mkdirSync(repository, { recursive: true });
  execFileSync("git", ["init", "--initial-branch=main", repository], { stdio: "ignore" });
  writeFileSync(join(repository, "README.md"), "seed\n");
  git(repository, "add", "README.md");
  git(repository, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "-m", "test: seed repository");
}

function planInput(worktree: string, stem: string, extra: Record<string, unknown> = {}) {
  const baseSha = git(worktree, "rev-parse", "HEAD");
  return {
    worktree,
    stem,
    plan: validDesignPlanOutput(),
    identifierSet: validPlanContext().identifierSet,
    protectedPaths: [],
    baseSha,
    at: "2026-10-10T00:00:00Z",
    ...extra,
  };
}

function temporaryRepository(): { root: string; worktree: string; baseSha: string; close(): void } {
  const root = mkdtempSync(join(tmpdir(), "awsf-production-admission-"));
  const worktree = join(root, "repository");
  initializeRepository(worktree);
  return { root, worktree, baseSha: git(worktree, "rev-parse", "HEAD"), close: () => rmSync(root, { recursive: true, force: true }) };
}

function pathsFor(stem: string): string[] {
  return [
    `specs/${stem}.html`,
    `specs/${stem}-build-prompts.md`,
    `specs/tickets/${stem}/README.md`,
    `specs/tickets/${stem}/T01.md`,
  ];
}

test("production plan admission rejects local gates before journaling and rolls back its exclusive files", async () => {
  const fixture = temporaryRepository();
  let journalCalled = false;
  try {
    const result = await renderProductionPlanIntoWorktree(planInput(fixture.worktree, "rejected-plan", {
      protectedPaths: ["specs/**/"],
      journalAdmission: async () => { journalCalled = true; },
    }));
    assert.equal(result.candidateSha, null);
    assert.equal(result.reports.every((report) => report.passed), false);
    assert.equal(journalCalled, false);
    for (const path of pathsFor("rejected-plan")) assert.equal(existsSync(join(fixture.worktree, path)), false);
    assert.equal(existsSync(join(fixture.worktree, "specs")), false);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), fixture.baseSha);
  } finally { fixture.close(); }
});

test("a journal failure proven to precede admission evidence permits production rollback", async () => {
  const fixture = temporaryRepository();
  try {
    await assert.rejects(renderProductionPlanIntoWorktree(planInput(fixture.worktree, "journal-absent", {
      journalAdmission: async () => { throw new Error("journal refused before append"); },
      admissionJournalState: (record: PlanAdmissionRecord) => inspectAdmissionJournal(join(fixture.root, "attempt"), record),
    })), /journal refused before append/u);
    for (const path of pathsFor("journal-absent")) assert.equal(existsSync(join(fixture.worktree, path)), false);
    assert.equal(existsSync(join(fixture.worktree, "specs")), false);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), fixture.baseSha);
  } finally { fixture.close(); }
});

test("a durable journal write that throws keeps admission files and exposes explicit recovery", async () => {
  const fixture = temporaryRepository();
  const attemptDir = join(fixture.root, "attempt");
  try {
    mkdirSync(attemptDir);
    let recorded: PlanAdmissionRecord | null = null;
    await assert.rejects(renderProductionPlanIntoWorktree(planInput(fixture.worktree, "journal-ambiguous", {
      journalAdmission: async (record: PlanAdmissionRecord) => {
        recorded = record;
        writeFileSync(journalFilePath(attemptDir), `${JSON.stringify({ source_seq: 1, recorded_at: "2026-10-10T00:00:00Z", event: { admission: record } })}\n`);
        throw new Error("projector failed after append");
      },
      admissionJournalState: (record: PlanAdmissionRecord) => inspectAdmissionJournal(attemptDir, record),
    })), (error: unknown) => {
      assert.ok(error instanceof ProductionPlanAdmissionRecoveryRequired);
      assert.equal(error.stage, "journal admission");
      assert.equal(error.journalState, "present");
      assert.match(error.message, /Inspect the attempt journal and worktree/u);
      assert.ok(error.paths.length > 0);
      return true;
    });
    assert.ok(recorded !== null);
    for (const path of pathsFor("journal-ambiguous")) assert.equal(existsSync(join(fixture.worktree, path)), true);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), fixture.baseSha);
    assert.equal(await inspectAdmissionJournal(attemptDir, recorded!), "present");
  } finally { fixture.close(); }
});

test("production recovery diagnostics preserve paths retained by partial plan admission", () => {
  const retained = ["specs/partial-plan.html", "specs/tickets/partial-plan/T01.md"];
  const cause = new PlanAdmissionMaterializationError(new Error("materialization stopped"), retained);
  assert.throws(() => rethrowPlanAdmissionFailure(cause), (error: unknown) => {
    assert.ok(error instanceof ProductionPlanAdmissionRecoveryRequired);
    assert.equal(error.stage, "partial materialization");
    assert.equal(error.journalState, "absent");
    assert.deepEqual(error.paths, retained);
    assert.equal(error.admission, null);
    assert.match(error.message, /Inspect the attempt journal and worktree/u);
    return true;
  });
});

test("a failed candidate commit without durable admission rolls back unchanged admission files", async () => {
  const fixture = temporaryRepository();
  try {
    const hooks = join(fixture.worktree, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    git(fixture.worktree, "config", "core.hooksPath", ".git/hooks");
    const hook = join(hooks, "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    await assert.rejects(renderProductionPlanIntoWorktree(planInput(fixture.worktree, "commit-refused")), (error: unknown) =>
      error instanceof Error && /commit --author/u.test(error.message));
    for (const path of pathsFor("commit-refused")) assert.equal(existsSync(join(fixture.worktree, path)), false);
    assert.equal(existsSync(join(fixture.worktree, "specs")), false);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), fixture.baseSha);
    assert.equal(git(fixture.worktree, "status", "--porcelain"), "");
  } finally { fixture.close(); }
});

test("a failed commit that changes an admission file retains that file and reports recovery", async () => {
  const fixture = temporaryRepository();
  const stem = "commit-mutated";
  try {
    const hooks = join(fixture.worktree, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    git(fixture.worktree, "config", "core.hooksPath", ".git/hooks");
    const hook = join(hooks, "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nprintf 'changed by hook\\n' > specs/${stem}.html\nexit 1\n`);
    chmodSync(hook, 0o755);
    await assert.rejects(renderProductionPlanIntoWorktree(planInput(fixture.worktree, stem)), (error: unknown) => {
      assert.ok(error instanceof ProductionPlanAdmissionRecoveryRequired);
      assert.equal(error.stage, "candidate commit");
      assert.equal(error.journalState, "absent");
      assert.deepEqual(error.paths, [`specs/${stem}.html`]);
      return true;
    });
    assert.equal(readFileSync(join(fixture.worktree, `specs/${stem}.html`), "utf8"), "changed by hook\n");
    for (const path of pathsFor(stem).slice(1)) assert.equal(existsSync(join(fixture.worktree, path)), false);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), fixture.baseSha);
  } finally { fixture.close(); }
});

test("successful production admission commits after journaling and never rolls back its files", async () => {
  const fixture = temporaryRepository();
  let recorded: PlanAdmissionRecord | null = null;
  try {
    const result = await renderProductionPlanIntoWorktree(planInput(fixture.worktree, "committed-plan", {
      journalAdmission: async (record: PlanAdmissionRecord) => { recorded = record; },
    }));
    assert.notEqual(result.candidateSha, null);
    assert.equal(recorded, result.admission);
    assert.equal(git(fixture.worktree, "rev-parse", "HEAD"), result.candidateSha);
    assert.equal(git(fixture.worktree, "status", "--porcelain"), "");
    for (const path of pathsFor("committed-plan")) {
      assert.equal(existsSync(join(fixture.worktree, path)), true);
      assert.equal(git(fixture.worktree, "ls-tree", "--name-only", "HEAD", "--", path), path);
    }
  } finally { fixture.close(); }
});

const PROJECT = "production-contract-gate";
const CONTRACT_BYTES = Buffer.from('{"openapi":"v1"}\n');
const CONTRACT_DIGEST = contractByteDigest(CONTRACT_BYTES);

function projection(role: "produces" | "consumes", digest = CONTRACT_DIGEST): string {
  return stringify({ version: "awsf.contracts/v1", contracts: [{ id: "openapi", role, path: "contract.json", digest }] });
}

function projectCatalog(digest = CONTRACT_DIGEST): string {
  return stringify({
    version: "awsf.project/v1",
    project: { slug: PROJECT },
    repositories: {
      plans: { role: "plan", default_branch: "main" },
      service: { role: "service", default_branch: "main" },
    },
    plans: { root: "specs", format: "awsf-plan-html/v1" },
    contracts: [{ id: "openapi", digest,
      producer: { repository: "plans", path: "contract.json" },
      consumers: [{ repository: "service", path: "contract.json" }] }],
  });
}

async function registeredContractFixture(root: string) {
  const stateRoot = join(root, "state");
  const plans = join(root, "plans");
  const service = join(root, "service");
  initializeRepository(plans);
  initializeRepository(service);
  writeFileSync(join(plans, "contract.json"), CONTRACT_BYTES);
  writeFileSync(join(plans, "awsf.contracts.yaml"), projection("produces"));
  writeFileSync(join(plans, "awsf.project.yaml"), projectCatalog());
  writeFileSync(join(service, "contract.json"), CONTRACT_BYTES);
  writeFileSync(join(service, "awsf.contracts.yaml"), projection("consumes"));
  for (const repository of [plans, service]) {
    git(repository, "add", ".");
    git(repository, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "-m", "test: seed registered contract");
  }
  await registerProject({ stateRoot, catalogPath: join(plans, "awsf.project.yaml"), repositories: [`plans=${plans}`, `service=${service}`] });
  return { stateRoot, plans, service, baseSha: git(service, "rev-parse", "HEAD") };
}

async function productionContractReport(worktree: string, baseSha: string, stateRoot: string, projectSlug = PROJECT) {
  const requirements = await trustedContractRequirementsForAttempt({ repository: worktree, baseSha, projectSlug, stateRoot });
  const gates = phaseGates("builder", [], worktree, baseSha, {} as unknown as AwsfConfig, null,
    () => [], "", 0 as Tier, true, null, async () => [], () => ({ events: [], runId: "" }), requirements);
  const gate = gates.find((candidate) => candidate.id === "contract_digest");
  assert.ok(gate);
  return gate.run({} as never);
}

test("production candidate gates use registered digests and reject rewritten or deleted projections", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-production-contracts-"));
  try {
    const fixture = await registeredContractFixture(root);
    assert.equal((await productionContractReport(fixture.service, fixture.baseSha, fixture.stateRoot)).passed, true);

    const changed = Buffer.from('{"openapi":"candidate"}\n');
    writeFileSync(join(fixture.service, "contract.json"), changed);
    writeFileSync(join(fixture.service, "awsf.contracts.yaml"), projection("consumes", contractByteDigest(changed)));
    const rewritten = await productionContractReport(fixture.service, fixture.baseSha, fixture.stateRoot);
    assert.equal(rewritten.passed, false);
    assert.match(rewritten.checks[0]?.note ?? "", new RegExp(`expected=${CONTRACT_DIGEST}; .*artifact=${contractByteDigest(changed)}`, "u"));

    writeFileSync(join(fixture.service, "contract.json"), CONTRACT_BYTES);
    rmSync(join(fixture.service, "awsf.contracts.yaml"));
    const deleted = await productionContractReport(fixture.service, fixture.baseSha, fixture.stateRoot);
    assert.equal(deleted.passed, false);
    assert.match(deleted.checks[0]?.note ?? "", /projection=ENOENT/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resume pins an external trusted catalog commit and requirements instead of re-reading mutable HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-pinned-contract-baseline-"));
  try {
    const fixture = await registeredContractFixture(root);
    const input = { repository: fixture.service, baseSha: fixture.baseSha, projectSlug: PROJECT, stateRoot: fixture.stateRoot };
    const baseline = await trustedContractBaselineForAttempt(input);
    assert.equal(baseline.sourceKind, "registered-plan");
    assert.equal(baseline.sourceCommit, git(fixture.plans, "rev-parse", "HEAD"));
    assert.equal(baseline.requirements[0]?.digest, CONTRACT_DIGEST);

    const changedDigest = contractByteDigest(Buffer.from('{"openapi":"v2"}\n'));
    writeFileSync(join(fixture.plans, "awsf.project.yaml"), projectCatalog(changedDigest));
    git(fixture.plans, "add", "awsf.project.yaml");
    git(fixture.plans, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "-m", "test: change registered contract requirement");
    assert.notEqual(git(fixture.plans, "rev-parse", "HEAD"), baseline.sourceCommit);
    assert.equal((await trustedContractRequirementsForAttempt(input))[0]?.digest, changedDigest,
      "an unpinned fresh resolution sees the moved catalog head");

    const resumed = await trustedContractBaselineForAttempt(input, baseline);
    assert.equal(resumed.sourceCommit, baseline.sourceCommit);
    assert.deepEqual(resumed.requirements, baseline.requirements);
    await assert.rejects(trustedContractBaselineForAttempt(input, { ...baseline, requirements: [{
      ...baseline.requirements[0]!, digest: changedDigest,
    }] }), /baseline requirements or source SHA changed/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production candidate gate passes an absent optional projection when no trusted contracts are configured", async () => {
  const fixture = temporaryRepository();
  const stateRoot = join(fixture.root, "unregistered-state");
  try {
    const report = await productionContractReport(fixture.worktree, fixture.baseSha, stateRoot, "unregistered-project");
    assert.equal(report.gateId, "contract_digest");
    assert.equal(report.passed, true);
    assert.deepEqual(report.checks, []);
    assert.equal(existsSync(join(fixture.worktree, "awsf.contracts.yaml")), false);
  } finally { fixture.close(); }
});
