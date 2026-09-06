import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AttemptLock } from "../persistence/attempt-lock.ts";
import { Journal } from "../persistence/journal.ts";
import { scanJournal } from "../persistence/replay.ts";
import { scrubCredentials } from "../policy/redaction.ts";
import type { OwnerTerminal } from "../cli/tty.ts";
import { currentUnits, emptyGroup, identifier, reduceEvent, type Event, type Group, type Input, type Narrative, type Operation, type Proposal, type Reference } from "./model.ts";
import { eventValue, narrativeValue, proposalValue } from "./schema.ts";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("non-JSON value");
  return encoded;
}
export function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function safe(value: unknown): void {
  const validText = (node: unknown): void => {
    if (typeof node === "string" && (node.includes("\u0000") || /[\uD800-\uDFFF]/u.test(node))) throw new Error("invalid Unicode or NUL in planning text");
    if (node !== null && typeof node === "object") for (const child of Object.values(node)) validText(child);
  };
  validText(value);
  if (canonical(scrubCredentials(value)) !== canonical(value)) throw new Error("unsafe input refused unchanged: supply sanitized replacement input");
}
export function utf8(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes("\u0000")) throw new Error("NUL is not admitted in planning text");
  return text;
}
export async function readInput(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 1_048_576) throw new Error("input exceeds 1 MiB admission limit: request a narrower input");
  const text = utf8(bytes);
  safe(text);
  return text;
}
export async function reference(path: string, repository: string, revision: string, locator: string, kind: Reference["kind"]): Promise<Reference> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  // Binary attachments remain referenced, never smuggled into the text journal.
  if (kind === "text") safe(utf8(bytes));
  const value = { path: absolute, sha256: hash(bytes), repository, revision, locator, kind };
  safe(value);
  return value;
}
export async function verifyReference(value: Reference): Promise<void> {
  if (!isAbsolute(value.path)) throw new Error("evidence references require absolute runtime paths");
  const bytes = await readFile(value.path);
  if (hash(bytes) !== value.sha256) throw new Error("stale evidence reference: refresh it before approval or focus");
  if (value.kind === "text") safe(utf8(bytes));
}
function eventHash(event: Omit<Event, "digest">): string { return hash(canonical(event)); }
export function proposalHash(proposal: Proposal): string { return hash(canonical(proposal)); }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function outsideRepository(path: string): Promise<void> {
  let cursor = resolve(path);
  while (!await exists(cursor)) cursor = dirname(cursor);
  cursor = await realpath(cursor);
  while (true) {
    if (await exists(join(cursor, ".git"))) throw new Error("runtime planning state must be outside repositories");
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
export interface Location { stateRoot: string; project: string; group: string }
export async function groupDirectory(location: Location): Promise<string> {
  identifier(location.project);
  identifier(location.group);
  const dir = join(resolve(location.stateRoot), "projects", location.project, "groups", location.group);
  await outsideRepository(dir);
  // Do not follow redirects of a group or its files into another authority.
  for (const path of [dir, join(dir, "journal.jsonl"), join(dir, "group.lock")]) {
    if (await exists(path) && (await lstat(path)).isSymbolicLink()) throw new Error("group storage must not be symlinked");
  }
  return dir;
}
export async function replay(location: Location): Promise<{ group: Group; events: Event[] }> {
  const dir = await groupDirectory(location);
  const scanned = await scanJournal<unknown>(join(dir, "journal.jsonl"));
  if (!scanned.ok) throw new Error(`group journal corrupt at ${scanned.badKey}`);
  if (scanned.tornTail !== null) throw new Error("interrupted group append: journal retained unchanged, owner recovery required");
  let group = emptyGroup(location.project, location.group);
  const events: Event[] = [];
  const identities = new Set<string>();
  for (const record of scanned.records) {
    const event = eventValue(record.event);
    safe(event);
    const { digest, ...body } = event;
    if (eventHash(body) !== digest) throw new Error("group journal digest mismatch");
    if (identities.has(event.id)) throw new Error("duplicate event identity");
    if (event.operation.kind === "capture" && hash(event.operation.input.text) !== event.operation.input.sha256) throw new Error("input digest mismatch");
    const operation = event.operation;
    if (operation.kind === "apply") {
      const proposal = group.proposals.find((value) => value.id === operation.proposal);
      if (!proposal || proposalHash(proposal) !== operation.proposalHash) throw new Error("approved proposal digest mismatch");
    }
    group = reduceEvent(group, event);
    identities.add(event.id);
    events.push(event);
  }
  return { group, events };
}
async function verifyOperation(operation: Operation, location: Location): Promise<void> {
  const refs: Reference[] = [];
  if (operation.kind === "capture") refs.push(...operation.input.attachments, ...operation.narrative.references);
  if (operation.kind === "propose") {
    refs.push(...operation.proposal.narrative.references);
    for (const change of operation.proposal.changes) {
      if (change.kind === "bind") {
        const { observedAttempts } = await import("./evidence.ts");
        const attempts = await observedAttempts(location.stateRoot, location.project, change.binding.taskId);
        if (!attempts.some((attempt) => attempt.attempt === change.binding.attempt && attempt.sessionId === change.binding.sessionId)) throw new Error("execution binding does not resolve to retained evidence");
      }
      if (change.kind === "define") refs.push(...change.unit.references);
      if (change.kind === "split") refs.push(...change.children.flatMap((unit) => unit.references));
      if (change.kind === "accept-interface" || change.kind === "accept-delivery") refs.push(...change.evidence);
    }
  }
  for (const ref of refs) await verifyReference(ref);
}
export interface WriteOptions extends Location {
  id: string;
  expected: number;
  /** Test crash injection after a real durable append, never before a fake write. */
  afterAppend?: () => void;
}
async function append(options: WriteOptions, requested: Operation, terminal?: OwnerTerminal): Promise<Group> {
  const operation = structuredClone(requested);
  identifier(options.id);
  safe(operation);
  const dir = await groupDirectory(options);
  return new AttemptLock(join(dir, "group.lock")).withLock(async () => {
    const { group, events } = await replay(options);
    const prior = events.find((event) => event.id === options.id);
    if (prior) {
      if (prior.base !== options.expected || canonical(prior.operation) !== canonical(operation)) throw new Error("idempotency key reused for different input");
      return group;
    }
    if (group.revision !== options.expected) throw new Error(`stale group revision: expected ${options.expected}, found ${group.revision}`);
    await verifyOperation(operation, options);
    const body = { schema: "awsf/group-event/v1" as const, group: options.group, project: options.project,
      id: options.id, base: options.expected, at: new Date().toISOString(), previous: group.head, operation };
    const event = eventValue({ ...body, digest: eventHash(body) });
    const next = reduceEvent(group, event);
    if (operation.kind === "apply") {
      const proposal = group.proposals.find((value) => value.id === operation.proposal)!;
      if (proposalHash(proposal) !== operation.proposalHash) throw new Error("proposal hash changed");
      await verifyOperation({ kind: "propose", proposal }, options);
      if (terminal?.interactive !== true) throw new Error("planning approval requires the owner terminal, not an assistant flag");
      const priorRevisions = new Map(currentUnits(group).map((unit) => [unit.id, unit.revision]));
      const unitRevisionChanges = currentUnits(next).filter((unit) => priorRevisions.get(unit.id) !== unit.revision)
        .map((unit) => ({ id: unit.id, from: priorRevisions.get(unit.id) ?? null, to: unit.revision }));
      terminal.write(canonical({ group: group.id, revision: group.revision, proposal, proposalHash: operation.proposalHash,
        ownerReason: operation.ownerReason, unitRevisionChanges }));
      if (!await terminal.confirm("Accept this exact planning amendment only? This grants no attempt lifecycle permission.")) throw new Error("owner declined planning amendment");
      await verifyOperation({ kind: "propose", proposal }, options);
    }
    // Preflight the entire envelope against the exact scrubber Journal applies.
    safe(event);
    const journal = new Journal<Event>(join(dir, "journal.jsonl"));
    try {
      await journal.append(event);
      options.afterAppend?.();
    } finally { await journal.close(); }
    return next;
  });
}
export async function capture(options: WriteOptions, input: Input, narrative: Narrative): Promise<Group> {
  narrativeValue(narrative);
  if (hash(input.text) !== input.sha256) throw new Error("input digest mismatch");
  return append(options, { kind: "capture", input, narrative });
}
export async function propose(options: WriteOptions, proposal: Proposal): Promise<Group> {
  return append(options, { kind: "propose", proposal: proposalValue(proposal) });
}
export async function apply(options: WriteOptions, proposal: string, digest: string, ownerReason: string, terminal: OwnerTerminal): Promise<Group> {
  return append(options, { kind: "apply", proposal, proposalHash: digest, ownerReason }, terminal);
}
