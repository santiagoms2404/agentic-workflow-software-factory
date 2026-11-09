import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { ClosureRecord } from "../../../src/contracts/closure-record.ts";
import { sealShiftManifest } from "../../../src/contracts/shift-selection-record.ts";
import { closeArgv, closureReadout, unclosedLandings, type LandingClosureFact } from "../../../src/closure/model.ts";

const CANDIDATE = "c".repeat(40);
const ticket = (id: string, digit: string) => ({ id, path: `specs/tickets/synthetic/${id}.md`, digest: digit.repeat(64) });

// closureReadout reads only the sealed selection and the landed candidate; the rest of the projection is irrelevant here.
const shiftStatus = { candidateSha: CANDIDATE, ticketSelection: null,
  shift: sealShiftManifest({ plan: "synthetic", milestones: ["M1"], tickets: [ticket("T01", "1"), ticket("T02", "2")] }),
} as unknown as AttemptStatus;

/** The shape closeCommand writes for a shift: closable tickets in `tickets`, the unbuilt rest in `notClosable`. */
function closure(tickets: readonly string[], notClosable: readonly string[]): ClosureRecord {
  const row = (id: string) => ({ path: "specs/synthetic.html", ticket: id, taskNumber: 1, rowIndex: 0, oldValue: "[]", newValue: "[x]" });
  return { schema: "awsf.closure-record/v1", id: "partial-shift", plan: "synthetic", tickets: [...tickets],
    candidateSha: CANDIDATE, parentSha: CANDIDATE, commitSha: "d".repeat(40), rowsClosed: tickets.map(row), rowsLeftOpen: [],
    notClosable: [...notClosable], blobs: [], at: "2026-10-09T22:03:00Z" };
}

function landing(closureState: ReturnType<typeof closureReadout>): LandingClosureFact {
  return { project: "synthetic", taskId: "shift", attempt: 1, landedAt: "2026-10-09T22:02:57Z", hasSelection: true, closure: closureState };
}

test("a partial-shift closure whose tickets plus notClosable cover the sealed set reads as recorded, not as unclosed", () => {
  const record = closure(["T01"], ["T02"]);
  const readout = closureReadout(shiftStatus, [record]);
  assert.equal(readout.state, "open by the owner's choice");
  assert.equal(readout.record, record);
  assert.deepEqual(unclosedLandings([landing(readout)]), []);
});

test("the not-closable tickets stay visible as not closable rather than reading as closed", () => {
  const readout = closureReadout(shiftStatus, [closure(["T01"], ["T02"])]);
  assert.notEqual(readout.state, "closed");
  assert.deepEqual(readout.record?.tickets, ["T01"]);
  assert.deepEqual(readout.record?.notClosable, ["T02"]);
  assert.equal(closureReadout(shiftStatus, [closure(["T01", "T02"], [])]).state, "closed");
});

test("a record missing a sealed ticket from both tickets and notClosable still reads as not closed", () => {
  for (const record of [closure(["T01"], []), closure(["T01"], ["T03"]), closure([], ["T01"])]) {
    const readout = closureReadout(shiftStatus, [record]);
    assert.deepEqual(readout, { state: "not closed", record: null });
    const unclosed = unclosedLandings([landing(readout)]);
    assert.equal(unclosed.length, 1);
    assert.deepEqual(closeArgv(unclosed[0]!), ["awsf", "close", "shift", "--project", "synthetic", "--attempt", "1"]);
  }
});
