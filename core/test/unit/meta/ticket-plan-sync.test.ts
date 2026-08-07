import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "./_walk.ts";

// AGENTS.md invariant 12: specs/tickets/ and specs/awsf-plan.html never disagree.
// The plan's status markers are the source of truth; a ticket's `state` mirrors
// them and is flipped in the same commit. The plan carries no per-task marker —
// only milestone <h3> markers and per-task checklists — so those are what a
// ticket's state is checked against.

const SPECS = join(repoRoot(), "specs");
const PLAN = join(SPECS, "awsf-plan.html");
const PROMPTS = join(SPECS, "awsf-plan-build-prompts.md");
const TICKETS = join(SPECS, "tickets");

const STATES = ["todo", "wip", "done", "failed"];
const TIERS = [0, 1, 2];
const WORKFLOWS = ["scout", "plan", "build", "plan-build-test", "build-review", "simple-sdlc", "intake"];

interface PlanTask {
  number: number;
  milestone: string;
  milestoneMarker: string;
  checklist: string[];
}

interface Ticket {
  id: string;
  number: number;
  title: string;
  milestone: string;
  tier: number;
  state: string;
  depends_on: string[];
  workflow: string;
  prompt: string;
}

function planTasks(): PlanTask[] {
  const html = readFileSync(PLAN, "utf8");
  const milestones = [...html.matchAll(/<h3><code class="status">\[([^\]]*)\]<\/code> Milestone (M\d+):/g)];
  const tasks: PlanTask[] = [];
  for (const [index, milestone] of milestones.entries()) {
    const start = milestone.index;
    const end = milestones[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const heads = [...block.matchAll(/<h4>(\d+)\./g)];
    for (const [headIndex, head] of heads.entries()) {
      const slice = block.slice(head.index, heads[headIndex + 1]?.index ?? block.length);
      const items = [...slice.matchAll(/<code class="status">\[([^\]]*)\]<\/code>/g)].map((m) => m[1] ?? "");
      tasks.push({
        number: Number(head[1]),
        milestone: milestone[2] ?? "",
        milestoneMarker: milestone[1] ?? "",
        checklist: items,
      });
    }
  }
  return tasks.filter((t) => t.number > 0); // task 0 is M0's plan authoring; it has no ticket
}

function tickets(): Ticket[] {
  return readdirSync(TICKETS)
    .filter((name) => /^T\d\d\.md$/.test(name))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(TICKETS, name), "utf8");
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
        tier: Number(fm.tier),
        state: String(fm.state),
        depends_on: (fm.depends_on as string[]) ?? [],
        workflow: String(fm.workflow),
        prompt: (split[1] ?? "").replace(/\n+$/, ""),
      };
    });
}

function sectionBPrompts(): Map<number, { title: string; prompt: string }> {
  const md = readFileSync(PROMPTS, "utf8");
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
  const numbers = tickets().map((t) => t.number);
  const highest = Math.max(...numbers);
  const expected = Array.from({ length: highest }, (_, i) => i + 1);
  assert.deepEqual(numbers, expected, "ticket ids must be T01..Tnn with no gaps");

  const uncovered = planTasks()
    .filter((t) => t.number <= highest && !numbers.includes(t.number))
    .map((t) => t.number);
  assert.deepEqual(uncovered, [], "a plan task below the highest ticket has no ticket");

  const orphans = numbers.filter((n) => !planTasks().some((t) => t.number === n));
  assert.deepEqual(orphans, [], "a ticket names a task the plan does not have");
});

test("each ticket's milestone matches the plan block its task lives in", () => {
  const byNumber = new Map(planTasks().map((t) => [t.number, t]));
  const offenders = tickets()
    .filter((t) => byNumber.get(t.number)?.milestone !== t.milestone)
    .map((t) => `${t.id}: ticket says ${t.milestone}, plan says ${byNumber.get(t.number)?.milestone}`);
  assert.deepEqual(offenders, []);
});

test("ticket state agrees with its milestone's marker", () => {
  const byNumber = new Map(planTasks().map((t) => [t.number, t]));
  const offenders: string[] = [];
  for (const ticket of tickets()) {
    const marker = byNumber.get(ticket.number)?.milestoneMarker;
    if (marker === "x" && ticket.state !== "done") {
      offenders.push(`${ticket.id}: milestone ${ticket.milestone} is [x] but ticket is ${ticket.state}`);
    }
    if (marker === "" && ticket.state === "done") {
      offenders.push(`${ticket.id}: milestone ${ticket.milestone} is [] but ticket is done`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("ticket state agrees with its task's own checklist", () => {
  const byNumber = new Map(planTasks().map((t) => [t.number, t]));
  const offenders: string[] = [];
  for (const ticket of tickets()) {
    const checklist = byNumber.get(ticket.number)?.checklist ?? [];
    if (checklist.length === 0) continue; // not every task carries one
    const allChecked = checklist.every((mark) => mark === "x");
    if (allChecked && ticket.state !== "done") {
      offenders.push(`${ticket.id}: every plan checklist box is [x] but ticket is ${ticket.state}`);
    }
    if (!allChecked && ticket.state === "done") {
      offenders.push(`${ticket.id}: ticket is done but the plan still has unchecked boxes`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("each ticket carries its Section B build prompt byte-identically", () => {
  const source = sectionBPrompts();
  const offenders: string[] = [];
  for (const ticket of tickets()) {
    const block = source.get(ticket.number);
    if (!block) {
      offenders.push(`${ticket.id}: no Section B block in awsf-plan-build-prompts.md`);
      continue;
    }
    if (block.prompt !== ticket.prompt) offenders.push(`${ticket.id}: build prompt has drifted from Section B`);
    if (block.title !== ticket.title) offenders.push(`${ticket.id}: title differs from its Section B heading`);
  }
  assert.deepEqual(offenders, []);
});

test("depends_on points only backwards at tickets that exist", () => {
  const all = tickets();
  const ids = new Set(all.map((t) => t.id));
  const offenders: string[] = [];
  for (const ticket of all) {
    for (const dep of ticket.depends_on) {
      if (!ids.has(dep)) offenders.push(`${ticket.id}: depends on ${dep}, which does not exist`);
      else if (dep >= ticket.id) offenders.push(`${ticket.id}: depends on ${dep}, which is not earlier`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("a done ticket never waits on unfinished work", () => {
  const all = tickets();
  const stateOf = new Map(all.map((t) => [t.id, t.state]));
  const offenders = all
    .filter((t) => t.state === "done")
    .flatMap((t) => t.depends_on.filter((dep) => stateOf.get(dep) !== "done").map((dep) => `${t.id} is done but ${dep} is ${stateOf.get(dep)}`));
  assert.deepEqual(offenders, []);
});

test("frontmatter values stay inside their vocabularies", () => {
  const offenders: string[] = [];
  for (const ticket of tickets()) {
    if (!STATES.includes(ticket.state)) offenders.push(`${ticket.id}: state "${ticket.state}"`);
    if (!TIERS.includes(ticket.tier)) offenders.push(`${ticket.id}: tier "${ticket.tier}"`);
    if (!WORKFLOWS.includes(ticket.workflow)) offenders.push(`${ticket.id}: workflow "${ticket.workflow}"`);
    if (!/^T\d\d$/.test(ticket.id)) offenders.push(`${ticket.id}: id is not zero-padded Tnn`);
  }
  assert.deepEqual(offenders, []);
});
