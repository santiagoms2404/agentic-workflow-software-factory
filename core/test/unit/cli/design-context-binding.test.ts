import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  composeProductionDesignContext,
  renderProductionAgentPrompt,
} from "../../../src/cli/commands/production-run.ts";
import { grantSandbox } from "../../../src/policy/sandbox-broker.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { compileWorkflow } from "../../../src/workflow/compiler.ts";
import { designToPlanWorkflow } from "../../../src/workflow/recipes/design-to-plan.ts";
import { validDesignOutput } from "../contracts/fixtures.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function createRepository(path: string, branch: string, marker: string): string {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["init", "-b", branch, path], { stdio: "ignore" });
  writeFileSync(join(path, "README.md"), `${marker}\n`);
  git(path, "add", "README.md");
  git(
    path,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", `test: seed ${marker}`,
  );
  return git(path, "rev-parse", "HEAD");
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (directory: string, relative = ""): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const child = join(directory, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${childRelative}\0`);
      if (entry.isDirectory()) walk(child, childRelative);
      else hash.update(readFileSync(child));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function catalog(slug: string, repositories: string): string {
  return `version: awsf.project/v1
project:
  slug: ${slug}
repositories:
${repositories}
plans:
  root: specs
  format: awsf-plan-html/v1
`;
}

test("three-repository design context records local heads without creating another writable root", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-design-context-three-"));
  const plans = join(root, "plans");
  const service = join(root, "service");
  const application = join(root, "application");
  const stateRoot = join(root, "state");
  const worktree = join(root, "worktrees", "attempt");
  const runtime = join(root, "runtime", "designer");
  try {
    const heads = {
      plans: createRepository(plans, "main", "plans"),
      service: createRepository(service, "master", "service"),
      application: createRepository(application, "main", "application"),
    };
    writeFileSync(join(plans, "awsf.project.yaml"), catalog("fixture-three", `  plans:\n    role: plan\n    default_branch: main\n  service:\n    role: service\n    default_branch: master\n  application:\n    role: application\n    default_branch: main`));
    git(plans, "add", "awsf.project.yaml");
    git(plans, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: add project catalog");
    heads.plans = git(plans, "rev-parse", "HEAD");
    await writePlacement(stateRoot, "fixture-three", {
      version: "awsf.placement/v1",
      project: "fixture-three",
      worktree_root: join(root, "worktrees"),
      repositories: {
        plans: { path: plans },
        service: { path: service },
        application: { path: application },
      },
    });
    mkdirSync(worktree, { recursive: true });
    mkdirSync(runtime, { recursive: true });

    const before = new Map([plans, service, application].map((repository) => [repository, treeDigest(repository)]));
    const composed = await composeProductionDesignContext({
      repository: plans,
      stateRoot,
      projectSlug: "fixture-three",
      request: "Design the fixture",
    });

    assert.deepEqual(
      composed.context.targets.map((target) => ({
        id: target.repositoryId,
        path: target.path,
        branch: target.defaultBranch,
        head: target.headSha,
      })),
      [
        { id: "plans", path: plans, branch: "main", head: heads.plans },
        { id: "service", path: service, branch: "master", head: heads.service },
        { id: "application", path: application, branch: "main", head: heads.application },
      ],
    );
    for (const repository of [plans, service, application]) {
      assert.equal(treeDigest(repository), before.get(repository), `${repository} changed while composing read-only evidence`);
      assert.equal(git(repository, "status", "--porcelain"), "");
    }

    const grant = grantSandbox({
      executable: "node", argv: ["worker.mjs"], cwd: worktree, env: {}, stdin: "", shell: false,
    }, {
      canonicalRepository: plans,
      worktree,
      sessionRuntime: runtime,
      stateRoot,
      writes: [],
      platform: "linux",
    }, () => true);
    assert.deepEqual(grant.writableRoots, [runtime]);
    assert.ok(grant.spec.argv.indexOf("--ro-bind") < grant.spec.argv.indexOf(worktree));
    assert.ok(!grant.writableRoots.includes(service));
    assert.ok(!grant.writableRoots.includes(application));

    const compiled = compileWorkflow(designToPlanWorkflow, designToPlanWorkflow.tier);
    const designer = compiled.phases.find((phase) => phase.id === "design");
    const reviewer = compiled.phases.find((phase) => phase.id === "architecture-review");
    assert.ok(designer?.kind === "agent");
    assert.ok(reviewer?.kind === "agent");
    const designPrompt = renderProductionAgentPrompt(designer, composed.context, composed.context);
    const reviewPrompt = renderProductionAgentPrompt(reviewer, validDesignOutput(), composed.context);
    for (const target of composed.context.targets) {
      assert.match(designPrompt, new RegExp(target.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      assert.match(reviewPrompt, new RegExp(target.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      assert.equal(designer.promptTemplate.includes(target.path), false);
      assert.equal(reviewer.promptTemplate.includes(target.path), false);
    }
    assert.match(reviewPrompt, /Host repository-context envelope:/u);
    assert.match(reviewPrompt, /Designed a typed envelope registry/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a one-repository catalog composes the same one-target handoff", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-design-context-one-"));
  const plans = join(root, "plans");
  const stateRoot = join(root, "state");
  try {
    createRepository(plans, "main", "plans");
    writeFileSync(join(plans, "awsf.project.yaml"), catalog("fixture-one", `  plans:\n    role: plan\n    default_branch: main`));
    git(plans, "add", "awsf.project.yaml");
    git(plans, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: add project catalog");
    await writePlacement(stateRoot, "fixture-one", {
      version: "awsf.placement/v1",
      project: "fixture-one",
      repositories: { plans: { path: plans } },
    });

    const composed = await composeProductionDesignContext({
      repository: plans,
      stateRoot,
      projectSlug: "fixture-one",
      request: "Design the single repository fixture",
    });

    assert.equal(composed.context.summary, "Design the single repository fixture");
    assert.deepEqual(composed.context.targets, [{
      repositoryId: "plans",
      path: plans,
      defaultBranch: "main",
      headSha: git(plans, "rev-parse", "HEAD"),
    }]);
    assert.equal(git(plans, "status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
