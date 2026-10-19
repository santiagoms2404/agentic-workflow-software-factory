import { test } from "node:test";
import assert from "node:assert/strict";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../../src/persistence/plan-ticket-body.ts";
import { bindShiftRecipeAt } from "../../../src/workflow/shift/bind.ts";
import {
  compileShift,
  serializeShiftRecipe,
  ShiftCompileRefusal,
  ShiftTicketDigestMismatch,
  ShiftTicketUnreadable,
  type ShiftBriefPhase,
  type ShiftRecipe,
} from "../../../src/workflow/shift/compile.ts";

const CONFIG = { prompts: { builder: "Build the ticket", reviewer: "Review the shift" } };

function source(prompt: string, title = "Preserve the ticket words", handoff = "Keep the original words."): string {
  return [
    "---", "id: T01", `title: ${JSON.stringify(title)}`, "milestone: M1",
    "state: todo", "depends_on: []", "---", "# Ticket", "",
    "## Handoff", "", handoff, "",
    "## Build prompt", "", "```", prompt, "```", "",
  ].join("\n");
}

function fixture(bytes: Uint8Array) {
  const manifest = sealShiftManifest({
    plan: "fixture-shift", milestones: ["M1"],
    tickets: [{ id: "T01", path: "T01.md", digest: ticketFileDigest(bytes) }],
  });
  return { manifest, bodies: new Map([["T01", bytes]]) };
}

function malformed(sequence: readonly number[]): Buffer {
  const [before, after] = source("Build Caf@ without changing its spelling.").split("@");
  return Buffer.concat([Buffer.from(before!), Buffer.from(sequence), Buffer.from(after!)]);
}

function invalidUtf8(error: unknown): boolean {
  assert.ok(error instanceof ShiftCompileRefusal);
  assert.ok(error instanceof ShiftTicketUnreadable);
  assert.equal(error.name, "ShiftTicketUnreadable");
  assert.equal(error.ticket, "T01");
  assert.equal(error.message, "ticket T01 cannot be compiled: its bytes are not valid UTF-8");
  return true;
}

test("B6-07: a sealed Windows-1252 accent is refused instead of compiling replacement text", () => {
  const bytes = malformed([0xe9]);
  const { manifest, bodies } = fixture(bytes);
  assert.equal(manifest.tickets[0]!.digest, ticketFileDigest(bytes));
  assert.notEqual(ticketFileDigest(Buffer.from(bytes.toString("utf8"))), manifest.tickets[0]!.digest);
  assert.throws(() => compileShift(manifest, bodies, CONFIG), invalidUtf8,
    "sealed invalid UTF-8 must refuse before producing a lossy brief");
});

for (const [label, sequence] of [
  ["isolated continuation", [0x80]],
  ["overlong encoding", [0xc0, 0xaf]],
  ["interrupted multibyte sequence", [0xe2, 0x28, 0xa1]],
  ["encoded surrogate", [0xed, 0xa0, 0x80]],
  ["code point beyond Unicode", [0xf4, 0x90, 0x80, 0x80]],
  ["illegal leading byte", [0xff]],
] as const) {
  test(`B6-07: refuses ${label} with a matching raw digest`, () => {
    const { manifest, bodies } = fixture(malformed(sequence));
    assert.throws(() => compileShift(manifest, bodies, CONFIG), invalidUtf8);
  });
}

test("B6-07: refuses an unfinished sequence at EOF, including bytes outside the prompt", () => {
  const bytes = Buffer.concat([Buffer.from(source("Build the widget.")), Buffer.from([0xf0, 0x9f])]);
  const { manifest, bodies } = fixture(bytes);
  assert.throws(() => compileShift(manifest, bodies, CONFIG), invalidUtf8);
});

for (const section of ["title", "handoff"] as const) {
  test(`B6-07: refuses malformed bytes in the ${section} before parsing`, () => {
    const text = source("Build the widget.", section === "title" ? "Caf@" : undefined,
      section === "handoff" ? "Keep Caf@." : undefined);
    const [before, after] = text.split("@");
    const bytes = Buffer.concat([Buffer.from(before!), Buffer.from([0xe9]), Buffer.from(after!)]);
    const { manifest, bodies } = fixture(bytes);
    assert.throws(() => compileShift(manifest, bodies, CONFIG), invalidUtf8);
  });
}

for (const words of ["ASCII words", "Café", "東京", "🧭", "e\u0301", "literal \ufffd", "inner \ufeff mark"]) {
  test(`B6-07: preserves valid Unicode verbatim: ${JSON.stringify(words)}`, () => {
    const prompt = `Build ${words} without normalization.`;
    const title = `Preserve ${words}`;
    const handoff = `Keep ${words} exactly.`;
    const bytes = Buffer.from(source(prompt, title, handoff));
    const original = Buffer.from(bytes);
    const { manifest, bodies } = fixture(bytes);
    const recipe = compileShift(manifest, bodies, CONFIG);
    const brief = recipe.phases[0] as ShiftBriefPhase;
    assert.equal(brief.intent.summary, `T01: ${title}`);
    assert.equal(brief.intent.goals[0], prompt);
    assert.equal(brief.intent.notesForNextPhase,
      `Handoff for T01, written after its build prompt. Where the two disagree, this wins:\n\n${handoff}`);
    assert.equal(recipe.manifestDigest, manifest.manifestDigest);
    assert.equal(ticketFileDigest(bytes), manifest.tickets[0]!.digest);
    assert.deepEqual(bytes, original);
    assert.equal(serializeShiftRecipe(compileShift(manifest, bodies, CONFIG)), serializeShiftRecipe(recipe));
  });
}

test("B6-07: a changed digest still refuses before decoding malformed bytes", () => {
  const { manifest } = fixture(Buffer.from(source("Build the widget.")));
  const bytes = malformed([0xff]);
  assert.throws(() => compileShift(manifest, new Map([["T01", bytes]]), CONFIG),
    (error: unknown) => {
      assert.ok(error instanceof ShiftTicketDigestMismatch);
      assert.equal(error.ticket, "T01");
      assert.equal(error.expected, manifest.tickets[0]!.digest);
      assert.equal(error.actual, ticketFileDigest(bytes));
      return true;
    });
});

test("B6-07: a leading UTF-8 BOM remains visible and refuses as invalid frontmatter", () => {
  const bytes = Buffer.from(`\ufeff${source("Build the widget.")}`);
  const { manifest, bodies } = fixture(bytes);
  assert.throws(() => compileShift(manifest, bodies, CONFIG), {
    name: "ShiftTicketUnreadable", ticket: "T01",
    message: "ticket T01 cannot be compiled: its frontmatter is missing or invalid",
  });
});

test("B6-07: removing a sealed BOM does not bypass the raw-byte digest", () => {
  const bytes = Buffer.from(`\ufeff${source("Build the widget.")}`);
  const { manifest } = fixture(bytes);
  assert.throws(() => compileShift(manifest, new Map([["T01", bytes.subarray(3)]]), CONFIG),
    ShiftTicketDigestMismatch);
});

test("B6-07: valid Unicode rebuilds identically through the recorded-base text boundary", () => {
  const text = source("Build Café 東京 🧭 e\u0301 \ufffd.", "Preserve Café", "Keep 東京.");
  const { manifest, bodies } = fixture(Buffer.from(text));
  const base = "a".repeat(40);
  let calls = 0;
  const rebuilt = bindShiftRecipeAt("/unused", manifest, base, CONFIG, (args) => {
    calls++;
    assert.deepEqual(args, ["cat-file", "blob", `${base}:T01.md`]);
    return { status: 0, stdout: text, stderr: "", error: null };
  });
  assert.equal(calls, 1);
  assert.equal(serializeShiftRecipe(rebuilt as ShiftRecipe), serializeShiftRecipe(compileShift(manifest, bodies, CONFIG)));
});

test("B6-07: malformed bytes refuse both direct compilation and the lossy recorded-base rebuild", () => {
  const bytes = malformed([0xe9]);
  const { manifest, bodies } = fixture(bytes);
  assert.throws(() => compileShift(manifest, bodies, CONFIG), invalidUtf8);
  assert.throws(() => bindShiftRecipeAt("/unused", manifest, "a".repeat(40), CONFIG,
    () => ({ status: 0, stdout: bytes.toString("utf8"), stderr: "", error: null })), ShiftTicketDigestMismatch);
  // The shared decoder must recover after a fatal decode; a later valid ticket stays valid.
  const valid = fixture(Buffer.from(source("Build Café.")));
  const brief = compileShift(valid.manifest, valid.bodies, CONFIG).phases[0] as ShiftBriefPhase;
  assert.equal(brief.intent.goals[0], "Build Café.");
});
