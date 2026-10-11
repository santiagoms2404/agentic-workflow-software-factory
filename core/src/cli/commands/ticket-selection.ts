import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { parseStoredTicket, TicketStore } from "../../persistence/ticket-store.ts";
import { lightTicketAgreement } from "../../registry/plan-agreement.ts";
import { sealTicketSelection, type TicketSelection } from "../../contracts/ticket-selection-record.ts";
import { ticketFileDigest } from "../../persistence/plan-ticket-body.ts";
import { parsePlanTicketData } from "../../persistence/plan-tickets.ts";
import { loadCatalog } from "../../registry/catalog.ts";
import { readPlacement } from "../../registry/placement.ts";
import { resolvePlanSources } from "../../registry/plan-source.ts";
import type { ResolvePlanRefOptions } from "./plan-ref.ts";

/** Comma-separated and repeatable, preserving the owner's order and refusing empty ids. */
export function parseTicketSelection(values: readonly string[]): readonly string[] {
  const ids = values.flatMap(value => value.split(",").map(id => id.trim()));
  if (ids.length === 0 || ids.some(id => !/^[TW]\d\d$/u.test(id))) {
    throw new Error("--ticket requires one or more ticket ids (Tnn or Wnn)");
  }
  if (new Set(ids).size !== ids.length) throw new Error("--ticket contains a duplicate ticket id");
  return ids;
}

/** The flat store is directly below the catalog's plans root, never a paired directory. */
export async function lightTicketStore(repository: string): Promise<TicketStore> {
  const catalog = loadCatalog(await readFile(resolve(repository, "awsf.project.yaml"), "utf8"));
  const root = catalog.plans.root;
  if (root.startsWith("/") || root.includes("\\") || root.split("/").some(part => part === "." || part === "..")) {
    throw new Error("light tickets require a plans root inside the repository");
  }
  return new TicketStore(resolve(repository, root, "tickets"));
}

export async function sealLightTicketSelection(repository: string, values: readonly string[]): Promise<TicketSelection> {
  const ids = parseTicketSelection(values);
  if (ids.length !== 1 || !/^T\d\d$/u.test(ids[0]!)) throw new Error("--ticket without --plan requires exactly one flat light ticket (Tnn)");
  const store = await lightTicketStore(repository);
  const records = await store.load();
  const violations = lightTicketAgreement(records);
  if (violations.length > 0) throw new Error(`light ticket agreement: ${violations.map(row => row.message).join("; ")}`);
  const absolute = resolve(store.directory, `${ids[0]}.md`);
  let bytes: Buffer;
  try { bytes = await readFile(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`--ticket ${ids[0]} is not a flat light ticket in the plans root's ticket store`);
  }
  const record = parseStoredTicket(bytes.toString("utf8"), absolute);
  if (record.ticket === null || record.ticket.id !== ids[0]) throw new Error(`--ticket ${ids[0]} is not a valid flat light ticket`);
  return sealTicketSelection({ plan: null, tickets: [{ id: record.ticket.id,
    path: relative(repository, absolute).split(sep).join("/"), digest: ticketFileDigest(bytes),
    tier: record.ticket.tier, workflow: record.ticket.workflow }] });
}

/** Resolve through the catalog, read each selected file once, and seal those exact bytes. */
export async function sealPlanTicketSelection(options: ResolvePlanRefOptions, values: readonly string[]): Promise<TicketSelection> {
  const ids = parseTicketSelection(values);
  const catalogPath = resolve(options.repository, "awsf.project.yaml");
  const catalog = loadCatalog(await readFile(catalogPath, "utf8"));
  let sources = resolvePlanSources(catalogPath, catalog);
  if (sources.length === 0) sources = resolvePlanSources(catalogPath, catalog, await readPlacement(options.stateRoot, options.project));
  const source = sources.find(source => basename(source.planPath, ".html") === options.stem);
  if (source === undefined) throw new Error(`--ticket: no registered ticket set for ${options.stem}`);
  const tickets = [];
  for (const id of ids) {
    const absolute = resolve(source.ticketsPath, `${id}.md`);
    let bytes: Buffer;
    try { bytes = await readFile(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new Error(`--ticket ${id} is outside the registered ticket set for ${options.stem}`);
    }
    const ticket = parsePlanTicketData(bytes.toString("utf8"));
    if (ticket?.id !== id) throw new Error(`--ticket ${id} is not a valid registered ticket for ${options.stem}`);
    tickets.push({ id, path: relative(options.repository, absolute).split(sep).join("/"), digest: ticketFileDigest(bytes),
      ...(ticket.tier === undefined ? {} : { tier: ticket.tier }),
      ...(ticket.workflow === undefined ? {} : { workflow: ticket.workflow }) });
  }
  return sealTicketSelection({ plan: options.stem, tickets });
}
