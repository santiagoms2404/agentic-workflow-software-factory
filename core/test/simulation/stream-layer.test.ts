// The stream layer against a real provider process.
//
// The unit suites drive the three stages with chunks a test chose. This one
// drives them with chunks the KERNEL chose, out of a real pipe, from a real
// detached process group that a real cancellation ends underneath the reader.
//
// The invariant under test is the one that only breaks in the live case: a
// consumer iterating `parse` while the tree is terminated must still receive
// exactly one terminal event. A stream that just stops there is the same silent
// failure as a ghost process — the run would sit un-settled forever with nothing
// to explain why.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunning, startStubRun } from "./_live-run.ts";
import { within } from "./_barrier-fixtures.ts";
import {
  isTerminalKind,
  validateEventSequence,
  type NormalizedEvent,
} from "../../src/contracts/normalized-events.ts";

test("a run cancelled while its stream is being read still delivers exactly one terminal", async () => {
  const run = await startStubRun("timeout");
  const events: NormalizedEvent[] = [];
  const cancelling = new AbortController();
  try {
    const reading = (async () => {
      for await (const event of run.adapter.parse(run.transport, cancelling.signal)) events.push(event);
    })();

    // Wait until the provider is genuinely talking, so the cancellation lands in
    // the middle of a stream rather than before one exists.
    const talking = await within(5_000, () => events.some((event) => event.kind === "text.delta"));
    assert.equal(talking, true, "the `timeout` script should be noisy");

    // The order a host cancels in: say so, then end the tree. The signal is what
    // carries the intent across to the parser, because killing a process group
    // closes its pipes cleanly and EOF alone says nothing about why.
    cancelling.abort("the suite cancelled a live stream");
    const report = await run.transport.cancel("the suite cancelled a live stream");
    assert.equal(report.terminated, true);
    await reading;

    const terminals = events.filter((event) => isTerminalKind(event.kind));
    assert.equal(terminals.length, 1, `exactly one terminal, got ${terminals.map((e) => e.kind).join(", ")}`);
    assert.equal(terminals[0]?.kind, "run.cancelled");
    assert.match(
      terminals[0]?.kind === "run.cancelled" ? terminals[0].reason : "",
      /the suite cancelled a live stream/,
    );
    assert.equal(terminals[0], events[events.length - 1], "and it is the last event of the run");
    assert.deepEqual(validateEventSequence(events), []);
    assert.equal(isRunning(run.transport.identity.pid), false);
  } finally {
    await run.end();
  }
});

test("a provider killed mid-line loses no bytes: the half-written tail is a visible line", async () => {
  // `malformed` writes a truncated JSON object and a bare line, then exits. Both
  // have to survive as notices — a parser that dropped what it could not read
  // would erase the only evidence of what the provider was doing.
  const run = await startStubRun("malformed");
  try {
    const events: NormalizedEvent[] = [];
    for await (const event of run.adapter.parse(run.transport)) events.push(event);

    const notices = events.filter((event) => event.kind === "notice");
    assert.equal(notices.length, 2, `both unreadable lines are carried: ${JSON.stringify(notices)}`);
    for (const notice of notices) {
      assert.equal(notice.kind === "notice" && notice.code, "non-json-output");
    }
    assert.ok(
      notices.some((notice) => notice.kind === "notice" && (notice.detail ?? "").includes("half a re")),
      "the truncated object is visible in the trace",
    );

    // No terminal line was ever written, so the run failed — it did not quietly
    // succeed on the strength of an exit code.
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.failed");
    assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_TERMINAL_MISSING");
    assert.deepEqual(validateEventSequence(events), []);
  } finally {
    await run.end();
  }
});

test("a real pipe's chunk boundaries do not change the run", async () => {
  // The kernel splits where it likes. The framer's per-instance decoder is what
  // makes the result independent of that, and this is the case where the
  // splitting is not simulated.
  const run = await startStubRun("success");
  try {
    const events: NormalizedEvent[] = [];
    for await (const event of run.adapter.parse(run.transport)) events.push(event);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["run.started", "model.resolved", "text.delta", "run.completed"],
    );
    const resolved = events[1];
    assert.equal(resolved?.kind === "model.resolved" && resolved.provenance, "stream-authoritative");
    assert.deepEqual(validateEventSequence(events), []);
  } finally {
    await run.end();
  }
});
