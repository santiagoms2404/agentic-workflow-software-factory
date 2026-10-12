import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { PlanAuthorOutputSchema, PLAN_AUTHOR_DOCUMENT_MAX_BYTES, PLAN_AUTHOR_ENVELOPE_MAX_BYTES, PLAN_AUTHOR_TABLE_MAX_BYTES, type PlanAuthorOutput } from "../contracts/plan-author-output.ts";
import { planAdmissionDocuments, PlanAdmissionRefused, type PlanAdmissionInput } from "../registry/plan-admission.ts";

function refuse(detail: string): never { throw new PlanAdmissionRefused(detail); }

/** A fixed basename, no redirected ancestor, link, executable, or oversized input. */
function privateFile(runtime: string, name: string, maximum: number): string {
  const path = join(runtime, name);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o111) !== 0 || stat.size === 0 || stat.size > maximum) refuse(`${name}: invalid private document or size`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1 || opened.size !== stat.size) refuse(`${name}: private document replaced`);
    // Bounded even if a concurrent writer grows this inode after the stat.
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size !== opened.size || size > maximum) refuse(`${name}: private document size changed`);
    const bytes = buffer.subarray(0, size);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) refuse(`${name}: invalid UTF-8`);
    return text;
  } finally { closeSync(fd); }
}

/** Only the host supplies runtime; no model path can redirect admission. Reads, never writes. */
export function readPlanAuthorInput(runtimeDirectory: string, output: PlanAuthorOutput): PlanAdmissionInput {
  if (!Value.Check(PlanAuthorOutputSchema, output) || output.producerStatus !== "success" || output.artifacts.length !== 0 ||
      Buffer.byteLength(JSON.stringify(output), "utf8") > PLAN_AUTHOR_ENVELOPE_MAX_BYTES) refuse("invalid author envelope (64 KiB maximum, no repository artifacts)");
  const runtime = resolve(runtimeDirectory);
  if (realpathSync(runtime) !== runtime || !lstatSync(runtime).isDirectory()) refuse("private output root is redirected");
  const planHtml = privateFile(runtime, output.runtimeFiles.plan, PLAN_AUTHOR_DOCUMENT_MAX_BYTES);
  const buildPrompts = privateFile(runtime, output.runtimeFiles.buildPrompts, PLAN_AUTHOR_DOCUMENT_MAX_BYTES);
  let tickets: unknown;
  try { tickets = JSON.parse(privateFile(runtime, output.runtimeFiles.tickets, PLAN_AUTHOR_TABLE_MAX_BYTES)); }
  catch (error) { if (error instanceof PlanAdmissionRefused) throw error; refuse("tickets.json must be a frontmatter array"); }
  if (!Array.isArray(tickets)) refuse("tickets.json must be a frontmatter array");
  const input: PlanAdmissionInput = { stem: output.stem, planHtml, buildPrompts, tickets };
  planAdmissionDocuments(input);
  return input;
}
