// Read-only ticket metadata for metrics. The projection has no shift manifest
// column: status supplies the sealed selection and recorded base. Read its
// ticket blobs at that base, not today's checkout (owner bookkeeping changes
// whole-file digests). Nothing here selects or changes a runner route.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ShiftManifestSchema, shiftManifestDigest, type ShiftManifest } from "../contracts/shift-selection-record.ts";
import type { TicketTaskClass } from "../contracts/ticket.ts";
import { systemGitByteRunner, type GitByteRunner } from "../git/changes.ts";
import { parsePlanTicketData } from "../persistence/plan-tickets.ts";
import { shiftTicketOf, shiftPhaseRole } from "../workflow/shift/bind.ts";
import {
  compileShift,
  ShiftTicketBytesMismatch,
  ShiftTicketDigestMismatch,
  ShiftTicketUnreadable,
} from "../workflow/shift/compile.ts";

export interface ShiftClassSource {
  readonly repository: string;
  readonly baseSha: string | null;
  readonly shift: ShiftManifest;
}

export interface ShiftTaskClassDiagnostic {
  readonly code: "shift-status-unreadable" | "shift-selection-invalid" | "ticket-unavailable" |
    "ticket-invalid-utf8" | "ticket-digest-mismatch" | "ticket-metadata-invalid";
  readonly ticketId: string | null;
  /** Repository-relative; never an absolute filesystem path. */
  readonly path: string | null;
  readonly message: string;
}

export interface ShiftTaskClassRead {
  readonly classes: ReadonlyMap<string, TicketTaskClass>;
  readonly diagnostics: readonly ShiftTaskClassDiagnostic[];
}

const SHIFT_CLASS_CACHE_LIMIT = 128;
const shiftClassCache = new Map<string, ShiftTaskClassRead>();
const runnerIds = new WeakMap<GitByteRunner, number>();
let nextRunnerId = 1;

function runnerCacheId(runner: GitByteRunner | undefined): string {
  if (runner === undefined) return "system";
  let id = runnerIds.get(runner);
  if (id === undefined) {
    id = nextRunnerId++;
    runnerIds.set(runner, id);
  }
  return String(id);
}

function immutableInputKey(source: ShiftClassSource, runner: GitByteRunner | undefined): string | null {
  if (source.baseSha === null || !/^[a-f0-9]{40}$/u.test(source.baseSha) ||
      !Value.Check(ShiftManifestSchema, source.shift) || shiftManifestDigest(source.shift) !== source.shift.manifestDigest) {
    return null;
  }
  return `${resolve(source.repository)}\0${source.baseSha}\0${source.shift.manifestDigest}\0${runnerCacheId(runner)}`;
}

function diagnostic(
  code: ShiftTaskClassDiagnostic["code"],
  ticketId: string | null,
  path: string | null,
): ShiftTaskClassDiagnostic {
  const message = code === "ticket-invalid-utf8"
    ? "sealed ticket bytes are not valid UTF-8; task class remains unclassified"
    : code === "ticket-digest-mismatch"
      ? "sealed ticket bytes do not match their digest; task class remains unclassified"
      : code === "ticket-metadata-invalid"
        ? "sealed ticket metadata is malformed; task class remains unclassified"
        : code === "ticket-unavailable"
          ? "sealed ticket bytes are unavailable; task class remains unclassified"
          : code === "shift-status-unreadable"
            ? "shift status metadata is unreadable; task classes remain unclassified"
            : "sealed shift selection is invalid; task classes remain unclassified";
  return { code, ticketId, path, message };
}

function compileWithDiagnostics(source: ShiftClassSource, runner?: GitByteRunner): ShiftTaskClassRead {
  if (!Value.Check(ShiftManifestSchema, source.shift) || shiftManifestDigest(source.shift) !== source.shift.manifestDigest) {
    return { classes: new Map(), diagnostics: [diagnostic("shift-selection-invalid", null, null)] };
  }
  if (source.baseSha !== null && !/^[a-f0-9]{40}$/u.test(source.baseSha)) {
    return { classes: new Map(), diagnostics: [diagnostic("shift-selection-invalid", null, null)] };
  }

  const bodies = new Map<string, Uint8Array>();
  const git = runner ?? systemGitByteRunner(source.repository);
  for (const ticket of source.shift.tickets) {
    try {
      if (source.baseSha === null) {
        bodies.set(ticket.id, readFileSync(join(source.repository, ticket.path)));
      } else {
        const blob = git(["cat-file", "blob", `${source.baseSha}:${ticket.path}`]);
        if (blob.status !== 0) {
          return { classes: new Map(), diagnostics: [diagnostic("ticket-unavailable", ticket.id, ticket.path)] };
        }
        // Preserve the exact blob bytes. A UTF-8 round trip changes malformed
        // sequences before the manifest digest and ticket parser see them.
        bodies.set(ticket.id, blob.stdout);
      }
    } catch {
      return { classes: new Map(), diagnostics: [diagnostic("ticket-unavailable", ticket.id, ticket.path)] };
    }
  }

  let recipe;
  try {
    recipe = compileShift(source.shift, bodies, { prompts: { builder: "", reviewer: "" } });
  } catch (error) {
    if (error instanceof ShiftTicketUnreadable) {
      const ticket = source.shift.tickets.find((item) => item.id === error.ticket);
      const invalidUtf8 = error.message.includes("not valid UTF-8");
      return { classes: new Map(), diagnostics: [diagnostic(invalidUtf8 ? "ticket-invalid-utf8" : "ticket-metadata-invalid", error.ticket, ticket?.path ?? null)] };
    }
    if (error instanceof ShiftTicketDigestMismatch) {
      const ticket = source.shift.tickets.find((item) => item.id === error.ticket);
      return { classes: new Map(), diagnostics: [diagnostic("ticket-digest-mismatch", error.ticket, ticket?.path ?? null)] };
    }
    if (error instanceof ShiftTicketBytesMismatch) {
      return { classes: new Map(), diagnostics: [diagnostic("shift-selection-invalid", null, null)] };
    }
    return { classes: new Map(), diagnostics: [diagnostic("shift-selection-invalid", null, null)] };
  }

  const classes = new Map<string, TicketTaskClass>();
  const diagnostics: ShiftTaskClassDiagnostic[] = [];
  for (const ticket of source.shift.tickets) {
    const bytes = bodies.get(ticket.id);
    if (bytes === undefined) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      // compileShift already refused this ticket; retain a defensive no-class
      // path if its UTF-8 contract changes independently.
      diagnostics.push(diagnostic("ticket-invalid-utf8", ticket.id, ticket.path));
      continue;
    }
    const data = parsePlanTicketData(text);
    if (data === null || data.id !== ticket.id) {
      diagnostics.push(diagnostic("ticket-metadata-invalid", ticket.id, ticket.path));
      continue;
    }
    if (data.task_class !== undefined) classes.set(ticket.id, data.task_class);
  }

  const result = new Map<string, TicketTaskClass>();
  for (const phase of recipe.phases) {
    if (shiftPhaseRole(recipe.phases, phase.id) !== "builder") continue;
    const ticket = shiftTicketOf(recipe.phases, phase.id);
    const taskClass = ticket === null ? undefined : classes.get(ticket);
    if (taskClass !== undefined) result.set(phase.id, taskClass);
  }
  return { classes: result, diagnostics };
}

function copyResult(value: ShiftTaskClassRead): ShiftTaskClassRead {
  return { classes: new Map(value.classes), diagnostics: value.diagnostics.map((item) => ({ ...item })) };
}

/** Keys are compiled phase keys, never guessed from a build phase's name. */
export function shiftTaskClasses(source: ShiftClassSource, runner?: GitByteRunner): ReadonlyMap<string, TicketTaskClass> {
  if (!Value.Check(ShiftManifestSchema, source.shift) || shiftManifestDigest(source.shift) !== source.shift.manifestDigest) {
    throw new Error("invalid sealed selection");
  }
  const bodies = new Map<string, Uint8Array>();
  const git = runner ?? systemGitByteRunner(source.repository);
  for (const ticket of source.shift.tickets) {
    let bytes: Uint8Array;
    if (source.baseSha === null) {
      bytes = readFileSync(join(source.repository, ticket.path));
    } else {
      if (!/^[a-f0-9]{40}$/u.test(source.baseSha)) throw new Error("invalid recorded base");
      const blob = git(["cat-file", "blob", `${source.baseSha}:${ticket.path}`]);
      if (blob.status !== 0) throw new Error("unavailable recorded ticket blob");
      bytes = blob.stdout;
    }
    bodies.set(ticket.id, bytes);
  }
  const recipe = compileShift(source.shift, bodies, { prompts: { builder: "", reviewer: "" } });
  const classes = new Map<string, TicketTaskClass>();
  for (const ticket of source.shift.tickets) {
    const bytes = bodies.get(ticket.id);
    if (bytes === undefined) continue;
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const data = parsePlanTicketData(text);
    if (data?.id === ticket.id && data.task_class !== undefined) classes.set(ticket.id, data.task_class);
  }
  const result = new Map<string, TicketTaskClass>();
  for (const phase of recipe.phases) {
    if (shiftPhaseRole(recipe.phases, phase.id) !== "builder") continue;
    const ticket = shiftTicketOf(recipe.phases, phase.id);
    const taskClass = ticket === null ? undefined : classes.get(ticket);
    if (taskClass !== undefined) result.set(phase.id, taskClass);
  }
  return result;
}

/** Reads diagnostics and classes as one tolerant metrics operation. */
export function readShiftTaskClassResult(journalPath: string, runner?: GitByteRunner): ShiftTaskClassRead {
  let source: ShiftClassSource;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dirname(journalPath), "status.json"), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { classes: new Map(), diagnostics: [diagnostic("shift-status-unreadable", null, null)] };
    }
    source = parsed as ShiftClassSource;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { classes: new Map(), diagnostics: [] };
    return { classes: new Map(), diagnostics: [diagnostic("shift-status-unreadable", null, null)] };
  }
  if (typeof source.repository !== "string" || source.shift == null) {
    return { classes: new Map(), diagnostics: [diagnostic("shift-selection-invalid", null, null)] };
  }

  const key = immutableInputKey(source, runner);
  if (key !== null) {
    const cached = shiftClassCache.get(key);
    if (cached !== undefined) {
      shiftClassCache.delete(key);
      shiftClassCache.set(key, cached);
      return copyResult(cached);
    }
  }
  const result = compileWithDiagnostics(source, runner);
  if (key !== null) {
    shiftClassCache.set(key, copyResult(result));
    if (shiftClassCache.size > SHIFT_CLASS_CACHE_LIMIT) {
      const oldest = shiftClassCache.keys().next().value as string | undefined;
      if (oldest !== undefined) shiftClassCache.delete(oldest);
    }
  }
  return copyResult(result);
}

/** Backward-compatible class-only read; metrics payloads consume diagnostics through the result API. */
export function readShiftTaskClasses(journalPath: string, runner?: GitByteRunner): ReadonlyMap<string, TicketTaskClass> {
  return readShiftTaskClassResult(journalPath, runner).classes;
}
