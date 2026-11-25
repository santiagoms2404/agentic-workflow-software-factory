import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGit, systemGitByteRunner, systemGitRunner } from "../git/changes.ts";
import { ticketFileDigest } from "./plan-ticket-body.ts";

interface TicketFile {
  readonly id: string;
  readonly path: string;
  readonly digest: string | null;
}

export class TicketFileMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketFileMismatch";
  }
}

/** Compare exact file bytes, not decoded text or Git's filtered checkout view. */
export function assertTicketFileDigest(ticket: TicketFile, bytes: Uint8Array | null,
  mismatch = (_actual: string): Error => new TicketFileMismatch(
    `ticket ${ticket.id} at ${ticket.path} changed since selection (file missing or bytes differ)`),
): string {
  // No SHA-256 digest is empty; a missing file cannot match a sealed digest.
  const actual = bytes === null ? "" : ticketFileDigest(bytes);
  // trap-refusal-begin TR-22
  if (actual !== ticket.digest) throw mismatch(actual);
  // trap-refusal-end TR-22
  return actual;
}

/** Seal only bytes present at the same path in HEAD and still tracked in the index. */
export function committedTicketDigest(repository: string, id: string, path: string, bytes: Uint8Array): string {
  const blob = systemGitByteRunner(repository)(["cat-file", "blob", `HEAD:${path}`]);
  // A staged removal can leave an untracked file whose bytes still equal HEAD.
  const tracked = blob.status === 0 && runGit(systemGitRunner(repository), ["--literal-pathspecs", "ls-files", "-z", "--", path]).split("\0").includes(path);
  return assertTicketFileDigest({ id, path, digest: tracked ? ticketFileDigest(blob.stdout) : null }, bytes, () => new TicketFileMismatch(
    `ticket ${id} at ${path} cannot be sealed: ${tracked ? "checkout bytes differ from HEAD" : "untracked or missing from HEAD"}`));
}

export async function assertSelectedTicketFiles(repository: string, tickets: readonly (TicketFile & { readonly digest: string })[]): Promise<void> {
  for (const ticket of tickets) {
    const bytes = await readFile(resolve(repository, ticket.path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return null;
    });
    assertTicketFileDigest(ticket, bytes);
  }
}
