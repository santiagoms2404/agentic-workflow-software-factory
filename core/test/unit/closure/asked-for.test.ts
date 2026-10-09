import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAskedFor, planTicketAsk, lightTicketAsk, withoutHandoffs,
  type AskedForSelection } from "../../../src/closure/asked-for.ts";
import { PLAN, TICKET, LIGHT, registry, lightRegistry, plan, ticket, light, tree, change } from "./_fixtures.ts";

const selected: readonly AskedForSelection[] = [{ kind: "plan", plan: "sample", ticket: "T01" }];
const lightSelected: readonly AskedForSelection[] = [{ kind: "light", ticket: "T02" }];
function fields(before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>): readonly string[] {
  const result = compareAskedFor(before, after, registry, selected);
  assert.equal(result.ok, false);
  if (result.ok || result.refusal.code !== "E_CLOSURE_ASK_CHANGED") throw new Error(JSON.stringify(result));
  return result.refusal.differences.map((difference) => difference.field);
}

test("extracts exactly the plan ticket ask fields, masked checklist and declarations", () => {
  assert.deepEqual(planTicketAsk(plan, ticket, 1), {
    prompt: "```\nBuild the task.\n```", title: "A task", milestone: "M1", depends_on: [], serves: ["INV-1"],
    checklist: ['<li><code class="status">[]</code> Acceptance row.</li>'],
    declarations: [{ id: "INV-1", statement: "The ask stays fixed." }],
  });
});

test("state, checklist markers, milestone markers, handoff and unrelated files are not an ask change", () => {
  const before = tree();
  let after = change(before, TICKET, "state: todo", "state: done");
  after = change(after, TICKET, "Old findings.", "Dated findings.\n\nNew details.");
  after = change(after, PLAN, '<li><code class="status">[]', '<li><code class="status">[x]');
  after = change(after, PLAN, '[]</code> Milestone', '[x]</code> Milestone');
  after.set("unrelated.txt", Buffer.from("changed outside the ask"));
  assert.deepEqual(compareAskedFor(before, after, registry, selected), { ok: true, differences: [] });
});

for (const [path, from, to, field] of [
  [TICKET, "Build the task.", "Build a task.", "prompt"],
  [TICKET, "title: A task", "title: Another task", "title"],
  [TICKET, "milestone: M1", "milestone: M2", "milestone"],
  [TICKET, "depends_on: []", "depends_on: [T00]", "depends_on"],
  [TICKET, "serves: [INV-1]", "serves: []", "serves"],
  [PLAN, "Acceptance row.", "Acceptance row!", "checklist"],
  [PLAN, "The ask stays fixed.", "The ask stays changed.", "declarations"],
] as const) {
  test(`names a changed plan ask field: ${field}`, () => {
    assert.deepEqual(fields(tree(), change(tree(), path, from, to)), [field]);
  });
}

test("reports every differing field, not only the first one", () => {
  let after = change(tree(), TICKET, "title: A task", "title: Another task");
  after = change(after, TICKET, "Build the task.", "Build another task.");
  after = change(after, PLAN, "Acceptance row.", "Acceptance row!");
  assert.deepEqual(fields(tree(), after), ["prompt", "title", "checklist"]);
});

test("does not erase a Handoff-shaped heading inside a plan build prompt", () => {
  const before = change(tree(), TICKET, "Build the task.", "Build the task.\n## Handoff\nThis is prompt content.");
  assert.deepEqual(fields(before, change(before, TICKET, "This is prompt content.", "This is changed prompt content.")), ["prompt"]);
});

test("a non-parser status lookalike inside a checklist row remains part of the ask", () => {
  const before = change(tree(), PLAN, "Acceptance row.", "Acceptance <code class='status'>[]</code> row.");
  assert.deepEqual(fields(before, change(before, PLAN, "class='status'>[]", "class='status'>[x]")), ["checklist"]);
});

test("a link element cannot truncate the protected acceptance row before a token", () => {
  const before = change(tree(), PLAN, '<li><code class="status">', '<li>Fixed prefix <link href="fixture.css"><code class="status">');
  assert.deepEqual(fields(before, change(before, PLAN, "Fixed prefix", "Changed prefix")), ["checklist"]);
});

test("the parser's bare-line checklist rows protect their texts and mask only their tokens", () => {
  const before = change(tree(), PLAN, '<ul><li><code class="status">[]</code> Acceptance row.</li></ul>', '<code class="status">[]</code> A bare acceptance row.');
  assert.deepEqual(compareAskedFor(before, change(before, PLAN, '[]</code> A bare', '[wip]</code> A bare'), registry, selected), { ok: true, differences: [] });
  assert.deepEqual(fields(before, change(before, PLAN, "A bare acceptance row.", "A bare changed row.")), ["checklist"]);
});

test("a duplicate or missing selected task is refused rather than silently choosing one", () => {
  for (const after of [change(tree(), PLAN, "<h4>1. A task", "<h4>2. A task"),
    change(tree(), PLAN, "</section>\n<p>", '<h4>1. Duplicate\n<code class="status">[]</code> Row\n</section>\n<p>')]) {
    const result = compareAskedFor(tree(), after, registry, selected);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal.code, "E_CLOSURE_TREE");
  }
});

test("extracts every light frontmatter field except state, and excludes its Handoff body section", () => {
  const ask = lightTicketAsk(light);
  assert.equal(Object.hasOwn(ask.frontmatter, "state"), false);
  assert.equal(ask.frontmatter.outcome, "A fixed outcome");
  assert.equal(ask.frontmatter.tier, 0);
  assert.equal(ask.body, "Body of the light ask.\n");
  const before = tree(true);
  let after = change(before, LIGHT, "state: todo", "state: done");
  after = change(after, LIGHT, "Old findings.", "New dated findings.");
  assert.deepEqual(compareAskedFor(before, after, lightRegistry, lightSelected), { ok: true, differences: [] });
});

for (const [from, to, field] of [
  ["title: Light work", "title: Changed work", "frontmatter.title"],
  ["tier: 0", "tier: 1", "frontmatter.tier"],
  ["workflow: build-review", "workflow: build", "frontmatter.workflow"],
  ["A fixed outcome", "A changed outcome", "frontmatter.outcome"],
  ["A fixed acceptance", "A changed acceptance", "frontmatter.acceptance"],
  ["context: [A fixed context]", "context: [A changed context]", "frontmatter.context"],
  ["non_goals: []", "non_goals: [Another goal]", "frontmatter.non_goals"],
  ["Body of the light ask.", "Body of a changed ask.", "body"],
] as const) {
  test(`names a changed light ask field: ${field}`, () => {
    const before = tree(true);
    const result = compareAskedFor(before, change(before, LIGHT, from, to), lightRegistry, lightSelected);
    assert.equal(result.ok, false);
    if (result.ok || result.refusal.code !== "E_CLOSURE_ASK_CHANGED") throw new Error(JSON.stringify(result));
    assert.deepEqual(result.refusal.differences.map((difference) => difference.field), [field]);
  });
}

test("light fields are compared recursively, with mapping order immaterial and array order retained", () => {
  const before = change(tree(true), LIGHT, "context: [A fixed context]", "context: [{first: one, second: two}, tail]");
  const same = change(before, LIGHT, "{first: one, second: two}", "{second: two, first: one}");
  assert.equal(compareAskedFor(before, same, lightRegistry, lightSelected).ok, true);
  const different = change(before, LIGHT, "[{first: one, second: two}, tail]", "[tail, {first: one, second: two}]");
  assert.equal(compareAskedFor(before, different, lightRegistry, lightSelected).ok, false);
});

test("light comparison names added and removed frontmatter fields", () => {
  const before = tree(true);
  const after = change(change(before, LIGHT, "tier: 0\n", ""), LIGHT, "state: todo", "state: todo\nextra: ask");
  const result = compareAskedFor(before, after, lightRegistry, lightSelected);
  if (result.ok || result.refusal.code !== "E_CLOSURE_ASK_CHANGED") throw new Error(JSON.stringify(result));
  assert.deepEqual(result.refusal.differences.map((difference) => difference.field), ["frontmatter.extra", "frontmatter.tier"]);
});

test("adding or removing a light Handoff section leaves its ask unchanged", () => {
  const before = tree(true);
  const noHandoff = change(before, LIGHT, "\n## Handoff\n\nOld findings.\n", "");
  // The extra blank separator introducing a Handoff belongs to that section.
  noHandoff.set(LIGHT, Buffer.from(Buffer.from(noHandoff.get(LIGHT)!).toString().replace(/\n\n$/u, "\n")));
  assert.equal(compareAskedFor(before, noHandoff, lightRegistry, lightSelected).ok, true);
  assert.equal(compareAskedFor(noHandoff, before, lightRegistry, lightSelected).ok, true);
});

test("Handoff exclusion ends at the next heading and leaves fenced headings untouched", () => {
  const body = "Ask.\n\n```md\n## Handoff\nNot a handoff.\n```\n\n## Handoff\nOmitted.\n\n## Acceptance\nStill ask.\n";
  assert.equal(withoutHandoffs(body), "Ask.\n\n```md\n## Handoff\nNot a handoff.\n```\n\n## Acceptance\nStill ask.\n");
  assert.match(withoutHandoffs("~~~md\n## Handoff\nAsk.\n~~~\n"), /Ask\./u);
});

test("comparison resolves registered sources independently on both trees, never a sealed path", () => {
  const before = tree();
  const after = new Map(before);
  after.set("moved/plan.html", after.get(PLAN)!); after.delete(PLAN);
  after.set("moved/tickets/T01.md", after.get(TICKET)!); after.delete(TICKET);
  const relocated = { plans: [{ ...registry.plans[0]!, planPath: "moved/plan.html", ticketsPath: "moved/tickets" }] };
  assert.deepEqual(compareAskedFor(before, after, registry, selected, relocated), { ok: true, differences: [] });
});

test("unresolved selection, missing file, malformed ticket and wrong file identity refuse by name", () => {
  const missing = tree(); missing.delete(TICKET);
  const malformed = change(tree(), TICKET, "---\nid: T01", "---\nid: [");
  const wrong = change(tree(), TICKET, "id: T01", "id: T02");
  for (const result of [compareAskedFor(tree(), missing, registry, selected),
    compareAskedFor(tree(), malformed, registry, selected), compareAskedFor(tree(), wrong, registry, selected),
    compareAskedFor(tree(), tree(), { plans: [] }, selected),
    compareAskedFor(tree(true), tree(true), registry, lightSelected),
    compareAskedFor(tree(), tree(), registry, [{ kind: "plan", plan: "sample", ticket: "../T01" }])]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal.code, "E_CLOSURE_TREE");
  }
});
