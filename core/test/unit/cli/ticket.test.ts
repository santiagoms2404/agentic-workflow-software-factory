import assert from "node:assert/strict";
import { test } from "node:test";
import { intakeRequest, listTickets, showTicket } from "../../../src/cli/commands/ticket.ts";
import { TicketStore } from "../../../src/persistence/ticket-store.ts";

test("ticket list and show read the file-backed store", async () => {
  const store = new TicketStore("specs/tickets");
  const listed = await listTickets(store);
  assert.ok(listed.some((line) => line.startsWith("T32\t")));
  const shown = await showTicket(store, "T32");
  assert.match(shown.join("\n"), /The intake recipe and awsf ticket/);
});

test("ticket new and refine requests pin the id and refinement includes the validated prior ticket", async () => {
  assert.match(intakeRequest("new", "T37", "add bounded work intake"), /^Create ticket T37\./);
  const existing = (await new TicketStore("specs/tickets").load()).find((record) => record.ticket?.id === "T32");
  assert.ok(existing);
  const request = intakeRequest("refine", "T32", "make acceptance observable", existing);
  assert.match(request, /Refine ticket T32 without changing its id/);
  assert.match(request, /"acceptance"/);
  assert.throws(() => intakeRequest("new", "T1", "bad id"), /zero-padded/);
});
