import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { parseDocument, stringify } from "yaml";
import { TicketSchema, type Ticket } from "../contracts/ticket.ts";
import { lightTicketCycle } from "../registry/plan-agreement.ts";

export interface TicketViolation {
  path: string;
  message: string;
}

/** A file is returned even when its frontmatter cannot become a Ticket. */
export interface StoredTicket {
  path: string;
  body: string;
  frontmatter: unknown;
  ticket: Ticket | null;
  violations: TicketViolation[];
}

export class TicketValidationError extends Error {
  readonly code = "E_TICKET_INVALID";
  readonly violations: readonly TicketViolation[];
  constructor(violations: readonly TicketViolation[]) {
    super(`ticket is invalid: ${violations.map((violation) => violation.message).join("; ")}`);
    this.name = "TicketValidationError";
    this.violations = violations;
  }
}

export class TicketDependencyCycleError extends Error {
  readonly code = "E_TICKET_DEPENDENCY_CYCLE";
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`ticket dependency cycle: ${cycle.join(" -> ")}`);
    this.name = "TicketDependencyCycleError";
    this.cycle = cycle;
  }
}

function violationsFor(value: unknown): TicketViolation[] {
  return [...Value.Errors(TicketSchema, value)].map((error) => ({
    path: error.path || "/",
    message: error.message,
  }));
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (match === null) return null;
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function rejectCycles(records: readonly StoredTicket[]): void {
  const cycle = lightTicketCycle(records.flatMap(record => record.ticket === null ? [] : [record.ticket]));
  if (cycle !== null) throw new TicketDependencyCycleError(cycle);
}

/**
 * The ticket directory is the store. Each operation reads or writes its .md
 * file directly; there is intentionally no database, cache, or index.
 */
export class TicketStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async load(): Promise<StoredTicket[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const records = await Promise.all(
      names
        .filter((name) => /^T\d\d\.md$/.test(name))
        .sort()
        .map((name) => this.readPath(join(this.directory, name))),
    );
    rejectCycles(records);
    return records;
  }

  async write(ticket: Ticket, body: string): Promise<void> {
    const violations = violationsFor(ticket);
    if (violations.length > 0) throw new TicketValidationError(violations);
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${ticket.id}.md`);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `---\n${stringify(ticket)}---\n${body}`);
    await rename(temporary, path);
  }

  private async readPath(path: string): Promise<StoredTicket> {
    return parseStoredTicket(await readFile(path, "utf8"), path);
  }
}

/** Parse the exact bytes a selector seals, rather than re-reading the file. */
export function parseStoredTicket(source: string, path: string): StoredTicket {
    const split = splitFrontmatter(source);
    if (split === null) {
      return {
        path,
        body: source,
        frontmatter: null,
        ticket: null,
        violations: [{ path: "/", message: "missing YAML frontmatter" }],
      };
    }

    const document = parseDocument(split.frontmatter);
    if (document.errors.length > 0) {
      return {
        path,
        body: split.body,
        frontmatter: null,
        ticket: null,
        violations: document.errors.map((error) => ({ path: "/", message: error.message })),
      };
    }
    const frontmatter = document.toJSON();
    const violations = violationsFor(frontmatter);
    return {
      path,
      body: split.body,
      frontmatter,
      ticket: violations.length === 0 ? (frontmatter as Ticket) : null,
      violations,
    };
}
