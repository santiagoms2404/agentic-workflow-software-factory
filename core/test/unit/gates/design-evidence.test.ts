import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesignContext } from "../../../src/contracts/design-context.ts";
import { designEvidencePresent } from "../../../src/gates/design-evidence.ts";
import type { ResolvedProject, ResolvedRepository } from "../../../src/registry/resolve.ts";
import type { PhaseGateContext } from "../../../src/workflow/phase.ts";
import { validDesignContext } from "../contracts/fixtures.ts";

const SHA_C = "c".repeat(40);

function repository(
  id: string,
  role: ResolvedRepository["role"],
  path: string,
  worktreeRoot: string,
  defaultBranch = "main",
): ResolvedRepository {
  return { id, role, path, worktreeRoot, defaultBranch, gates: [] };
}

function catalog(): ResolvedProject {
  const repositories = {
    plans: repository("plans", "plan", "/work/smart-health/plans", "/work/smart-health/plans-worktrees"),
    service: repository("service", "service", "/work/smart-health/service", "/work/smart-health/service-worktrees", "master"),
    application: repository("application", "application", "/work/smart-health/application", "/work/smart-health/application-worktrees"),
  };
  return {
    slug: "smart-health",
    repositories,
    plans: { root: "specs", format: "awsf-plan-html/v1" },
    contracts: [],
    gatesFor(repositoryId) {
      return repositories[repositoryId as keyof typeof repositories]?.gates ?? [];
    },
  };
}

function envelope(): DesignContext {
  const context = validDesignContext();
  context.targets.push({
    repositoryId: "application",
    path: "/work/smart-health/application",
    defaultBranch: "main",
    headSha: SHA_C,
  });
  return context;
}

function gateContext(value = envelope(), worktree = "/work/smart-health/plans-worktrees/T11"): PhaseGateContext<DesignContext> {
  return {
    workflowId: "design-to-plan",
    phaseId: "design-context",
    worktree,
    previousEnvelope: null,
    envelope: value,
    correctionRound: 0,
  };
}

function failedItems(value: PhaseGateContext<DesignContext>, project = catalog()): string[] {
  return designEvidencePresent(value, project).checks
    .filter((check) => !check.ok)
    .map((check) => check.item);
}

test("design_evidence_present accepts every resolved repository once and states its limit", () => {
  const context = gateContext();
  const project = catalog();
  const first = designEvidencePresent(context, project);
  const second = designEvidencePresent(context, project);

  assert.equal(first.gateId, "design_evidence_present");
  assert.equal(first.passed, true);
  assert.ok(first.checks.every((check) => check.note.length > 0));
  assert.match(
    first.checks.find((check) => check.item === "revision evidence limit")?.note ?? "",
    /proves which revisions were available to the designer, never which files it read/u,
  );
  assert.deepEqual(first.checks, second.checks);
});

test("a context missing one of three catalog repositories fails and names it", () => {
  const context = envelope();
  context.targets = context.targets.filter((target) => target.repositoryId !== "service");
  const report = designEvidencePresent(gateContext(context), catalog());
  const check = report.checks.find((candidate) => candidate.item === "every declared repository appears exactly once");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /missing: service/u);
});

test("duplicate and undeclared targets fail exact catalog coverage", () => {
  const context = envelope();
  context.targets.push({ ...context.targets[1]! });
  context.targets.push({
    repositoryId: "ghost",
    path: "/work/smart-health/ghost",
    defaultBranch: "main",
    headSha: SHA_C,
  });
  const report = designEvidencePresent(gateContext(context), catalog());
  const check = report.checks.find((candidate) => candidate.item === "every declared repository appears exactly once");

  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /duplicate: service/u);
  assert.match(check?.note ?? "", /unexpected: ghost/u);
});

test("a target whose path or revision does not match host resolution fails", () => {
  const wrongPath = envelope();
  wrongPath.targets[1]!.path = "/work/smart-health/other-service";
  assert.ok(failedItems(gateContext(wrongPath)).includes("targets carry resolved paths and revisions"));

  const blankRevision = envelope();
  blankRevision.targets[2]!.headSha = "";
  const report = designEvidencePresent(gateContext(blankRevision), catalog());
  const check = report.checks.find((candidate) => candidate.item === "targets carry resolved paths and revisions");
  assert.equal(check?.ok, false);
  assert.match(check?.note ?? "", /application/u);
});

test("the catalog plan repository must be targeted from its own worktree", () => {
  const noPlanTarget = envelope();
  noPlanTarget.targets = noPlanTarget.targets.filter((target) => target.repositoryId !== "plans");
  assert.ok(failedItems(gateContext(noPlanTarget)).includes("plan repository is a target"));

  assert.ok(
    failedItems(gateContext(envelope(), "/work/smart-health/service-worktrees/T11"))
      .includes("attempt worktree belongs to the plan repository"),
  );
});
