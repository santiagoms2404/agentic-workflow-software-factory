import { test } from "node:test";
import assert from "node:assert/strict";
import { closureDelta, type ClosureDeltaRefusal } from "../../../src/closure/delta.ts";
import { parseAwsfPlanHtmlV1, scanAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";
import { ticketFrontmatter, type ClosureRegistry } from "../../../src/closure/tree.ts";
import { PLAN, TICKET, PROMPTS, LIGHT, plan, registry, lightRegistry, tree, change } from "./_fixtures.ts";

function refused(after: ReadonlyMap<string, Uint8Array>, kind: ClosureDeltaRefusal["kind"], before = tree(), sources = registry): ClosureDeltaRefusal {
  const result = closureDelta(before, after, sources);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected refusal");
  assert.equal(result.refusal.code, "E_CLOSURE_DELTA");
  assert.equal(result.refusal.kind, kind, result.refusal.message);
  assert.equal(typeof result.refusal.offset, "number");
  assert.equal(typeof result.refusal.beforeContext, "string");
  assert.equal(typeof result.refusal.afterContext, "string");
  return result.refusal;
}

test("an unchanged complete tree passes agreement without changing arbitrary binary bytes", () => {
  assert.deepEqual(closureDelta(tree(), tree(), registry), { ok: true, changes: [] });
});

for (const marker of ["", "wip", "x"]) {
  test(`accepts checklist after-value ${JSON.stringify(marker)} with agreeing state`, () => {
    const before = tree();
    let after = change(before, PLAN, '<li><code class="status">[]', `<li><code class="status">[${marker}]`);
    if (marker !== "") after = change(after, TICKET, "state: todo", `state: ${marker === "x" ? "done" : "wip"}`);
    if (marker === "x") after = change(after, PLAN, '[]</code> Milestone', '[x]</code> Milestone');
    const result = closureDelta(before, after, registry);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const row = result.changes.find((entry) => entry.kind === "status");
    if (marker !== "") assert.deepEqual(row, { path: PLAN, kind: "status", milestone: "M1", taskNumber: 1,
      rowIndex: 0, oldValue: "", newValue: marker });
    else assert.deepEqual(result.changes, []);
  });
}

for (const state of ["todo", "wip", "done"]) {
  test(`accepts flat ticket state ${state} and reports its ticket number`, () => {
    const before = tree(true);
    const result = closureDelta(before, change(before, LIGHT, "state: todo", `state: ${state}`), lightRegistry);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok && state !== "todo") assert.deepEqual(result.changes, [{ path: LIGHT, kind: "state", milestone: null,
      taskNumber: 2, rowIndex: null, oldValue: "todo", newValue: state }]);
  });
}

test("accepts milestone-only wip and gives null task and row indices", () => {
  const result = closureDelta(tree(), change(tree(), PLAN, '[]</code> Milestone', '[wip]</code> Milestone'), registry);
  assert.deepEqual(result, { ok: true, changes: [{ path: PLAN, kind: "milestone", milestone: "M1",
    taskNumber: null, rowIndex: null, oldValue: "", newValue: "wip" }] });
});

test("can repair a failed before-marker and state, but cannot write failed after-values", () => {
  const before = change(change(tree(), PLAN, '<li><code class="status">[]', '<li><code class="status">[f]'), TICKET, "state: todo", "state: failed");
  assert.equal(closureDelta(before, tree(), registry).ok, true);
});

for (const marker of ["f", "unknown", "X", " x "]) {
  test(`refuses marker after-value ${JSON.stringify(marker)}`, () => {
    refused(change(tree(), PLAN, '<li><code class="status">[]', `<li><code class="status">[${marker}]`), "vocabulary");
  });
}
for (const state of ["failed", "unknown"]) {
  test(`refuses state after-value ${state}`, () => {
    refused(change(tree(), TICKET, "state: todo", `state: ${state}`), "vocabulary");
  });
}

for (const [path, from, to] of [
  [PLAN, "Acceptance row.", "Acceptance row!"],
  [PLAN, "The ask stays fixed.", "The ask stays fixed!"],
  [PLAN, 'class="status"', 'class="status extra"'],
  [PLAN, '<h4>1.', '<h4>2.'],
  [PLAN, '<p><code class="status">[]', '<p><code class="status">[wip]'],
  [TICKET, "Old findings.", "New findings."],
  [TICKET, "title: A task", "title: A task!"],
  [TICKET, "depends_on: []", "depends_on: [T00]"],
  [TICKET, "serves: [INV-1]", "serves: []"],
  [TICKET, "Build the task.", "Build a task."],
  [PROMPTS, "Build the task.", "Build a task."],
  [TICKET, "state: todo", "state: wip # a new comment"],
] as const) {
  test(`refuses non-value bytes in ${path}: ${from}`, () => {
    const failure = refused(change(tree(), path, from, to), "content");
    assert.equal(failure.path, path);
  });
}

test("refuses additions, removals and a rename rather than treating absent bytes as empty", () => {
  const added = tree(); added.set("new.txt", Buffer.alloc(0));
  assert.equal(refused(added, "paths").path, "new.txt");
  const removed = tree(); removed.delete(TICKET);
  assert.equal(refused(removed, "paths").path, TICKET);
  const renamed = tree(); renamed.set("paired/source/T02.md", renamed.get(TICKET)!); renamed.delete(TICKET);
  refused(renamed, "paths");
});

test("refuses a state flip or a marker flip that violates the shared agreement rules", () => {
  for (const after of [change(tree(), TICKET, "state: todo", "state: done"),
    change(tree(), PLAN, '<li><code class="status">[]', '<li><code class="status">[x]')]) {
    assert.ok(refused(after, "agreement").violations?.some((violation) => violation.rule === "CHECKLIST_STATE"));
  }
});

test("agreement checks the entire after tree, not just changed or selected files", () => {
  const bad = change(tree(), PROMPTS, "Build the task.", "Build another task.");
  const failure = refused(bad, "agreement", bad);
  assert.ok(failure.violations?.some((violation) => violation.rule === "PROMPT"));
});

test("refuses malformed frontmatter, duplicate state keys and missing registered sources", () => {
  for (const replacement of ["state: todo\nstate: wip", "other: todo", "state: [todo]", "state: |\n  todo"]) {
    refused(change(tree(), TICKET, "state: todo", replacement), "tree");
  }
  const incomplete = tree(); incomplete.delete(PROMPTS);
  refused(incomplete, "tree", incomplete);
});

test("invalid UTF-8 is never normalized into an accepted substitution", () => {
  const after = tree(); after.set(TICKET, Buffer.concat([Buffer.from(after.get(TICKET)!), Buffer.from([255])]));
  refused(after, "tree");
});

test("a registered source's unsupported declared format is refused", () => {
  const other: ClosureRegistry = { plans: [{ ...registry.plans[0]!, format: "foreign/v1" as "awsf-plan-html/v1" }] };
  refused(tree(), "tree", tree(), other);
});

test("refusal offsets count UTF-8 bytes and include the first differing byte's context", () => {
  const before = change(tree(), PLAN, "Acceptance row.", "Évidence row.");
  const after = change(before, PLAN, "Évidence row.", "Évidence row!");
  const failure = refused(after, "content", before);
  assert.equal(failure.offset, Buffer.from(plan.replace("Acceptance row.", "Évidence row.").split("Évidence row.")[0]! + "Évidence row").length);
  assert.match(failure.beforeContext, /Évidence row\./u);
  assert.match(failure.afterContext, /Évidence row!/u);
});

test("state masking preserves single/double quotes, comments and spacing, including light CRLF", () => {
  for (const quote of ["'", '"', ""]) {
    const before = change(tree(), TICKET, "state: todo", `state:  ${quote}todo${quote} # keep`);
    const after = change(before, TICKET, `${quote}todo${quote} # keep`, `${quote}wip${quote} # keep`);
    assert.equal(closureDelta(before, after, registry).ok, true);
    const fm = ticketFrontmatter(Buffer.from(after.get(TICKET)!).toString(), TICKET);
    assert.equal(Buffer.from(after.get(TICKET)!).toString().slice(fm.stateStart, fm.stateEnd), "wip");
  }
  const before = tree(true);
  before.set(LIGHT, Buffer.from(Buffer.from(before.get(LIGHT)!).toString().replaceAll("\n", "\r\n")));
  assert.equal(closureDelta(before, change(before, LIGHT, "state: todo", "state: wip"), lightRegistry).ok, true);
  refused(change(tree(), TICKET, "state: todo", "state: 'wip'"), "content");
});

test("supplied complete Git modes reject chmod, even with identical bytes", () => {
  const modes = new Map([...tree().keys()].map((path) => [path, "100644"]));
  assert.equal(closureDelta(tree(), tree(), registry, { before: modes, after: modes }).ok, true);
  const changed = new Map(modes); changed.set(PLAN, "100755");
  const result = closureDelta(tree(), tree(), registry, { before: modes, after: changed });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, "mode");
  const missing = new Map(modes); missing.delete(PLAN);
  assert.equal(closureDelta(tree(), tree(), registry, { before: modes, after: missing }).ok, false);
});

test("scanner and parser share the exact milestone, task, section and status grammar", () => {
  const html = `<h3><code class="status">[wip]</code> Milestone M1: One
<h4>1. Task
<code class="status">[x]</code> bare row
<code class="status extra">[x]</code> not read
<code class='status'>[x]</code> not read
<code class="status">[wip]</code> another row
</section>
<code class="status">[f]</code> outside
<h3><code class="status">[]</code> Milestone M2: Two
<h4>2. Task
<code class="status">[]</code> row
</section>`;
  const scanned = scanAwsfPlanHtmlV1(html);
  const parsed = parseAwsfPlanHtmlV1(html, "sample");
  assert.deepEqual(scanned.tasks.map((task) => task.tokens.map((token) => token.value)), parsed.map((task) => task.checklist));
  assert.equal(scanned.tasks.flatMap((task) => task.tokens).length, 3);
  for (const token of [...scanned.milestones, ...scanned.tasks.flatMap((task) => task.tokens)]) {
    assert.equal(html.slice(token.start, token.end), `<code class="status">[${token.value}]</code>`);
  }
});
