import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import type { ProjectCatalog } from "../../../src/registry/catalog-schema.ts";
import { readPlacement, writePlacement } from "../../../src/registry/placement.ts";
import type { Placement } from "../../../src/registry/placement-schema.ts";
import {
  PlanGrammarMismatchError,
  UnsupportedPlanFormatError,
  parseAwsfPlanHtmlV1,
  resolvePlanSources,
  type ResolvedPlanSource,
} from "../../../src/registry/plan-source.ts";
import { repoRoot } from "../meta/_walk.ts";

function foreignCatalog(): ProjectCatalog {
  return loadCatalog(`
version: awsf.project/v1
project:
  slug: foreign-project
repositories:
  plans:
    role: plan
    default_branch: main
  service:
    role: service
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`);
}

function foreignPlacement(repository: string): Placement {
  return {
    version: "awsf.placement/v1",
    project: "foreign-project",
    repositories: {
      plans: { path: repository },
    },
  };
}

function withForeignRepository(run: (root: string, repository: string, catalogPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "awsf-plan-source-"));
  const repository = join(root, "plan-repository");
  const catalogPath = join(repository, "awsf.project.yaml");
  mkdirSync(join(repository, "specs", "tickets", "alpha"), { recursive: true });
  writeFileSync(join(repository, "specs", "alpha.html"), "<html></html>");
  writeFileSync(join(repository, "specs", "alpha-build-prompts.md"), "# prompts\n");
  writeFileSync(catalogPath, "catalog location fixture\n");
  try {
    run(root, repository, catalogPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const FOREIGN_CATALOG_YAML = `
version: awsf.project/v1
project:
  slug: foreign-project
repositories:
  plans:
    role: plan
    default_branch: main
  service:
    role: service
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
  default: alpha
`;

const FOREIGN_PLAN = `<section>
<h3><code class="status">[x]</code> Milestone M1: Foreign plan</h3>
<h4>1. Foreign task</h4>
<ul class="checklist"><li><code class="status">[x]</code> Complete</li></ul>
</section>
`;

const FOREIGN_PROMPTS = `# Section B — Task prompts (recommended)

### T1 — Foreign task

\`\`\`
build the foreign task
\`\`\`
`;

const FOREIGN_TICKET = `---
id: T01
title: "Foreign task"
milestone: M1
state: done
depends_on: []
---

# T01 · Foreign task

## Build prompt

\`\`\`
build the foreign task
\`\`\`
`;

interface ForeignFixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly repository: string;
  readonly catalogPath: string;
  readonly planPath: string;
  readonly ticketPath: string;
  readonly catalog: ProjectCatalog;
  readonly placement: Placement;
}

async function withRegisteredForeignRepository(run: (fixture: ForeignFixture) => void | Promise<void>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "awsf-foreign-plan-fence-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "foreign-plan-repository");
  const specs = join(repository, "specs");
  const tickets = join(specs, "tickets", "alpha");
  const catalogPath = join(repository, "awsf.project.yaml");
  const planPath = join(specs, "alpha.html");
  const ticketPath = join(tickets, "T01.md");
  mkdirSync(tickets, { recursive: true });
  writeFileSync(catalogPath, FOREIGN_CATALOG_YAML);
  writeFileSync(planPath, FOREIGN_PLAN);
  writeFileSync(join(specs, "alpha-build-prompts.md"), FOREIGN_PROMPTS);
  writeFileSync(ticketPath, FOREIGN_TICKET);

  // Keep one unticketed plan present so deleting alpha leaves enough source
  // context for the orphan-set scan to identify alpha by name.
  writeFileSync(join(specs, "sentinel.html"), FOREIGN_PLAN);

  const catalog = loadCatalog(readFileSync(catalogPath, "utf8"));
  await writePlacement(stateRoot, catalog.project.slug, foreignPlacement(repository));
  const placement = await readPlacement(stateRoot, catalog.project.slug);
  try {
    await run({ root, stateRoot, repository, catalogPath, planPath, ticketPath, catalog, placement });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return root;
}

interface FenceSet {
  readonly label: string;
  readonly source: ResolvedPlanSource;
}

interface FenceTicket {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly milestone: string;
  readonly state: string;
  readonly dependsOn: string[];
  readonly prompt: string;
}

function fenceSets(catalogPath: string, catalog: ProjectCatalog, placement: Placement): FenceSet[] {
  const sources = resolvePlanSources(catalogPath, catalog, placement);
  const repositoryId = Object.entries(catalog.repositories)
    .find(([, repository]) => repository.role === "plan")?.[0];
  assert.ok(repositoryId, `project ${catalog.project.slug} has no plan repository`);
  const repositoryRoot = placement.repositories[repositoryId]?.path;
  assert.ok(repositoryRoot, `placement does not locate plan repository ${repositoryId}`);
  const ticketsRoot = join(repositoryRoot, catalog.plans.root, "tickets");

  if (existsSync(ticketsRoot)) {
    for (const entry of readdirSync(ticketsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const label = `${catalog.project.slug}/${repositoryId}/${entry.name}`;
      assert.ok(
        sources.some((source) => source.ticketsPath === join(ticketsRoot, entry.name)),
        `plan source ${label} has a ticket set but no resolved plan. A ticket set without a plan cannot be checked against anything.`,
      );
    }
  }

  return sources
    .filter((source) => existsSync(source.ticketsPath))
    .map((source) => ({
      label: `${source.project}/${source.repositoryId}/${basename(source.planPath, ".html")}`,
      source,
    }));
}

function fenceTickets(set: FenceSet): FenceTicket[] {
  return readdirSync(set.source.ticketsPath)
    .filter((name) => /^T\d\d\.md$/u.test(name))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(set.source.ticketsPath, name), "utf8");
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw);
      assert.ok(match, `${set.label}/${name} has no frontmatter block`);
      const frontmatter = parse(match[1] ?? "") as Record<string, unknown>;
      const promptParts = (match[2] ?? "").split("## Build prompt\n\n");
      assert.equal(promptParts.length, 2, `${set.label}/${name} has no single Build prompt section`);
      return {
        id: String(frontmatter.id),
        number: Number(String(frontmatter.id).slice(1)),
        title: String(frontmatter.title),
        milestone: String(frontmatter.milestone),
        state: String(frontmatter.state),
        dependsOn: (frontmatter.depends_on as string[]) ?? [],
        prompt: (promptParts[1] ?? "").replace(/\n+$/u, ""),
      };
    });
}

function fencePrompts(set: FenceSet): Map<number, { title: string; prompt: string }> {
  const markdown = readFileSync(set.source.promptsPath, "utf8");
  const sectionB = markdown.split("# Section B — Task prompts (recommended)")[1] ?? "";
  const headings = [...sectionB.matchAll(/^### T(\d+) — (.+)$/gmu)];
  const prompts = new Map<number, { title: string; prompt: string }>();
  for (const [index, heading] of headings.entries()) {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? sectionB.length;
    prompts.set(Number(heading[1]), {
      title: (heading[2] ?? "").trim(),
      prompt: sectionB.slice(start, end).trim(),
    });
  }
  return prompts;
}

/** Exercises the same dimensions as the invariant-12 meta-fence on resolved foreign sets. */
function assertForeignFence(catalogPath: string, catalog: ProjectCatalog, placement: Placement): void {
  const sets = fenceSets(catalogPath, catalog, placement);
  assert.ok(sets.length > 0, `project ${catalog.project.slug} resolved no ticketed plan sources`);

  for (const set of sets) {
    assert.ok(existsSync(set.source.promptsPath), `${set.label}: no build prompts for the resolved plan source`);
    const tasks = parseAwsfPlanHtmlV1(readFileSync(set.source.planPath, "utf8"), set.label);
    const byNumber = new Map(tasks.map((task) => [task.number, task]));
    const tickets = fenceTickets(set);
    const numbers = tickets.map((ticket) => ticket.number);
    assert.deepEqual(numbers, Array.from({ length: Math.max(...numbers) }, (_, index) => index + 1), `${set.label}: ticket ids must be contiguous`);
    assert.deepEqual(numbers.filter((number) => !byNumber.has(number)), [], `${set.label}: a ticket names no plan task`);

    const prompts = fencePrompts(set);
    const offenders: string[] = [];
    const states = new Map(tickets.map((ticket) => [ticket.id, ticket.state]));
    for (const ticket of tickets) {
      const task = byNumber.get(ticket.number);
      if (task?.milestone !== ticket.milestone) offenders.push(`${set.label}/${ticket.id}: milestone differs from the plan`);
      if (task?.milestoneMarker === "x" && ticket.state !== "done") {
        offenders.push(`${set.label}/${ticket.id}: milestone ${ticket.milestone} is [x] but ticket is ${ticket.state}`);
      }
      if ((task?.checklist.length ?? 0) === 0) offenders.push(`${set.label}/${ticket.id}: plan task has no checklist`);
      if (task !== undefined && task.checklist.every((marker) => marker === "x") && ticket.state !== "done") {
        offenders.push(`${set.label}/${ticket.id}: every plan checklist box is [x] but ticket is ${ticket.state}`);
      }
      const prompt = prompts.get(ticket.number);
      if (prompt?.title !== ticket.title) offenders.push(`${set.label}/${ticket.id}: title differs from Section B`);
      if (prompt?.prompt !== ticket.prompt) offenders.push(`${set.label}/${ticket.id}: build prompt differs from Section B`);
      if (!/^(?:todo|wip|done|failed)$/u.test(ticket.state)) offenders.push(`${set.label}/${ticket.id}: invalid state ${ticket.state}`);
      for (const dependency of ticket.dependsOn) {
        if (!states.has(dependency) || dependency >= ticket.id) offenders.push(`${set.label}/${ticket.id}: invalid dependency ${dependency}`);
        if (ticket.state === "done" && states.get(dependency) !== "done") offenders.push(`${set.label}/${ticket.id}: unfinished dependency ${dependency}`);
      }
    }
    assert.deepEqual(offenders, [], set.label);
  }
}

test("self-places this checkout without consulting placement", () => {
  const catalogPath = join(repoRoot(), "awsf.project.yaml");
  const catalog = loadCatalog(readFileSync(catalogPath, "utf8"));
  const placement = new Proxy({} as Placement, {
    get() {
      throw new Error("self-placement consulted placement");
    },
  });

  const sources = resolvePlanSources(catalogPath, catalog, placement);
  const source = sources.find((candidate) => candidate.planPath === join(repoRoot(), "specs", "awsf-plan.html"));

  assert.ok(source);
  assert.deepEqual(source, {
    project: "agentic-workflow-software-factory",
    repositoryId: "awsf",
    planPath: join(repoRoot(), "specs", "awsf-plan.html"),
    promptsPath: join(repoRoot(), "specs", "awsf-plan-build-prompts.md"),
    ticketsPath: join(repoRoot(), "specs", "tickets", "awsf-plan"),
    format: "awsf-plan-html/v1",
  });
});

test("returns no foreign records without placement and resolves them where placement locates them", () => {
  withForeignRepository((_root, repository, catalogPath) => {
    const catalog = foreignCatalog();
    assert.deepEqual(resolvePlanSources(catalogPath, catalog), []);

    assert.deepEqual(resolvePlanSources(catalogPath, catalog, foreignPlacement(repository)), [{
      project: "foreign-project",
      repositoryId: "plans",
      planPath: join(repository, "specs", "alpha.html"),
      promptsPath: join(repository, "specs", "alpha-build-prompts.md"),
      ticketsPath: join(repository, "specs", "tickets", "alpha"),
      format: "awsf-plan-html/v1",
    }]);
  });
});

test("refuses an unimplemented declared format by format and plan name", () => {
  withForeignRepository((_root, repository, catalogPath) => {
    const catalog = foreignCatalog();
    (catalog.plans as unknown as { format: string }).format = "phase-plan-html/v1";

    assert.throws(
      () => resolvePlanSources(catalogPath, catalog, foreignPlacement(repository)),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedPlanFormatError);
        assert.equal(error.format, "phase-plan-html/v1");
        assert.equal(error.plan, "alpha");
        assert.match(error.message, /exactly one format is implemented/u);
        assert.match(error.message, /awsf-plan-html\/v1/u);
        return true;
      },
    );
  });
});

test("the named v1 parser preserves milestone grammar and task boundaries", () => {
  const tasks = parseAwsfPlanHtmlV1(`
<section>
<h3><code class="status">[wip]</code> Milestone M5: Registry</h3>
<h4>0. Authoring</h4><code class="status">[x]</code>
<h4>16. Sources</h4><code class="status">[x]</code><code class="status">[]</code>
<h4>17. Fence</h4><code class="status">[wip]</code>
</section>
<section><h2>Definition of Done</h2><code class="status">[]</code></section>
`, "fixture-plan");

  assert.deepEqual(tasks, [
    { number: 16, milestone: "M5", milestoneMarker: "wip", checklist: ["x", ""] },
    { number: 17, milestone: "M5", milestoneMarker: "wip", checklist: ["wip"] },
  ]);
});

test("the invariant-12 fence passes and bites across a registered foreign repository", async () => {
  const removedRoot = await withRegisteredForeignRepository(async (fixture) => {
    assert.ok(existsSync(fixture.stateRoot), "placement registration did not create the temporary state root");
    assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement);

    writeFileSync(fixture.ticketPath, FOREIGN_TICKET.replace("state: done", "state: todo"));
    try {
      assert.throws(
        () => assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement),
        (error: unknown) => {
          assert.ok(error instanceof assert.AssertionError);
          assert.match(error.message, /foreign-project\/plans\/alpha/u);
          assert.match(error.message, /milestone M1 is \[x\] but ticket is todo/u);
          return true;
        },
      );
    } finally {
      writeFileSync(fixture.ticketPath, FOREIGN_TICKET);
    }
    assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement);

    rmSync(fixture.planPath);
    try {
      assert.throws(
        () => assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement),
        /plan source foreign-project\/plans\/alpha has a ticket set but no resolved plan/u,
      );
    } finally {
      writeFileSync(fixture.planPath, FOREIGN_PLAN);
    }
    assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement);

    const unsupportedCatalog = loadCatalog(FOREIGN_CATALOG_YAML);
    (unsupportedCatalog.plans as unknown as { format: string }).format = "phase-plan-html/v1";
    assert.throws(
      () => assertForeignFence(fixture.catalogPath, unsupportedCatalog, fixture.placement),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedPlanFormatError);
        assert.equal(error.format, "phase-plan-html/v1");
        assert.equal(error.plan, "alpha");
        return true;
      },
    );
  });

  assert.equal(existsSync(removedRoot), false, `temporary fixture remains at ${removedRoot}`);
});

test("a declared v1 source with Phase headings fails loudly instead of parsing zero tasks", async () => {
  const removedRoot = await withRegisteredForeignRepository((fixture) => {
    writeFileSync(
      fixture.planPath,
      '<section><h3><code class="status">[x]</code> Phase 24.5</h3><h4>1. Foreign task</h4></section>',
    );
    assert.equal(fixture.catalog.plans.format, "awsf-plan-html/v1");
    assert.throws(
      () => assertForeignFence(fixture.catalogPath, fixture.catalog, fixture.placement),
      (error: unknown) => {
        assert.ok(error instanceof PlanGrammarMismatchError);
        assert.equal(error.plan, "foreign-project/plans/alpha");
        assert.equal(error.code, "E_PLAN_GRAMMAR_MISMATCH");
        return true;
      },
    );
  });

  assert.equal(existsSync(removedRoot), false, `temporary fixture remains at ${removedRoot}`);
});
