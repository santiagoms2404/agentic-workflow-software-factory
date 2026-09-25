import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { TICKET_WORKFLOWS } from "../../../src/contracts/ticket.ts";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

// W17: a ticket names its own route; a shift is the container that runs
// tickets, never a route a ticket may name. TICKET_WORKFLOWS stays narrow, and
// no ticket file anywhere in the checkout (plan tickets, legacy tickets and
// fixtures alike) declares `workflow: shift`.

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u;
const TICKET_ID = /^[TW]\d\d$/u;

/** A ticket's declared workflow, or null when the text is not a ticket or declares none. */
function ticketWorkflow(source: string): { id: string; workflow: unknown } | null {
  const split = FRONTMATTER.exec(source);
  if (split === null) return null;
  const document = parseDocument(split[1] ?? "");
  if (document.errors.length > 0) return null;
  const value = document.toJSON() as Record<string, unknown> | null;
  if (value === null || typeof value !== "object" || typeof value.id !== "string" || !TICKET_ID.test(value.id)) return null;
  return { id: value.id, workflow: value.workflow };
}

test("TICKET_WORKFLOWS does not contain shift", () => {
  assert.equal((TICKET_WORKFLOWS as readonly string[]).includes("shift"), false);
});

test("the detector sees a ticket that declares workflow: shift", () => {
  const offender = "---\nid: T01\ntitle: \"x\"\nmilestone: M1\nstate: todo\ndepends_on: []\nworkflow: shift\n---\n";
  assert.deepEqual(ticketWorkflow(offender), { id: "T01", workflow: "shift" });
});

test("no ticket anywhere in the checkout declares workflow: shift", () => {
  const offenders: string[] = [];
  let tickets = 0;
  for (const path of walkFiles(repoRoot(), [".md"])) {
    const ticket = ticketWorkflow(readFileSync(path, "utf8"));
    if (ticket === null) continue;
    tickets += 1;
    if (ticket.workflow === "shift") offenders.push(relRepo(path));
  }
  // Not vacuous: the walk must actually reach the committed ticket sets.
  assert.ok(tickets >= 300, `only ${tickets} ticket files were found; the walk is not reaching specs/tickets`);
  assert.deepEqual(offenders, [], "a ticket declares workflow: shift; a shift is the container, not a route");
});
