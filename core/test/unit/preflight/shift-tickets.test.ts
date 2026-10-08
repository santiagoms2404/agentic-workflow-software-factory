import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { evaluateWriteBoundary } from "../../../src/preflight/fields.ts";
import { readShiftTicketDoBlocks, ticketDoBlock } from "../../../src/preflight/shift-tickets.ts";
import { box, commit, draft, prepare, start } from "../../fixtures/trap-world.ts";
import { k1Request } from "../../fixtures/k1-preflight.ts";
import { registerShiftPlan } from "../../fixtures/shift-plan.ts";

const prompt = "READ FIRST\n  specs/read.html\n\nDO\n  Read `specs/context.html`, then build core/src/example.ts.\n\nDO NOT\n  Edit specs/elsewhere.html.\n\nHANDOFF\n  Mention specs/later.html.\n";
const boundary = (doBlock: string, read: string[] = [], builderWrites = ["core/src/**"]) => evaluateWriteBoundary({
  request: k1Request("run selected tickets", "core/src/example.ts"), where: ["core/src/example.ts"], read,
  protectedPaths: ["core/src/state/**", "core/src/execution/transport-broker.ts"],
  writers: [{ phase: "builder", writes: builderWrites }],
  shift: { builderWrites, tickets: [{ id: "T02", doBlock }] },
});

test("DO extraction ignores frontmatter, handoff and every other prompt section, including DO NOT", () => {
  assert.equal(ticketDoBlock(prompt), "  Read `specs/context.html`, then build core/src/example.ts.\n");
  assert.equal(ticketDoBlock("READ FIRST\n  specs/context.html\n"), "");
  assert.equal(ticketDoBlock("DO\r\n  core/src/example.ts\r\n\r\nDO NOT\r\n  specs/context.html"), "  core/src/example.ts\n");
});

test("every selected DO token outside reach needs the shared read classification, regardless of verbs or where", () => {
  const result = boundary(ticketDoBlock(prompt));
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /ticket T02 DO token specs\/context.html/u);
    assert.doesNotMatch(result.reason, /read.html|elsewhere|later/u);
  }
  assert.deepEqual(boundary(ticketDoBlock(prompt), ["specs/context.html"]), { passed: true });
  assert.deepEqual(boundary(ticketDoBlock(prompt), ["specs/**"]), { passed: true });
  assert.deepEqual(boundary("  Build core/src/example.ts."), { passed: true });
  assert.equal(boundary("  Only read specs/context.html", ["specs/another.html"]).passed, false);
  assert.equal(boundary("  https://example.test/manual").passed, true);
});

test("protected DO paths remain outside shift reach even under builder globs, with suffix and broad-glob classification", () => {
  for (const token of ["core/src/state/task-machine.ts", "state/task-machine.ts", "transport-broker.ts", "core/src/**"]) {
    assert.equal(boundary(`  Read ${token}`).passed, false, token);
    assert.deepEqual(boundary(`  Read ${token}`, ["core/src/state/**", "core/src/execution/transport-broker.ts"]), { passed: true }, token);
  }
  assert.deepEqual(boundary("  Read /synthetic/repository/specs/context.html", ["specs/**"]), { passed: true });
  assert.equal(boundary("  Write core/src/**/*.ts", [], ["core/src/*"]).passed, false);
});

test("one --read flag clears the production shift refusal without changing the builder's write reach", async () => {
  const b = box();
  try {
    const created = await draft(b, k1Request("run selected tickets", "core/src/example.ts"), "shift", true);
    const result = await prepare(b, created.attemptDir, { read: ["specs/synthetic.html"] });
    assert.equal(result.record.fields.find(field => field.id === "write-boundary")?.passed, true);
    const prepared = await start(b, created.attemptDir);
    assert.equal(prepared.lifecycleState, "PREPARED");
    assert.equal(prepared.budget.callsReserved, 0);
    assert.equal(b.calls.length, 0);
  } finally { b.close(); }
});

test("registered plans.root, selected ids and sealed bytes determine the scan, not directory adjacency", async () => {
  const b = box();
  try {
    registerShiftPlan(b.repository, b.config.project.slug, "synthetic", "plans");
    const path = "plans/tickets/synthetic/T02.md";
    const source = `---\nid: T02\ntitle: Synthetic\nmilestone: M1\nstate: todo\ndepends_on: []\n---\n## Handoff\nDO\n  specs/handoff.html\n\n## Build prompt\n\n\`\`\`\n${prompt}\`\`\`\n`;
    writeFileSync(join(b.repository, path), source);
    writeFileSync(join(b.repository, "plans/tickets/synthetic/T03.md"), "unselected garbage");
    mkdirSync(join(b.repository, "specs/tickets/synthetic"), { recursive: true });
    writeFileSync(join(b.repository, "specs/tickets/synthetic/T02.md"), "adjacent decoy");
    const manifest = sealShiftManifest({ plan: "synthetic", milestones: ["M1"], tickets: [{ id: "T02", path, digest: ticketFileDigest(Buffer.from(source)) }] });
    assert.deepEqual(await readShiftTicketDoBlocks(b.repository, manifest), [{ id: "T02", doBlock: ticketDoBlock(prompt) }]);
    await assert.rejects(readShiftTicketDoBlocks(b.repository, { ...manifest, tickets: [{ ...manifest.tickets[0]!, path: "specs/tickets/synthetic/T02.md" }] }), /not in registered plan/u);
    writeFileSync(join(b.repository, path), source + "\n");
    await assert.rejects(readShiftTicketDoBlocks(b.repository, manifest), { name: "ShiftTicketDigestMismatch" });
  } finally { b.close(); }
});

test("missing registration is never treated as an empty DO scan", async () => {
  const b = box();
  try {
    const manifest = sealShiftManifest({ plan: "missing", milestones: ["M1"], tickets: [{ id: "T01", path: "specs/tickets/missing/T01.md", digest: "a".repeat(64) }] });
    await assert.rejects(readShiftTicketDoBlocks(b.repository, manifest), /ENOENT/u);
    registerShiftPlan(b.repository, b.config.project.slug, "synthetic");
    await assert.rejects(readShiftTicketDoBlocks(b.repository, manifest), /ENOENT/u);
  } finally { b.close(); }
});

test("all selected tickets are scanned even when the first ticket only writes reachable paths", async () => {
  const b = box();
  try {
    const created = await draft(b, k1Request("run selected tickets", "core/src/example.ts"), "shift", true);
    const manifest = created.status.shift!;
    const first = join(b.repository, manifest.tickets[0]!.path);
    const source = readFileSync(first, "utf8").replace("specs/synthetic.html", "core/src/example.ts");
    writeFileSync(first, source);
    const path = "specs/tickets/synthetic/T02.md";
    mkdirSync(dirname(join(b.repository, path)), { recursive: true });
    const second = source.replaceAll("T01", "T02").replace("core/src/example.ts", "specs/synthetic.html");
    writeFileSync(join(b.repository, path), second);
    commit(b.repository);
    const selection = sealShiftManifest({ ...manifest, tickets: [
      { ...manifest.tickets[0]!, digest: ticketFileDigest(Buffer.from(source)) },
      { id: "T02", path, digest: ticketFileDigest(Buffer.from(second)) },
    ] });
    const tickets = await readShiftTicketDoBlocks(b.repository, selection);
    const verdict = evaluateWriteBoundary({ request: created.status.request, where: ["core/src/example.ts"], read: [], protectedPaths: [],
      writers: [{ phase: "builder", writes: ["core/src/**"] }], shift: { builderWrites: ["core/src/**"], tickets } });
    assert.equal(verdict.passed, false);
    if (!verdict.passed) assert.match(verdict.reason, /ticket T02 DO token specs\/synthetic.html/u);
  } finally { b.close(); }
});
