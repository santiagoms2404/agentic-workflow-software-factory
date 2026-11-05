import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { TICKET_TASK_CLASSES } from "../../../src/contracts/ticket.ts";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import {
  planAgreement,
  validTaskClass,
  type AgreementTicket,
  type PlanAgreementInput,
  type PlanAgreementRule,
} from "../../../src/registry/plan-agreement.ts";
import {
  parseAwsfPlanHtmlV1,
  resolvePlanSources,
  type ParsedAwsfPlan,
} from "../../../src/registry/plan-source.ts";
import { repoRoot } from "./_walk.ts";

// AGENTS.md invariant 12: a plan and its tickets never disagree. The committed
// project catalog declares the plan source, and resolvePlanSources pairs every
// plan with its prompts and ticket set before the assertions below run. Because
// this checkout is its own plan repository, self-placement resolves it through
// repoRoot without machine-local placement and keeps this fence hermetic in a
// fresh clone. A foreign source without placement is outside this checkout.
//
// The declared format is resolved before parsing. An unsupported format is
// refused by name, and the sole implemented parser rejects a plan that does not
// contain its declared grammar rather than treating it as zero tasks.
//
// A ticket set in a resolved source's tickets root with no matching plan is a
// hard failure rather than a skip: an orphan set is exactly the drift this
// fence exists to catch, one level up from an orphan ticket.

const ROOT = repoRoot();
const CATALOG = join(ROOT, "awsf.project.yaml");

/** `T01` for a task plan, `W01` for a spine whose units are workstreams. */
const TICKET_FILE = /^[TW]\d\d\.md$/;
/** The one markdown file a ticket set may carry that is not a ticket. */
const SET_README = "README.md";

/** Markdown in a ticket set that the ticket pattern does not read. Refused, never silently dropped from the check. */
function misnamedTicketFiles(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith(".md") && name !== SET_README && !TICKET_FILE.test(name));
}

/**
 * A set is a directory, or a link to one. A symlinked set still names a plan that must exist, and a dangling link
 * is a set nothing can resolve, so it counts too.
 */
function isTicketSet(path: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return true;
  }
}

interface PlanSet {
  /** What every failure message names, so a red test says WHICH plan drifted. */
  readonly label: string;
  readonly plan: string;
  readonly prompts: string;
  readonly tickets: string;
  readonly knownStems: readonly string[];
}

function planSets(): PlanSet[] {
  const catalog = loadCatalog(readFileSync(CATALOG, "utf8"));
  const sources = resolvePlanSources(CATALOG, catalog);
  const ticketRoots = new Map<string, { project: string; repositoryId: string }>();

  for (const source of sources) {
    ticketRoots.set(dirname(source.ticketsPath), {
      project: source.project,
      repositoryId: source.repositoryId,
    });
  }
  for (const [ticketsRoot, owner] of ticketRoots) {
    if (!existsSync(ticketsRoot)) continue;
    for (const entry of readdirSync(ticketsRoot, { withFileTypes: true })) {
      const expectedPath = join(ticketsRoot, entry.name);
      if (!isTicketSet(expectedPath, entry)) continue;
      assert.ok(
        sources.some((source) => source.ticketsPath === expectedPath),
        `plan source ${owner.project}/${owner.repositoryId}/${entry.name} has a ticket set but no resolved plan. ` +
          "A ticket set without a plan cannot be checked against anything.",
      );
    }
  }

  const knownStems = Object.freeze(sources.map((source) => basename(source.planPath, ".html")));
  const sets: PlanSet[] = [];
  for (const source of sources) {
    const stem = basename(source.planPath, ".html");
    if (!existsSync(source.ticketsPath)) continue;
    assert.ok(existsSync(source.promptsPath), `${stem}: no build prompts for the resolved plan source at ${source.promptsPath}`);
    sets.push({
      label: stem,
      plan: source.planPath,
      prompts: source.promptsPath,
      tickets: source.ticketsPath,
      knownStems,
    });
  }
  return sets;
}

function planTasks(set: PlanSet): ParsedAwsfPlan {
  return parseAwsfPlanHtmlV1(readFileSync(set.plan, "utf8"), set.label);
}

function tickets(set: PlanSet): AgreementTicket[] {
  const names = readdirSync(set.tickets).sort();
  assert.deepEqual(misnamedTicketFiles(names), [], `${set.label}: a markdown file that is not a Tnn.md or Wnn.md ticket is unchecked against its plan`);
  return names
    .filter((name) => TICKET_FILE.test(name))
    .map((name) => {
      const raw = readFileSync(join(set.tickets, name), "utf8");
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
      assert.ok(match, `${name} has no frontmatter block`);
      const fm = parse(match[1] ?? "") as Record<string, unknown>;
      const body = match[2] ?? "";
      const split = body.split("## Build prompt\n\n");
      assert.equal(split.length, 2, `${name} has no single "## Build prompt" section`);
      return {
        id: String(fm.id),
        number: Number(String(fm.id).slice(1)),
        title: String(fm.title),
        milestone: String(fm.milestone),
        tier: fm.tier === undefined ? undefined : Number(fm.tier),
        state: String(fm.state),
        depends_on: (fm.depends_on as string[]) ?? [],
        workflow: fm.workflow === undefined ? undefined : String(fm.workflow),
        task_class: fm.task_class,
        serves: fm.serves === undefined ? undefined : (fm.serves as string[]),
        prompt: (split[1] ?? "").replace(/\n+$/, ""),
      };
    });
}

function sectionBPrompts(set: PlanSet): Map<number, { title: string; prompt: string }> {
  const md = readFileSync(set.prompts, "utf8");
  const sectionB = md.split("# Section B — Task prompts (recommended)")[1] ?? "";
  const out = new Map<number, { title: string; prompt: string }>();
  const heads = [...sectionB.matchAll(/^### T(\d+) — (.+)$/gm)];
  for (const [index, head] of heads.entries()) {
    const start = (head.index ?? 0) + head[0].length;
    const end = heads[index + 1]?.index ?? sectionB.length;
    out.set(Number(head[1]), { title: (head[2] ?? "").trim(), prompt: sectionB.slice(start, end).trim() });
  }
  return out;
}

function agreementInput(set: PlanSet): PlanAgreementInput {
  return {
    label: set.label,
    plan: planTasks(set),
    tickets: tickets(set),
    sectionB: sectionBPrompts(set),
    knownStems: set.knownStems,
  };
}

function checkRule(rule: PlanAgreementRule): void {
  for (const set of planSets()) {
    const offenders = planAgreement(agreementInput(set), rule)
      .map((violation) => violation.message);
    // Coverage historically printed the individual diagnostic as the assertion
    // message; the other rules printed the plan label and diagnostic array.
    if (rule === "TICKET_COVERAGE") {
      for (const message of offenders) assert.deepEqual([message], [], message);
    } else {
      assert.deepEqual(offenders, [], set.label);
    }
  }
}

test("tickets cover a contiguous prefix of the plan's tasks, with no orphans", () => {
  checkRule("TICKET_COVERAGE");
});

test("each ticket's milestone matches the plan block its task lives in", () => {
  checkRule("MILESTONE");
});

test("ticket state agrees with its milestone's marker", () => {
  checkRule("MILESTONE_STATE");
});

test("every plan task carries a checklist", () => {
  checkRule("CHECKLIST");
});

test("ticket state agrees with its task's own checklist", () => {
  checkRule("CHECKLIST_STATE");
});

test("each ticket carries its Section B build prompt byte-identically", () => {
  checkRule("PROMPT");
});

test("depends_on points only backwards at tickets that exist", () => {
  checkRule("DEPENDENCIES");
});

test("a done ticket never waits on unfinished work except at the declared G1 inversion", () => {
  checkRule("COMPLETED_DEPENDENCIES");
});

test("the task-class fence rejects unknown and non-string values without coercion", () => {
  for (const value of TICKET_TASK_CLASSES) assert.equal(validTaskClass(value), true);
  assert.equal(validTaskClass(undefined), true);
  for (const value of ["unclassified", "unknown", "", null, 1, [TICKET_TASK_CLASSES[0]]]) {
    assert.equal(validTaskClass(value), false, JSON.stringify(value));
  }
});

test("frontmatter values stay inside their vocabularies", () => {
  checkRule("VOCABULARIES");
});

test("identifier spine COVERAGE: every declaration is served by a plan task", () => {
  checkRule("COVERAGE");
});

test("identifier spine ORPHANS: task and ticket claims are declared or qualified and resolvable", () => {
  checkRule("ORPHANS");
});

test("identifier spine MIRROR: each ticket exactly matches its plan task's served set", () => {
  checkRule("MIRROR");
});

test("identifier spine Q5: declarations are unique and contiguous and qualified stems resolve", () => {
  checkRule("Q5");
});

test("every ticket directory pairs with a plan and its build prompts", () => {
  // planSets() asserts the pairing while discovering it, so reaching here at all
  // means every set resolved. This test exists so that failure is reported under
  // its own name rather than inside whichever assertion happened to run first.
  const labels = planSets().map((set) => set.label);
  assert.ok(labels.includes("awsf-plan"), `the v1 set is missing; found ${labels.join(", ")}`);
  assert.equal(new Set(labels).size, labels.length, `two ticket sets share a label: ${labels.join(", ")}`);
});

test("a misnamed markdown ticket is refused, and README.md is the only non-ticket file a set may carry", () => {
  assert.deepEqual(misnamedTicketFiles(["README.md", "T01.md", "W02.md", "T5.md", "T100.md", "notes.md"]), ["T5.md", "T100.md", "notes.md"]);
  assert.deepEqual(misnamedTicketFiles(["README.md", "T01.md", "W02.md", ".gitkeep"]), [], "a non-markdown entry is not a ticket");
});

test("a symlinked ticket set is a set, and a file entry is not", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-ticket-set-link-"));
  try {
    mkdirSync(join(root, "real-set"));
    writeFileSync(join(root, "stray.md"), "not a set\n");
    symlinkSync(join(root, "real-set"), join(root, "linked-set"), "dir");
    symlinkSync(join(root, "no-such-set"), join(root, "dangling-set"), "dir");
    const entries = new Map(readdirSync(root, { withFileTypes: true }).map((entry): [string, Dirent] => [entry.name, entry]));
    assert.equal(isTicketSet(join(root, "real-set"), entries.get("real-set")!), true);
    assert.equal(isTicketSet(join(root, "linked-set"), entries.get("linked-set")!), true, "a symlinked set is still a set");
    assert.equal(isTicketSet(join(root, "dangling-set"), entries.get("dangling-set")!), true, "a dangling link is still a set");
    assert.equal(isTicketSet(join(root, "stray.md"), entries.get("stray.md")!), false, "a plain file is not a set");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
