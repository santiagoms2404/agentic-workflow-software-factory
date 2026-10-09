import { randomUUID } from "node:crypto";
import type { Actor } from "../../state/task-machine.ts";
import type { OwnerTerminal } from "../tty.ts";
import { readAttempt, type AttemptProjector, type AttemptStatus } from "./attempt.ts";
import { readAttemptEvidence } from "./review-record.ts";
import { assertTicketSelection, type TicketSelection } from "../../contracts/ticket-selection-record.ts";
import { assertClosureRecord, type ClosureRecord } from "../../contracts/closure-record.ts";
import { closureJournalRecords, withClosureJournal } from "../../persistence/closure-journal.ts";
import { compareAskedFor } from "../../closure/asked-for.ts";
import { closureDelta } from "../../closure/delta.ts";
import { proposeClosure, applyClosureChoices, type ClosureRow } from "../../closure/propose.ts";
import { assertClosureFiles, closureAncestor, closureClean, closureHead, closureGitRunner, finishClosureCheckout,
  prepareClosureCommit, readClosureSnapshot, verifyClosureCommit, type ClosureSnapshot } from "../../git/closure.ts";
import { runGit } from "../../git/changes.ts";
import { compileShift } from "../../workflow/shift/compile.ts";
import { shiftTicketCandidates } from "../../workflow/shift/bind.ts";
import { treeText } from "../../closure/tree.ts";

export interface CloseCommandOptions {
  readonly attemptDir: string;
  readonly terminal: OwnerTerminal;
  readonly actor?: Actor;
  /** Closure never accepts delegated authority, even from a human caller. */
  readonly lease?: unknown;
  readonly now?: () => string;
  readonly projectRecord?: AttemptProjector;
  /** Test-only interruption boundaries. */
  readonly onStep?: (step: "intent" | "commit" | "prepared" | "published" | "checkout" | "recorded") => Promise<void> | void;
}
export interface CloseCommandResult {
  readonly confirmed: boolean;
  readonly record: ClosureRecord | null;
}
export class ClosureRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ClosureRefused"; this.code = code; }
}
function refuse(code: string, message: string): never { throw new ClosureRefused(code, message); }

async function builtTickets(options: CloseCommandOptions, status: AttemptStatus, base: ClosureSnapshot): Promise<ReadonlySet<string> | undefined> {
  if (status.shift == null) return undefined;
  const source = base.registry.plans.find(source => source.label === status.shift!.plan);
  if (source === undefined) return refuse("E_CLOSURE_SELECTION", "closure selection has no registered plan");
  const bodies = new Map(status.shift.tickets.map(ticket => [ticket.id, Buffer.from(treeText(base.tree, `${source.ticketsPath}/${ticket.id}.md`))]));
  // Only recipe structure matters here; no phase is executed or prompt routed.
  const recipe = compileShift(status.shift, bodies, { prompts: { builder: "", reviewer: "" } });
  const evidence = await readAttemptEvidence(options.attemptDir);
  const checkpoints = evidence.flatMap(item => "checkpoint" in item ? [item.checkpoint] : []);
  const prefix = checkpoints.at(-1)?.prefix ?? status.recovery?.prefix ?? [];
  const git = closureGitRunner(status.repository);
  return new Set(shiftTicketCandidates(recipe.phases, prefix).filter(ticket => ticket.candidateSha !== null &&
    closureAncestor(git, ticket.candidateSha, status.candidateSha!)).map(ticket => ticket.ticketId));
}

/** Built and directly testable, deliberately unreachable from main until owner gate G03-C. */
export async function closeCommand(options: CloseCommandOptions): Promise<CloseCommandResult> {
  if ((options.actor ?? "human") !== "human") refuse("E_CLOSURE_ACTOR", "closure requires a human actor");
  if (!options.terminal.interactive) refuse("E_CLOSURE_TERMINAL", "closure requires an interactive owner terminal");
  if (options.lease !== undefined) refuse("E_CLOSURE_LEASE", "closure cannot run under a lease");
  const status = await readAttempt(options.attemptDir);
  if (status.lifecycleState !== "LANDED") refuse("E_CLOSURE_NOT_LANDED", "closure requires a LANDED attempt");
  const selection = status.shift ?? status.ticketSelection;
  if (selection == null || selection.tickets.length === 0 || status.planRef !== selection.plan || status.baseSha === null || status.candidateSha === null) {
    refuse("E_CLOSURE_SELECTION", "closure requires a sealed ticket selection and recorded base and candidate");
  }
  if (status.shift == null) assertTicketSelection(selection as TicketSelection);
  const git = closureGitRunner(status.repository);
  const head = closureHead(git);
  if (!closureAncestor(git, status.candidateSha, head)) refuse("E_CLOSURE_CANDIDATE", "closure candidate is not an ancestor of canonical HEAD");

  const records = await closureJournalRecords(options.attemptDir);
  const completed = records.flatMap(row => row.event.evidence?.type === "closure-record" ? [row.event.evidence.record] : []).at(-1);
  if (completed !== undefined) {
    assertClosureRecord(completed);
    verifyClosureCommit(git, completed);
    if (!closureAncestor(git, completed.commitSha, head)) refuse("E_CLOSURE_INTERRUPTED", "recorded closure is not in canonical HEAD");
    if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
    return withClosureJournal(options.attemptDir, options.projectRecord, async (_current, _records, _append, reconcile) => {
      await reconcile();
      return { confirmed: true, record: completed };
    });
  }
  const intent = records.flatMap(row => row.event.evidence?.type === "closure-intent" ? [row.event.evidence.intent] : []).at(-1);
  if (intent !== undefined) {
    const prepared = records.flatMap(row => row.event.evidence?.type === "closure-prepared" ? [row.event.evidence.record] : []).at(-1);
    if (prepared === undefined || prepared.id !== intent.id || prepared.parentSha !== intent.parentSha ||
      prepared.candidateSha !== intent.candidateSha || prepared.candidateSha !== status.candidateSha || head !== prepared.commitSha) {
      refuse("E_CLOSURE_INTERRUPTED", "interrupted closure: no published prepared commit; no automatic replay");
    }
    assertClosureRecord(prepared);
    return withClosureJournal(options.attemptDir, options.projectRecord, async (_current, _records, append, reconcile) => {
      finishClosureCheckout(status.repository, prepared, git);
      await reconcile();
      await append({ type: "closure-record", record: prepared });
      return { confirmed: true, record: prepared };
    });
  }
  if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
  const base = readClosureSnapshot(git, status.baseSha);
  const before = readClosureSnapshot(git, head);
  const selected = selection.tickets.map(ticket => ({ kind: "plan" as const, plan: selection.plan, ticket: ticket.id }));
  const ask = compareAskedFor(base.tree, before.tree, base.registry, selected, before.registry);
  if (!ask.ok) refuse(ask.refusal.code, ask.refusal.code === "E_CLOSURE_ASK_CHANGED"
    ? `closure ask changed since base: ${ask.refusal.differences.map(item => `${item.selection.ticket}.${item.field}`).join(", ")}`
    : `closure cannot resolve ask: ${ask.refusal.message}`);
  const proposal = proposeClosure(before.tree, before.registry, selection.plan, selection.tickets.map(ticket => ticket.id), await builtTickets(options, status, base));
  for (const id of proposal.notClosable) options.terminal.write(`${id}: not closable (no host-recorded built candidate in the landed selection)`);
  for (const row of proposal.rows) options.terminal.write(`${row.path} ${row.ticket} row ${row.rowIndex}: [${row.marker}] ${row.text}`);
  const closed = new Set<ClosureRow>();
  const all = proposal.rows.length > 0 && await options.terminal.confirm("Mark all offered rows complete? (No chooses row by row)");
  for (const row of proposal.rows) if (all || await options.terminal.confirm(`Mark ${row.ticket} row ${row.rowIndex} complete?`)) closed.add(row);
  const after = applyClosureChoices(before.tree, before.registry, proposal, closed);
  const delta = closureDelta(before.tree, after, before.registry, { before: before.modes, after: before.modes });
  if (!delta.ok) refuse("E_CLOSURE_DELTA", `closure delta refused: ${delta.refusal.path}: ${delta.refusal.message}`);
  const paths = [...after.keys()].filter(path => !Buffer.from(after.get(path)!).equals(Buffer.from(before.tree.get(path)!))).sort();
  for (const row of proposal.rows) options.terminal.write(`${row.path} ${row.ticket} row ${row.rowIndex}: [${row.marker}] -> [${closed.has(row) ? "x" : row.marker}]`);
  for (const change of delta.changes) options.terminal.write(`${change.path} ${change.kind} ${change.milestone ?? ""}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`);
  const name = git(["config", "--get", "user.name"]);
  const email = git(["config", "--get", "user.email"]);
  if (name.status !== 0 || email.status !== 0 || !name.stdout.trim() || !email.stdout.trim() || /[\n\r<>]/u.test(name.stdout.trim() + email.stdout.trim())) {
    refuse("E_CLOSURE_IDENTITY", "closure requires the checkout's configured user.name and user.email");
  }
  assertClosureFiles(status.repository, before, paths);
  if (!await options.terminal.confirm("Commit these exact closure substitutions?")) return { confirmed: false, record: null };
  if (closureHead(git) !== head) refuse("E_CLOSURE_HEAD_MOVED", "canonical HEAD moved during closure confirmation");
  if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
  return withClosureJournal(options.attemptDir, options.projectRecord, async (current, currentRecords, append) => {
    if (current.revision !== status.revision || currentRecords.length !== records.length) refuse("E_CLOSURE_ATTEMPT_MOVED", "attempt changed during closure confirmation");
    if (closureHead(git) !== head) refuse("E_CLOSURE_HEAD_MOVED", "canonical HEAD moved during closure confirmation");
    if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
    assertClosureFiles(status.repository, before, paths);
    const id = randomUUID();
    const at = (options.now ?? (() => new Date().toISOString()))();
    await append({ type: "closure-intent", intent: { id, parentSha: head, candidateSha: status.candidateSha!, at } });
    await options.onStep?.("intent");
    const message = `chore(specs): close ${selection.plan} ${proposal.tickets.join(",")} after ${status.candidateSha!.slice(0, 7)}`;
    const prepared = prepareClosureCommit(status.repository, options.attemptDir, head, before, after, paths, message, { name: name.stdout.trim(), email: email.stdout.trim() });
    await options.onStep?.("commit");
    const rows = proposal.rows.map(row => ({ path: row.path, ticket: row.ticket, taskNumber: row.taskNumber,
      rowIndex: row.rowIndex, oldValue: row.marker, newValue: closed.has(row) ? "x" : row.marker }));
    const record: ClosureRecord = { schema: "awsf.closure-record/v1", id, plan: selection.plan, tickets: [...proposal.tickets],
      parentSha: head, candidateSha: status.candidateSha!, commitSha: prepared.commit, at,
      rowsClosed: rows.filter(row => row.newValue === "x"), rowsLeftOpen: rows.filter(row => row.newValue !== "x"),
      notClosable: [...proposal.notClosable], blobs: prepared.blobs };
    assertClosureRecord(record);
    verifyClosureCommit(git, record);
    await append({ type: "closure-prepared", record });
    await options.onStep?.("prepared");
    // Any late external movement is reported with its durable intent, never retried.
    if (!closureClean(git)) refuse("E_CLOSURE_INTERRUPTED", "interrupted closure: checkout changed before HEAD publication; no automatic replay");
    runGit(git, ["update-ref", "HEAD", record.commitSha, head]);
    await options.onStep?.("published");
    finishClosureCheckout(status.repository, record, git);
    await options.onStep?.("checkout");
    await append({ type: "closure-record", record });
    await options.onStep?.("recorded");
    return { confirmed: true, record };
  });
}
