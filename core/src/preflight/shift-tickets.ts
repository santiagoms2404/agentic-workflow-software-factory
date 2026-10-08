import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ShiftManifest } from "../contracts/shift-selection-record.ts";
import { parsePlanTicketBody, ticketFileDigest } from "../persistence/plan-ticket-body.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { IMPLEMENTED_PLAN_FORMATS, UnsupportedPlanFormatError } from "../registry/plan-source.ts";
import { ShiftTicketDigestMismatch } from "../workflow/shift/compile.ts";
import type { ShiftFacts } from "./fields.ts";

/** Only a standalone DO heading and its indented body. Never scan other sections. */
export function ticketDoBlock(prompt: string): string {
  const rows = prompt.split(/\r?\n/u);
  const start = rows.findIndex(row => row === "DO");
  if (start === -1) return "";
  let end = start + 1;
  while (end < rows.length && (rows[end]!.trim() === "" || /^\s/u.test(rows[end]!))) end++;
  return rows.slice(start + 1, end).join("\n");
}

/**
 * The selection is repository-local (its sealed paths already bind that
 * repository). Resolve its store from the catalog's declared plans.root, not
 * from a ticket's directory or prose. Missing registration or changed bytes
 * is an error, never a silently empty scan. The compiler also checks digests.
 */
export async function readShiftTicketDoBlocks(repository: string, manifest: ShiftManifest): Promise<ShiftFacts["tickets"]> {
  const catalog = loadCatalog(await readFile(join(repository, "awsf.project.yaml"), "utf8"));
  if (!(IMPLEMENTED_PLAN_FORMATS as readonly string[]).includes(catalog.plans.format)) {
    throw new UnsupportedPlanFormatError(catalog.plans.format, manifest.plan);
  }
  const root = resolve(repository, catalog.plans.root);
  await readFile(join(root, `${manifest.plan}.html`), "utf8");
  const tickets = [];
  for (const ticket of manifest.tickets) {
    const registered = join(root, "tickets", manifest.plan, `${ticket.id}.md`);
    if (resolve(repository, ticket.path) !== registered || await realpath(registered) !== registered) {
      throw new Error(`ticket ${ticket.id} at ${ticket.path} is not in registered plan ${manifest.plan}'s ticket set`);
    }
    const bytes = await readFile(registered);
    const actual = ticketFileDigest(bytes);
    if (actual !== ticket.digest) throw new ShiftTicketDigestMismatch(ticket.id, ticket.digest, actual);
    tickets.push({ id: ticket.id, doBlock: ticketDoBlock(parsePlanTicketBody(bytes.toString("utf8"), ticket.id).text) });
  }
  return tickets;
}
