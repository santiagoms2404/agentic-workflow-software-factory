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
const TICKET_ID = /^[TW]\d+$/u;

/** A top-level scalar read from the frontmatter's own lines, for a block the YAML parser rejects. */
function lineField(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${key}:`));
  return line?.slice(key.length + 1).replace(/\s+#.*$/u, "").trim().replace(/^["']|["']$/gu, "");
}

/** A ticket's declared workflow, or null when the text is not a ticket or declares none. */
function ticketWorkflow(source: string): { id: string; workflow: unknown } | null {
  // A byte-order mark must not hide the frontmatter from the anchor.
  const split = FRONTMATTER.exec(source.replace(/^﻿/u, ""));
  if (split === null) return null;
  const frontmatter = split[1] ?? "";
  const document = parseDocument(frontmatter);
  // A YAML error (an unquoted colon in a title, for one) must not make a ticket invisible. Its own lines still name it.
  if (document.errors.length > 0) {
    const id = lineField(frontmatter, "id");
    if (id === undefined || !TICKET_ID.test(id)) return null;
    return { id, workflow: lineField(frontmatter, "workflow") };
  }
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

test("the detector still sees a shift ticket that a YAML error, a byte-order mark, or a short id would hide", () => {
  const unquotedColon = "---\nid: T01\ntitle: Fix: the thing\nmilestone: M1\nstate: todo\ndepends_on: []\nworkflow: shift\n---\n";
  assert.deepEqual(ticketWorkflow(unquotedColon), { id: "T01", workflow: "shift" });
  assert.deepEqual(ticketWorkflow("﻿---\nid: T01\nworkflow: shift\n---\n"), { id: "T01", workflow: "shift" });
  assert.deepEqual(ticketWorkflow("---\nid: T1\nworkflow: shift\n---\n"), { id: "T1", workflow: "shift" });
  assert.deepEqual(ticketWorkflow("---\nid: T100\nworkflow: shift\n---\n"), { id: "T100", workflow: "shift" });
  assert.equal(ticketWorkflow("---\ntitle: Fix: the thing\nworkflow: shift\n---\n"), null, "a block with no ticket id is not a ticket");
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
