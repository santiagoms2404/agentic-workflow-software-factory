import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { isPlanIdentifierClaim, spineCoverage } from "../../../src/registry/plan-spine.ts";
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

const STATES = ["todo", "wip", "done", "failed"];
const TIERS = [0, 1, 2];
const WORKFLOWS = ["scout", "plan", "build", "plan-build-test", "build-review", "simple-sdlc", "intake"];

/** `T01` for a task plan, `W01` for a spine whose units are workstreams. */
const TICKET_FILE = /^[TW]\d\d\.md$/;
const TICKET_ID = /^[TW]\d\d$/;

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
      if (!entry.isDirectory()) continue;
      const expectedPath = join(ticketsRoot, entry.name);
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

interface Ticket {
  id: string;
  number: number;
  title: string;
  milestone: string;
  tier: number | undefined;
  state: string;
  depends_on: string[];
  workflow: string | undefined;
  serves: string[] | undefined;
  prompt: string;
}

function planTasks(set: PlanSet): ParsedAwsfPlan {
  return parseAwsfPlanHtmlV1(readFileSync(set.plan, "utf8"), set.label);
}

function tickets(set: PlanSet): Ticket[] {
  return readdirSync(set.tickets)
    .filter((name) => TICKET_FILE.test(name))
    .sort()
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

test("tickets cover a contiguous prefix of the plan's tasks, with no orphans", () => {
  for (const set of planSets()) {
    const numbers = tickets(set).map((t) => t.number);
    const highest = Math.max(...numbers);
    const expected = Array.from({ length: highest }, (_, i) => i + 1);
    assert.deepEqual(numbers, expected, "ticket ids must be T01..Tnn with no gaps");

    const uncovered = planTasks(set)
      .filter((t) => t.number <= highest && !numbers.includes(t.number))
      .map((t) => t.number);
    assert.deepEqual(uncovered, [], "a plan task below the highest ticket has no ticket");

    const orphans = numbers.filter((n) => !planTasks(set).some((t) => t.number === n));
    assert.deepEqual(orphans, [], "a ticket names a task the plan does not have");
  }
});

test("each ticket's milestone matches the plan block its task lives in", () => {
  for (const set of planSets()) {
    const byNumber = new Map(planTasks(set).map((t) => [t.number, t]));
    const offenders = tickets(set)
      .filter((t) => byNumber.get(t.number)?.milestone !== t.milestone)
      .map((t) => `${set.label}/${t.id}: ticket says ${t.milestone}, plan says ${byNumber.get(t.number)?.milestone}`);
    assert.deepEqual(offenders, [], set.label);
  }
});

test("ticket state agrees with its milestone's marker", () => {
  for (const set of planSets()) {
    const byNumber = new Map(planTasks(set).map((t) => [t.number, t]));
    const offenders: string[] = [];
    for (const ticket of tickets(set)) {
      const marker = byNumber.get(ticket.number)?.milestoneMarker;
      if (marker === "x" && ticket.state !== "done") {
        offenders.push(`${set.label}/${ticket.id}: milestone ${ticket.milestone} is [x] but ticket is ${ticket.state}`);
      }
      if (marker === "" && ticket.state === "done") {
        offenders.push(`${set.label}/${ticket.id}: milestone ${ticket.milestone} is [] but ticket is done`);
      }
    }
    assert.deepEqual(offenders, [], set.label);
  }
});

test("every plan task carries a checklist", () => {
  for (const set of planSets()) {
    // Without one, a ticket's state can only be checked against its milestone
    // marker — a blind spot for any task alone in an unfinished milestone. Nine
    // tasks were missing one on 2026-08-06; this keeps them from coming back.
    const barren = planTasks(set)
      .filter((t) => t.checklist.length === 0)
      .map((t) => `${set.label}: task ${t.number} (${t.milestone}) has no checklist to check state against`);
    assert.deepEqual(barren, [], set.label);
  }
});

test("ticket state agrees with its task's own checklist", () => {
  for (const set of planSets()) {
    const byNumber = new Map(planTasks(set).map((t) => [t.number, t]));
    const offenders: string[] = [];
    for (const ticket of tickets(set)) {
      const checklist = byNumber.get(ticket.number)?.checklist ?? [];
      if (checklist.length === 0) continue; // guarded by the test above
      const allChecked = checklist.every((mark) => mark === "x");
      if (allChecked && ticket.state !== "done") {
        offenders.push(`${set.label}/${ticket.id}: every plan checklist box is [x] but ticket is ${ticket.state}`);
      }
      if (!allChecked && ticket.state === "done") {
        offenders.push(`${set.label}/${ticket.id}: ticket is done but the plan still has unchecked boxes`);
      }
    }
    assert.deepEqual(offenders, [], set.label);
  }
});

test("each ticket carries its Section B build prompt byte-identically", () => {
  for (const set of planSets()) {
    const source = sectionBPrompts(set);
    const offenders: string[] = [];
    for (const ticket of tickets(set)) {
      const block = source.get(ticket.number);
      if (!block) {
        offenders.push(`${set.label}/${ticket.id}: no Section B block in awsf-plan-build-prompts.md`);
        continue;
      }
      if (block.prompt !== ticket.prompt) offenders.push(`${set.label}/${ticket.id}: build prompt has drifted from Section B`);
      if (block.title !== ticket.title) offenders.push(`${set.label}/${ticket.id}: title differs from its Section B heading`);
    }
    assert.deepEqual(offenders, [], set.label);
  }
});

test("depends_on points only backwards at tickets that exist", () => {
  for (const set of planSets()) {
    const all = tickets(set);
    const ids = new Set(all.map((t) => t.id));
    const offenders: string[] = [];
    for (const ticket of all) {
      for (const dep of ticket.depends_on) {
        if (!ids.has(dep)) offenders.push(`${set.label}/${ticket.id}: depends on ${dep}, which does not exist`);
        else if (dep >= ticket.id) offenders.push(`${set.label}/${ticket.id}: depends on ${dep}, which is not earlier`);
      }
    }
    assert.deepEqual(offenders, [], set.label);
  }
});

test("a done ticket never waits on unfinished work", () => {
  for (const set of planSets()) {
    const all = tickets(set);
    const stateOf = new Map(all.map((t) => [t.id, t.state]));
    const offenders = all
      .filter((t) => t.state === "done")
      .flatMap((t) => t.depends_on.filter((dep) => stateOf.get(dep) !== "done").map((dep) => `${set.label}/${t.id} is done but ${dep} is ${stateOf.get(dep)}`));
    assert.deepEqual(offenders, [], set.label);
  }
});

test("frontmatter values stay inside their vocabularies", () => {
  for (const set of planSets()) {
    const offenders: string[] = [];
    for (const ticket of tickets(set)) {
      if (!STATES.includes(ticket.state)) offenders.push(`${set.label}/${ticket.id}: state "${ticket.state}"`);
      // `tier`, `workflow`, and `serves` are optional: the plan skill's own rule
      // is to omit a field when a plan defines no such vocabulary rather than
      // invent one. Present-but-wrong is the defect; absent is legitimate.
      if (ticket.tier !== undefined && !TIERS.includes(ticket.tier)) {
        offenders.push(`${set.label}/${ticket.id}: tier "${String(ticket.tier)}"`);
      }
      if (ticket.workflow !== undefined && !WORKFLOWS.includes(ticket.workflow)) {
        offenders.push(`${set.label}/${ticket.id}: workflow "${ticket.workflow}"`);
      }
      if (
        ticket.serves !== undefined
        && (!Array.isArray(ticket.serves)
          || ticket.serves.some((identifier) => typeof identifier !== "string" || !isPlanIdentifierClaim(identifier)))
      ) {
        offenders.push(`${set.label}/${ticket.id}: serves ${JSON.stringify(ticket.serves)}`);
      }
      if (!TICKET_ID.test(ticket.id)) offenders.push(`${set.label}/${ticket.id}: id is not zero-padded Tnn or Wnn`);
    }
    assert.deepEqual(offenders, [], set.label);
  }
});

test("resolved plan sets satisfy the shared identifier-spine coverage decision", () => {
  for (const set of planSets()) {
    const parsed = planTasks(set);
    const planTickets = tickets(set);
    const ticketIdByNumber = new Map(planTickets.map((ticket) => [ticket.number, ticket.id]));
    const violations = spineCoverage(
      { label: set.label, declarations: parsed.declarations },
      parsed.map((task) => ({
        id: ticketIdByNumber.get(task.number) ?? `T${String(task.number).padStart(2, "0")}`,
        serves: task.serves,
      })),
      planTickets.map((ticket) => ({ id: ticket.id, serves: ticket.serves })),
      set.knownStems,
    );
    assert.deepEqual(violations.map((violation) => violation.message), [], set.label);
  }
});

test("every ticket directory pairs with a plan and its build prompts", () => {
  // planSets() asserts the pairing while discovering it, so reaching here at all
  // means every set resolved. This test exists so that failure is reported under
  // its own name rather than inside whichever assertion happened to run first.
  const labels = planSets().map((set) => set.label);
  assert.ok(labels.includes("awsf-plan"), `the v1 set is missing; found ${labels.join(", ")}`);
  assert.equal(new Set(labels).size, labels.length, `two ticket sets share a label: ${labels.join(", ")}`);
});
