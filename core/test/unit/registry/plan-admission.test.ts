import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { admitPlanSet, planAdmissionDocuments, verifyPlanAdmission, type PlanAdmissionInput } from "../../../src/registry/plan-admission.ts";
import { noProtectedPaths } from "../../../src/gates/git-diff.ts";
import { renderPlanDocument } from "../../../src/registry/plan-render.ts";
import { validDesignPlanOutput, validPlanContext } from "../contracts/fixtures.ts";
import { agreementTicket, sectionBBlocks } from "../../../src/closure/tree.ts";
import { parsePlanTicketBody } from "../../../src/persistence/plan-ticket-body.ts";
import { parseAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";
import { planAgreement } from "../../../src/registry/plan-agreement.ts";
import { PlanAdmissionRecordSchema, PLAN_ADMISSION_SCHEMA_ID } from "../../../src/contracts/plan-admission.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";

const stem = "new-plan";
const at = "2026-10-10T00:00:00Z";
const protectedPaths = ["specs/*.html", "specs/*-build-prompts.md", "specs/tickets/*/**"];
function input(): PlanAdmissionInput {
  const plan = validDesignPlanOutput();
  const docs = renderPlanDocument({ stem, plan, identifierSet: validPlanContext().identifierSet });
  return { stem, planHtml: docs.get(`specs/${stem}.html`)!, buildPrompts: docs.get(`specs/${stem}-build-prompts.md`)!,
    tickets: plan.steps.map(step => ({ id: step.id, title: step.title, milestone: step.milestone, depends_on: step.dependsOn, serves: step.serves })) };
}
function git(root: string, ...argv: string[]): string { return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8" }).trim(); }
function commit(root: string): string {
  git(root, "add", ".");
  git(root, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed admission fixture");
  return git(root, "rev-parse", "HEAD");
}
function world() {
  const root = mkdtempSync(join(tmpdir(), "awsf-admission-"));
  git(root, "init", "-b", "main"); writeFileSync(join(root, "README.md"), "seed\n");
  return { root, baseSha: commit(root), close: () => rmSync(root, { recursive: true, force: true }) };
}
function write(root: string, path: string, content = "existing\n") { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }

test("admission derives fenced prompt bytes, idle markers and todo states from one table", () => {
  const value = input(), docs = planAdmissionDocuments(value);
  assert.equal(docs.size, value.tickets.length + 3);
  const tickets = value.tickets.map(row => {
    const path = `specs/tickets/${stem}/${row.id}.md`, text = docs.get(path)!;
    assert.equal(parsePlanTicketBody(text).prompt, sectionBBlocks(value.buildPrompts).get(Number(row.id.slice(1)))!.prompt);
    return agreementTicket(text, path);
  });
  assert.ok(tickets.every(ticket => ticket.state === "todo"));
  const plan = parseAwsfPlanHtmlV1(value.planHtml, stem);
  assert.deepEqual(planAgreement({ label: stem, plan, tickets, sectionB: sectionBBlocks(value.buildPrompts), knownStems: [stem] }), []);
  assert.ok(plan.every(task => task.milestoneMarker === "" && task.checklist.every(marker => marker === "")));
});

test("admission journals a closed host record, not a provider envelope", () => {
  const w = world();
  try {
    const admitted = admitPlanSet({ ...input(), worktree: w.root, baseSha: w.baseSha, at });
    assert.equal(RECORD_SCHEMAS[PLAN_ADMISSION_SCHEMA_ID], PlanAdmissionRecordSchema);
    assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, PLAN_ADMISSION_SCHEMA_ID), false);
    assert.equal(Value.Check(PlanAdmissionRecordSchema, admitted.record), true);
    assert.equal(Value.Check(PlanAdmissionRecordSchema, { ...admitted.record, extra: true }), false);
    assert.equal(git(w.root, "rev-parse", "HEAD"), w.baseSha, "admission does not commit");
    const paths = [...admitted.documents.keys()];
    assert.equal(noProtectedPaths(paths, protectedPaths).passed, false);
    assert.equal(noProtectedPaths(paths, protectedPaths, true, [admitted.capability]).passed, true);
    assert.equal(noProtectedPaths(["specs/old.html"], protectedPaths, true, [admitted.capability]).passed, false);
    assert.equal(noProtectedPaths(paths, protectedPaths, true, [Object.assign({}, admitted.capability)]).passed, false);
    assert.equal(noProtectedPaths(paths, protectedPaths, true, [JSON.parse(JSON.stringify(admitted.capability))]).passed, false);
    assert.equal(noProtectedPaths(["SPECS/NEW-PLAN.HTML"], protectedPaths, true, [admitted.capability]).passed, false);
    commit(w.root);
    assert.equal(noProtectedPaths(paths, protectedPaths, true, [admitted.capability]).passed, true, "proof survives the host commit");
    assert.ok(verifyPlanAdmission({ ...input(), worktree: w.root, baseSha: w.baseSha }));
  } finally { w.close(); }
});

for (const path of [`specs/${stem}.html`, `specs/${stem}-build-prompts.md`, `specs/tickets/${stem}/README.md`, `specs/tickets/${stem}/T01.md`, `specs/tickets/${stem}/T99.md`]) {
  test(`admission refuses existing base path ${path}, including after its deletion`, () => {
    const w = world();
    try {
      write(w.root, path); const baseSha = commit(w.root);
      assert.throws(() => admitPlanSet({ ...input(), worktree: w.root, baseSha, at }), /exists at the base/u);
      assert.equal(readFileSync(join(w.root, path), "utf8"), "existing\n");
      rmSync(join(w.root, path)); commit(w.root);
      assert.throws(() => admitPlanSet({ ...input(), worktree: w.root, baseSha, at }), /exists at the base/u);
      assert.equal(existsSync(join(w.root, path)), false);
    } finally { w.close(); }
  });
}

test("a case-folded base collision is not a new protected path", () => {
  const w = world();
  try {
    write(w.root, "specs/NEW-PLAN.html"); const baseSha = commit(w.root);
    assert.throws(() => admitPlanSet({ ...input(), worktree: w.root, baseSha, at }), /exists at the base/u);
    assert.equal(existsSync(join(w.root, `specs/${stem}.html`)), false);
  } finally { w.close(); }
});

for (const defect of ["existing-target", "target-symlink", "parent-symlink", "parent-file", "invalid-base", "root-symlink", "current-ticket-set", "missing-time"] as const) {
  test(`admission refuses ${defect} before writing any member of the set`, () => {
    const w = world();
    try {
      let root = w.root, baseSha = w.baseSha;
      if (defect === "existing-target") write(root, `specs/tickets/${stem}/T01.md`);
      if (defect === "target-symlink") { mkdirSync(join(root, "specs")); symlinkSync(join(root, "README.md"), join(root, `specs/${stem}.html`)); }
      if (defect === "parent-symlink") { mkdirSync(join(root, "outside")); symlinkSync(join(root, "outside"), join(root, "specs")); }
      if (defect === "parent-file") writeFileSync(join(root, "specs"), "not a directory\n");
      if (defect === "invalid-base") baseSha = "HEAD";
      if (defect === "current-ticket-set") write(root, `specs/tickets/${stem}/T99.md`);
      if (defect === "root-symlink") { symlinkSync(root, join(root, "alias")); root = join(root, "alias"); }
      const before = git(w.root, "status", "--porcelain");
      assert.throws(() => admitPlanSet({ ...input(), worktree: root, baseSha, at: defect === "missing-time" ? "" : at }));
      assert.equal(git(w.root, "status", "--porcelain"), before);
      assert.equal(readFileSync(join(w.root, "README.md"), "utf8"), "seed\n");
      if (defect === "parent-symlink") assert.deepEqual(readdirSync(join(w.root, "outside")), []);
    } finally { w.close(); }
  });
}

const invalidInputs: Array<[string, (value: PlanAdmissionInput) => PlanAdmissionInput]> = [
  ["escaping stem", value => ({ ...value, stem: "../old" })],
  ["empty table", value => ({ ...value, tickets: [] })],
  ["state supplied", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, state: "wip" })) })],
  ["path supplied", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, path: "specs/old.html" })) })],
  ["completed marker", value => ({ ...value, planHtml: value.planHtml.replace("[]", "[x]") })],
  ["working marker", value => ({ ...value, planHtml: value.planHtml.replace("[]", "[wip]") })],
  ["failed marker", value => ({ ...value, planHtml: value.planHtml.replace("[]", "[f]") })],
  ["invalid grammar", value => ({ ...value, planHtml: "<html>No milestones</html>" })],
  ["missing task", value => ({ ...value, planHtml: value.planHtml.replace("<h4>1.", "<h4>99.") })],
  ["missing checklist", value => ({ ...value, planHtml: value.planHtml.replace(/<li><code class="status">\[\]<\/code>.*?<\/li>/gu, "") })],
  ["duplicate prompt", value => ({ ...value, buildPrompts: `${value.buildPrompts}\n${value.buildPrompts}` })],
  ["missing prompt", value => ({ ...value, buildPrompts: "# Section B — Task prompts (recommended)\n" })],
  ["unfenced prompt", value => ({ ...value, buildPrompts: value.buildPrompts.replaceAll("```", "") })],
  ["different title", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, title: "Changed" })) })],
  ["wrong milestone", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, milestone: "M99" })) })],
  ["unknown dependency", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, depends_on: ["T99"] })) })],
  ["self dependency", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, depends_on: [row.id] })) })],
  ["foreign workflow", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, workflow: "wrong" })) })],
  ["foreign task class", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, task_class: "wrong" })) })],
  ["foreign tier", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, tier: 3 })) })],
  ["unmirrored claims", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, serves: [] })) })],
  ["nonsequential ids", value => ({ ...value, tickets: value.tickets.map(row => ({ ...row, id: "T00" })) })],
];
for (const [name, mutate] of invalidInputs) {
  test(`admission refuses ${name} without writing`, () => {
    const w = world();
    try {
      assert.throws(() => admitPlanSet({ ...mutate(input()), worktree: w.root, baseSha: w.baseSha, at }));
      assert.equal(existsSync(join(w.root, "specs")), false);
      assert.equal(git(w.root, "status", "--porcelain"), "");
    } finally { w.close(); }
  });
}

for (const defect of ["bytes", "mode", "hardlink", "symlink", "missing", "other-member", "index-bytes", "index-mode", "committed-bytes"] as const) {
  test(`the admission gate rechecks ${defect} rather than trusting stale authority`, () => {
    const w = world();
    try {
      const admitted = admitPlanSet({ ...input(), worktree: w.root, baseSha: w.baseSha, at });
      const path = `specs/${stem}.html`, target = join(w.root, path);
      if (defect === "bytes") writeFileSync(target, "changed\n");
      if (defect === "mode") chmodSync(target, 0o755);
      if (defect === "hardlink") linkSync(target, join(w.root, "linked"));
      if (defect === "symlink") { rmSync(target); symlinkSync(join(w.root, "README.md"), target); }
      if (defect === "missing") rmSync(target);
      if (defect === "other-member") writeFileSync(join(w.root, `specs/tickets/${stem}/T01.md`), "changed\n");
      if (defect === "index-mode") { git(w.root, "add", path); git(w.root, "update-index", "--chmod=+x", "--", path); }
      if (defect === "index-bytes" || defect === "committed-bytes") {
        const blob = execFileSync("git", ["-C", w.root, "hash-object", "-w", "--stdin"], { input: "changed\n", encoding: "utf8" }).trim();
        git(w.root, "update-index", "--add", "--cacheinfo", `100644,${blob},${path}`);
        if (defect === "committed-bytes") git(w.root, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: changed admission blob");
      }
      assert.equal(noProtectedPaths([path], protectedPaths, true, [admitted.capability]).passed, false);
      assert.throws(() => verifyPlanAdmission({ ...input(), worktree: w.root, baseSha: w.baseSha }));
    } finally { w.close(); }
  });
}
