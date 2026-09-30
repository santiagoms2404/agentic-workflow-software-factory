// Read-only ticket metadata for metrics. The projection has no shift manifest
// column: status supplies the sealed selection and recorded base. Read its
// ticket blobs at that base, not today's checkout (owner bookkeeping changes
// whole-file digests). Nothing here selects or changes a runner route.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ShiftManifestSchema, shiftManifestDigest, type ShiftManifest } from "../contracts/shift-selection-record.ts";
import type { TicketTaskClass } from "../contracts/ticket.ts";
import { systemGitRunner, type GitRunner } from "../git/changes.ts";
import { parsePlanTicketData } from "../persistence/plan-tickets.ts";
import { shiftTicketOf, shiftPhaseRole } from "../workflow/shift/bind.ts";
import { compileShift } from "../workflow/shift/compile.ts";

export interface ShiftClassSource {
  readonly repository: string;
  readonly baseSha: string | null;
  readonly shift: ShiftManifest;
}

/** Keys are compiled phase keys, never guessed from a build phase's name. */
export function shiftTaskClasses(source: ShiftClassSource, runner?: GitRunner): ReadonlyMap<string, TicketTaskClass> {
  if (!Value.Check(ShiftManifestSchema, source.shift) || shiftManifestDigest(source.shift) !== source.shift.manifestDigest) {
    throw new Error("invalid sealed selection");
  }
  const bodies = new Map<string, Uint8Array>();
  const classes = new Map<string, TicketTaskClass>();
  const git = runner ?? systemGitRunner(source.repository);
  for (const ticket of source.shift.tickets) {
    let bytes: Uint8Array;
    if (source.baseSha === null) {
      bytes = readFileSync(join(source.repository, ticket.path));
    } else {
      if (!/^[a-f0-9]{40}$/u.test(source.baseSha)) throw new Error("invalid recorded base");
      const blob = git(["cat-file", "blob", `${source.baseSha}:${ticket.path}`]);
      if (blob.status !== 0) throw new Error("unavailable recorded ticket blob");
      bytes = Buffer.from(blob.stdout, "utf8");
    }
    bodies.set(ticket.id, bytes);
    const data = parsePlanTicketData(Buffer.from(bytes).toString("utf8"));
    if (data?.id === ticket.id && data.task_class !== undefined) classes.set(ticket.id, data.task_class);
  }
  // The compiler validates manifest and ticket digests before any join.
  const recipe = compileShift(source.shift, bodies, { prompts: { builder: "", reviewer: "" } });
  const result = new Map<string, TicketTaskClass>();
  for (const phase of recipe.phases) {
    if (shiftPhaseRole(recipe.phases, phase.id) !== "builder") continue;
    const ticket = shiftTicketOf(recipe.phases, phase.id);
    const taskClass = ticket === null ? undefined : classes.get(ticket);
    if (taskClass !== undefined) result.set(phase.id, taskClass);
  }
  return result;
}

/** Missing legacy metadata or unavailable sealed bytes never invent a class. */
export function readShiftTaskClasses(journalPath: string): ReadonlyMap<string, TicketTaskClass> {
  try {
    const source = JSON.parse(readFileSync(join(dirname(journalPath), "status.json"), "utf8")) as ShiftClassSource;
    if (typeof source.repository !== "string" || source.shift == null) return new Map();
    return shiftTaskClasses(source);
  } catch {
    return new Map();
  }
}
