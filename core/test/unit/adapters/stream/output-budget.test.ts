// The output budget: what a run may EMIT, and — more importantly — what it may
// never refuse to emit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  DEFAULT_MAX_EVENT_COUNT,
  DEFAULT_MAX_OUTPUT_BYTES,
  MIN_WELL_FORMED_EVENTS,
  OutputBudget,
  truncateToCodePoint,
} from "../../../../src/adapters/stream/output-budget.ts";
import { repoRoot } from "../../meta/_walk.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("the defaults are the committed config's, pinned so the two cannot drift apart", () => {
  // The loader that will pass these in does not exist yet (it is M5's). Until it
  // does, a default that quietly disagreed with `awsf.config.yaml` would be a
  // difference nobody could see.
  const config = parse(readFileSync(join(repoRoot(), "awsf.config.yaml"), "utf8")) as {
    runtime: { max_output_bytes: number; max_event_count: number };
  };
  assert.equal(config.runtime.max_output_bytes, DEFAULT_MAX_OUTPUT_BYTES);
  assert.equal(config.runtime.max_event_count, DEFAULT_MAX_EVENT_COUNT);
});

test("a budget must be a positive integer count in both dimensions", () => {
  assert.throws(() => new OutputBudget({ maxOutputBytes: 0 }), RangeError);
  assert.throws(() => new OutputBudget({ maxEventCount: -1 }), RangeError);
  assert.throws(() => new OutputBudget({ maxOutputBytes: 1.5 }), RangeError);
});

// ---------------------------------------------------------------------------
// truncateToCodePoint
// ---------------------------------------------------------------------------

test("no cut ever splits a code point, at any limit", () => {
  // Swept rather than sampled: the interesting limits are exactly the ones a
  // hand-picked case would miss.
  const text = "aé漢🙂z";
  const bytes = encoder.encode(text);
  for (let limit = -3; limit <= bytes.length + 3; limit += 1) {
    const cut = truncateToCodePoint(bytes, limit);
    const decoded = decoder.decode(cut);
    assert.ok(!decoded.includes("�"), `limit ${limit} produced a replacement character`);
    assert.ok(cut.length <= Math.max(limit, 0), `limit ${limit} returned ${cut.length} bytes`);
    assert.ok(text.startsWith(decoded), `limit ${limit} produced ${JSON.stringify(decoded)}`);
  }
});

test("a replacement character the PROVIDER sent is not mistaken for a split code point", () => {
  // The decision is made on the bytes, never on the decoded text — which is the
  // only way this case works at all.
  const text = "ok�ok";
  const bytes = encoder.encode(text);
  assert.equal(decoder.decode(truncateToCodePoint(bytes, bytes.length)), text);
});

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

test("text is fitted to the byte budget on a code point boundary, once and for all", () => {
  const budget = new OutputBudget({ maxOutputBytes: 6 });
  const first = budget.fitText("ab");
  assert.deepEqual(first, { text: "ab", bytes: 2, cut: false });
  budget.chargeText(first.bytes);

  // "🙂" is four bytes and only four remain — it fits exactly.
  const second = budget.fitText("🙂c");
  assert.equal(second.cut, true);
  assert.equal(second.text, "🙂");
  assert.equal(second.bytes, 4);
  budget.chargeText(second.bytes);
  assert.equal(budget.truncated, true);

  // One-way: pulling a cut back to a boundary can leave headroom, and a later
  // short delta slipping into it would arrive after a notice that reads as final.
  assert.deepEqual(budget.fitText("!"), { text: "", bytes: 0, cut: true });
});

test("a delta that cannot fit even one code point yields nothing rather than a broken one", () => {
  const budget = new OutputBudget({ maxOutputBytes: 2 });
  const fit = budget.fitText("🙂");
  assert.equal(fit.text, "");
  assert.equal(fit.bytes, 0);
  assert.equal(fit.cut, true);
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test("the event cap holds back a slot for the terminal and one for the notice", () => {
  const budget = new OutputBudget({ maxEventCount: 4 });
  // owed = 1 (terminal); reserve = 1 (notice). So two optional events fit.
  assert.equal(budget.offer(), true);
  assert.equal(budget.offer(), true);
  assert.equal(budget.offer(), false);
  assert.equal(budget.capped, true);
  assert.equal(budget.eventCount, 2);
});

test("a tool call reserves its settlement BEFORE its request is offered a slot", () => {
  // A request the budget admits must be a request whose settlement will also
  // fit — an unpaired `tool.completed` is a violation the host caused itself.
  const budget = new OutputBudget({ maxEventCount: 4 });
  budget.oblige();
  assert.equal(budget.owed, 2, "one terminal plus one settlement");
  assert.equal(budget.offer(), true); // the request
  assert.equal(budget.offer(), false); // nothing else fits behind it
  budget.spend(); // the settlement, which is never refused
  budget.discharge();
  assert.equal(budget.owed, 1);
});

test("mandatory events are charged and never refused, even past the cap", () => {
  // The rule the whole file exists for: terminals stay observable.
  const budget = new OutputBudget({ maxEventCount: 2 });
  budget.spend(); // run.started
  assert.equal(budget.offer(), false, "no optional event fits");
  budget.spend(); // the terminal
  budget.spend(); // a settlement it was owed
  assert.equal(budget.eventCount, 3, "the budget overran rather than dropping a terminal");
});

test("the truncation notice is announced exactly once per run", () => {
  const budget = new OutputBudget({ maxEventCount: 4, maxOutputBytes: 1 });
  budget.fitText("too long");
  const first = budget.claimNotice();
  assert.equal(first?.dimension, "bytes");
  assert.match(first?.message ?? "", /byte budget/);
  assert.equal(budget.claimNotice(), null);

  // The second dimension trips later; the run still carries one notice.
  while (budget.offer()) {
    /* spend the cap */
  }
  assert.equal(budget.capped, true);
  assert.equal(budget.claimNotice(), null, "a run gets one truncation notice, not one per dimension");
});

test("the event-cap notice names its own dimension", () => {
  const budget = new OutputBudget({ maxEventCount: 3 });
  while (budget.offer()) {
    /* spend the cap */
  }
  const notice = budget.claimNotice();
  assert.equal(notice?.dimension, "events");
  assert.match(notice?.detail ?? "", /max_event_count 3/);
});

test("at the floor budget the notice is suppressed rather than overrunning the cap", () => {
  // `run.started` and one terminal consume the whole of a two-event cap. The cap
  // wins: truncation goes unannounced rather than spending a slot that is not
  // there. A suppressed notice is not retried on the next event either.
  const budget = new OutputBudget({ maxEventCount: MIN_WELL_FORMED_EVENTS });
  budget.spend(); // run.started
  assert.equal(budget.offer(), false);
  assert.equal(budget.claimNotice(), null);
  assert.equal(budget.claimNotice(), null);
  assert.equal(budget.eventCount, 1, "nothing was charged for a notice that was never emitted");
});

test("a cap too small to hold a well-formed stream says so instead of pretending", () => {
  assert.equal(new OutputBudget({ maxEventCount: 1 }).unsatisfiable, true);
  assert.equal(new OutputBudget({ maxEventCount: MIN_WELL_FORMED_EVENTS }).unsatisfiable, false);
});

test("discharging more settlements than were obliged never drives the reserve negative", () => {
  const budget = new OutputBudget();
  budget.discharge();
  budget.discharge();
  assert.equal(budget.owed, 1, "the terminal is still owed, and nothing else is");
});
