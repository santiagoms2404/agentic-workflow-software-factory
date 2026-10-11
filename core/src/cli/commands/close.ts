import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Actor } from "../../state/task-machine.ts";
import type { OwnerTerminal } from "../tty.ts";
import { readAttempt, type AttemptProjector, type AttemptStatus } from "./attempt.ts";
import { readAttemptEvidence } from "./review-record.ts";
import { assertTicketSelection, type TicketSelection } from "../../contracts/ticket-selection-record.ts";
import { assertClosureRecord, type ClosureRecord } from "../../contracts/closure-record.ts";
import { closureJournalRecords, withClosureJournal, type ClosureEvidence } from "../../persistence/closure-journal.ts";
import { projectClosureJournalRecords, withProjectClosureJournal, type ProjectClosureProjector } from "../../persistence/project-closure-journal.ts";
import { compareAskedFor, type AskedForSelection } from "../../closure/asked-for.ts";
import { closureDelta } from "../../closure/delta.ts";
import { proposeClosure, applyClosureChoices, type ClosureRow } from "../../closure/propose.ts";
import { proposeSpineRollUp } from "../../closure/spine.ts";
import { assertClosureFiles, closureAncestor, closureClean, closureHead, closureGitRunner, finishClosureCheckout,
  prepareClosureCommit, readClosureSnapshot, verifyClosureCommit, type ClosureSnapshot } from "../../git/closure.ts";
import { runGit } from "../../git/changes.ts";
import { compileShift } from "../../workflow/shift/compile.ts";
import { shiftTicketCandidates } from "../../workflow/shift/bind.ts";
import { registeredTicketPaths, ticketFrontmatter, treeText } from "../../closure/tree.ts";

export interface CloseCommandOptions {
  readonly attemptDir?: string;
  /** Owner-commit mode requires these fields and never reads or writes an attempt. */
  readonly commit?: string;
  readonly repository?: string;
  readonly projectDir?: string;
  readonly project?: string;
  readonly plan?: string;
  /** Omit to offer every task in the registered plan. */
  readonly tickets?: readonly string[];
  readonly projectClosureRecord?: ProjectClosureProjector;
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

async function builtTickets(attemptDir: string, status: AttemptStatus, base: ClosureSnapshot): Promise<ReadonlySet<string> | undefined> {
  if (status.shift == null) return undefined;
  const source = base.registry.plans.find(source => source.label === status.shift!.plan);
  if (source === undefined) return refuse("E_CLOSURE_SELECTION", "closure selection has no registered plan");
  const bodies = new Map(status.shift.tickets.map(ticket => [ticket.id, Buffer.from(treeText(base.tree, `${source.ticketsPath}/${ticket.id}.md`))]));
  // Only recipe structure matters here; no phase is executed or prompt routed.
  const recipe = compileShift(status.shift, bodies, { prompts: { builder: "", reviewer: "" } });
  const evidence = await readAttemptEvidence(attemptDir);
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
  const ownerCommit = options.commit !== undefined;
  if (ownerCommit ? options.attemptDir !== undefined || !options.repository || !options.projectDir || !options.project || !options.plan
    : !options.attemptDir || options.tickets !== undefined || options.plan !== undefined) {
    refuse("E_CLOSURE_OPTIONS", "closure requires an attempt, or --commit with repository, project directory, project and --plan");
  }
  const status = ownerCommit ? null : await readAttempt(options.attemptDir!);
  if (status !== null && status.lifecycleState !== "LANDED") refuse("E_CLOSURE_NOT_LANDED", "closure requires a LANDED attempt");
  const sealed = status?.shift ?? status?.ticketSelection;
  if (status !== null && (sealed == null || sealed.tickets.length === 0 || status.planRef !== sealed.plan || status.baseSha === null || status.candidateSha === null)) {
    refuse("E_CLOSURE_SELECTION", "closure requires a sealed ticket selection and recorded base and candidate");
  }
  if (status !== null && status.shift == null) assertTicketSelection(sealed as TicketSelection);
  const repository = status?.repository ?? resolve(options.repository!);
  const git = closureGitRunner(repository);
  const head = closureHead(git);
  const resolvedCommit = ownerCommit ? git(["rev-parse", "--verify", "--end-of-options", `${options.commit}^{commit}`]) : null;
  if (resolvedCommit !== null && (resolvedCommit.status !== 0 || !/^[a-f0-9]{40}$/u.test(resolvedCommit.stdout.trim()))) {
    refuse("E_CLOSURE_COMMIT", "closure evidence commit is not reachable from canonical HEAD");
  }
  const candidate = status?.candidateSha ?? resolvedCommit!.stdout.trim();
  const baseSha = status?.baseSha ?? candidate;
  if (!closureAncestor(git, candidate, head)) refuse(ownerCommit ? "E_CLOSURE_COMMIT" : "E_CLOSURE_CANDIDATE",
    ownerCommit ? "closure evidence commit is not reachable from canonical HEAD" : "closure candidate is not an ancestor of canonical HEAD");
  const plan = sealed === undefined || sealed === null ? options.plan! : sealed.plan;
  const operationKey = createHash("sha256").update(JSON.stringify([candidate, plan, options.tickets ?? null])).digest("hex");
  const projectIdentity = { project: options.project!, repository, operationKey };
  const attemptRecords = status === null ? [] : await closureJournalRecords(options.attemptDir!);
  const projectRecords = status === null ? await projectClosureJournalRecords(options.projectDir!) : [];
  if (projectRecords.some(row => row.event.project !== options.project || row.event.repository !== repository)) {
    refuse("E_CLOSURE_PROJECT", "closure project journal identity differs");
  }
  const finishedProjectIntents = new Set(projectRecords.flatMap(row => row.event.evidence.type === "closure-record" ? [row.event.evidence.record.id] : []));
  if (projectRecords.some(row => row.event.operationKey !== operationKey && row.event.evidence.type === "closure-intent" && !finishedProjectIntents.has(row.event.evidence.intent.id))) {
    refuse("E_CLOSURE_INTERRUPTED", "interrupted project closure: rerun the original commit, plan and ticket selection; no automatic replay");
  }
  const evidence = status === null ? projectRecords.filter(row => row.event.operationKey === operationKey).map(row => row.event.evidence)
    : attemptRecords.flatMap(row => row.event.evidence === undefined ? [] : [row.event.evidence]);
  // Both evidence kinds share the one commit and interruption protocol.
  const withJournal = <T>(act: (append: (evidence: ClosureEvidence) => Promise<void>, reconcile: () => Promise<void>) => Promise<T>): Promise<T> => status === null
    ? withProjectClosureJournal(options.projectDir!, projectIdentity, options.projectClosureRecord, async (current, append, reconcile) => {
      if (current.length !== projectRecords.length) refuse("E_CLOSURE_ATTEMPT_MOVED", "project closure journal changed during confirmation");
      return act(append, reconcile);
    }) : withClosureJournal(options.attemptDir!, options.projectRecord, async (current, currentRecords, append, reconcile) => {
      if (current.revision !== attemptRecords.at(-1)?.event.next.revision || currentRecords.length !== attemptRecords.length) refuse("E_CLOSURE_ATTEMPT_MOVED", "attempt changed during closure confirmation");
      return act(append, reconcile);
    });
  const completed = evidence.flatMap(item => item.type === "closure-record" ? [item.record] : []).at(-1);
  if (completed !== undefined) {
    assertClosureRecord(completed);
    verifyClosureCommit(git, completed);
    if (!closureAncestor(git, completed.commitSha, head)) refuse("E_CLOSURE_INTERRUPTED", "recorded closure is not in canonical HEAD");
    if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
    return withJournal(async (_append, reconcile) => {
      await reconcile();
      return { confirmed: true, record: completed };
    });
  }
  const intent = evidence.flatMap(item => item.type === "closure-intent" ? [item.intent] : []).at(-1);
  if (intent !== undefined) {
    const prepared = evidence.flatMap(item => item.type === "closure-prepared" ? [item.record] : []).at(-1);
    if (prepared === undefined || prepared.id !== intent.id || prepared.parentSha !== intent.parentSha ||
      prepared.candidateSha !== intent.candidateSha || prepared.candidateSha !== candidate || head !== prepared.commitSha) {
      refuse("E_CLOSURE_INTERRUPTED", "interrupted closure: no published prepared commit; no automatic replay");
    }
    assertClosureRecord(prepared);
    return withJournal(async (append, reconcile) => {
      finishClosureCheckout(repository, prepared, git);
      await reconcile();
      await append({ type: "closure-record", record: prepared });
      return { confirmed: true, record: prepared };
    });
  }
  if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
  const base = readClosureSnapshot(git, baseSha);
  const before = readClosureSnapshot(git, head);
  const light = plan === null;
  const source = before.registry.plans.find(source => source.label === plan);
  if (!light && source === undefined) refuse("E_CLOSURE_SELECTION", "closure selection has no registered plan");
  if (ownerCommit && source?.project !== options.project) refuse("E_CLOSURE_PROJECT", "closure project differs from registered plan");
  const ids = sealed?.tickets.map(ticket => ticket.id) ?? options.tickets ?? registeredTicketPaths(before.tree, source!)
    .map(path => String(ticketFrontmatter(treeText(before.tree, path), path).fields.id));
  if (ids.length === 0 || new Set(ids).size !== ids.length) refuse("E_CLOSURE_SELECTION", "closure requires distinct registered tickets");
  const checkAsk = (selected: readonly AskedForSelection[]): void => {
    const ask = compareAskedFor(base.tree, before.tree, base.registry, selected, before.registry);
    if (!ask.ok) refuse(ask.refusal.code, ask.refusal.code === "E_CLOSURE_ASK_CHANGED"
      ? `closure ask changed since base: ${ask.refusal.differences.map(item => `${item.selection.ticket}.${item.field}`).join(", ")}`
      : `closure cannot resolve ask: ${ask.refusal.message}`);
  };
  if (light && (ids.length !== 1 || status?.shift != null)) refuse("E_CLOSURE_SELECTION", "light closure requires exactly one flat ticket");
  checkAsk(ids.map(ticket => light ? { kind: "light", ticket } : { kind: "plan", plan: plan!, ticket }));
  const proposal = light ? { tickets: ids, rows: [] as readonly ClosureRow[], notClosable: [] as readonly string[] }
    : proposeClosure(before.tree, before.registry, plan!, ids,
      status === null ? undefined : await builtTickets(options.attemptDir!, status, base));
  for (const id of proposal.notClosable) options.terminal.write(`${id}: not closable (no host-recorded built candidate in the landed selection)`);
  const closed = new Set<ClosureRow>();
  const choose = async (rows: readonly ClosureRow[], rollUp = false): Promise<void> => {
    for (const row of rows) options.terminal.write(`${row.path} ${row.ticket} row ${row.rowIndex}: [${row.marker}] ${row.text}`);
    const all = rows.length > 0 && await options.terminal.confirm(rollUp
      ? "Mark all offered spine rows complete? (No chooses row by row)" : "Mark all offered rows complete? (No chooses row by row)");
    for (const row of rows) if (all || await options.terminal.confirm(`Mark ${row.path} ${row.ticket} row ${row.rowIndex} complete?`)) closed.add(row);
  };
  await choose(proposal.rows);
  // Owner-commit mode offers any task, but derives only tasks whose rows the owner chose.
  const primary = ownerCommit ? { ...proposal, tickets: proposal.tickets.filter(id => proposal.rows.some(row => row.ticket === id && closed.has(row))) } : proposal;
  let lightState: ClosureRecord["lightState"];
  let after;
  if (light) {
    const path = before.registry.lightTickets?.get(ids[0]!);
    if (path === undefined) refuse("E_CLOSURE_SELECTION", "light ticket has no registered flat source");
    const text = treeText(before.tree, path);
    const fm = ticketFrontmatter(text, path, true);
    options.terminal.write(`${path} ${ids[0]} state: ${fm.state} (no checklist rows)`);
    const state = await options.terminal.confirm(`Mark ${path} ${ids[0]} state done? (No leaves it open as wip)`)
      ? "done" : "wip";
    lightState = { path, ticket: ids[0]!, oldValue: fm.state, newValue: state };
    after = new Map(before.tree);
    after.set(path, Buffer.from(text.slice(0, fm.stateStart) + state + text.slice(fm.stateEnd)));
  } else {
    after = applyClosureChoices(before.tree, before.registry, { ...primary, plan: plan! }, closed);
  }
  const rollUp = light ? null : proposeSpineRollUp(after, before.registry, plan!);
  if (rollUp !== null) {
    checkAsk(rollUp.tickets.map(ticket => ({ kind: "plan", plan: rollUp.plan, ticket })));
    await choose(rollUp.rows, true);
    after = applyClosureChoices(after, before.registry, rollUp, closed);
  }
  const rowsOffered = [...proposal.rows, ...(rollUp?.rows ?? [])];
  const delta = closureDelta(before.tree, after, before.registry, { before: before.modes, after: before.modes });
  if (!delta.ok) refuse("E_CLOSURE_DELTA", `closure delta refused: ${delta.refusal.path}: ${delta.refusal.message}`);
  const paths = [...after.keys()].filter(path => !Buffer.from(after.get(path)!).equals(Buffer.from(before.tree.get(path)!))).sort();
  for (const row of rowsOffered) options.terminal.write(`${row.path} ${row.ticket} row ${row.rowIndex}: [${row.marker}] -> [${closed.has(row) ? "x" : row.marker}]`);
  for (const change of delta.changes) options.terminal.write(`${change.path} ${change.kind} ${change.milestone ?? ""}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`);
  const name = git(["config", "--get", "user.name"]);
  const email = git(["config", "--get", "user.email"]);
  if (name.status !== 0 || email.status !== 0 || !name.stdout.trim() || !email.stdout.trim() || /[\n\r<>]/u.test(name.stdout.trim() + email.stdout.trim())) {
    refuse("E_CLOSURE_IDENTITY", "closure requires the checkout's configured user.name and user.email");
  }
  assertClosureFiles(repository, before, paths);
  if (!await options.terminal.confirm("Commit these exact closure substitutions?")) return { confirmed: false, record: null };
  if (closureHead(git) !== head) refuse("E_CLOSURE_HEAD_MOVED", "canonical HEAD moved during closure confirmation");
  if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
  return withJournal(async (append) => {
    if (closureHead(git) !== head) refuse("E_CLOSURE_HEAD_MOVED", "canonical HEAD moved during closure confirmation");
    if (!closureClean(git)) refuse("E_CLOSURE_DIRTY", "closure requires a clean canonical checkout");
    assertClosureFiles(repository, before, paths);
    const id = randomUUID();
    const at = (options.now ?? (() => new Date().toISOString()))();
    await append({ type: "closure-intent", intent: { id, parentSha: head, candidateSha: candidate, at } });
    await options.onStep?.("intent");
    const message = `chore(specs): close ${plan ?? "light"} ${primary.tickets.join(",")} after ${candidate.slice(0, 7)}`;
    const prepared = prepareClosureCommit(repository, options.attemptDir ?? options.projectDir!, head, before, after, paths, message, { name: name.stdout.trim(), email: email.stdout.trim() });
    await options.onStep?.("commit");
    const rows = rowsOffered.map(row => ({ path: row.path, ticket: row.ticket, taskNumber: row.taskNumber,
      rowIndex: row.rowIndex, oldValue: row.marker, newValue: closed.has(row) ? "x" : row.marker }));
    const record: ClosureRecord = { schema: "awsf.closure-record/v1", id, plan, tickets: [...primary.tickets],
      ...(lightState === undefined ? {} : { lightState }),
      parentSha: head, candidateSha: candidate, commitSha: prepared.commit, at,
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
    finishClosureCheckout(repository, record, git);
    await options.onStep?.("checkout");
    await append({ type: "closure-record", record });
    await options.onStep?.("recorded");
    return { confirmed: true, record };
  });
}
