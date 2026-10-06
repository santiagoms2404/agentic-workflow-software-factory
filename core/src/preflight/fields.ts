import { createHash } from "node:crypto";
import {
  FRESHNESS_REFUSALS,
  K1_FIELD_IDS,
  k1FieldKind,
  type FreshnessRefusal,
  requestPathsDigest,
  type DriverPreflightRecord,
  type K1FieldId,
  type K1FieldResult,
  type PreflightSuite,
  type ProtectedPlanEntry,
  type RequestConfirmationRecord,
} from "../contracts/driver-preflight.ts";
import { matchesPathGlob, normalizeRepositoryPath } from "../policy/path-policy.ts";
import type { TaskState } from "../state/task-machine.ts";

// K1's field evaluators (specs/awsf-v3-w01-driver-checks.html, K1's fields).
//
// Callers gather; evaluators judge. Nothing here reads a file, runs Git, asks
// the clock or reads the platform: every fact arrives as an argument, so the
// same facts always give the same verdict and every refusal can be replayed.
// `--where`, `--read` and `--consulted` are the driver's inputs, and each is
// checked here against the request text, the configuration or the journal;
// none of them can mark a field passed by being said.
//
// Refusal reasons name the fault and the input that would clear it. They never
// spell a next command: lifecycle advice is rendered only by
// core/src/lifecycle/renderer.ts.

export type FieldVerdict = { readonly passed: true } | { readonly passed: false; readonly reason: string };

const PASS: FieldVerdict = Object.freeze({ passed: true });

function verdict(problems: readonly string[]): FieldVerdict {
  return problems.length === 0 ? PASS : Object.freeze({ passed: false, reason: problems.join("; ") });
}

/** A segment no configured glob names, standing in for "any segment" when a glob is tested as a path. */
const PROBE = "k1-probe";

/** A matcher that never throws: an invalid spelling matches nothing. Case sensitivity is always explicit. */
function matches(path: string, glob: string, caseSensitive: boolean): boolean {
  try {
    return matchesPathGlob(path, glob, caseSensitive);
  } catch {
    return false;
  }
}

function invalidPath(path: string): string | null {
  try {
    normalizeRepositoryPath(path);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Whether a writes glob covers an entry, which may itself be a glob. The entry
 * must match literally and, when it holds a wildcard, so must its deepest
 * expansion: `core/src/**` is not inside `core/src/*`, though its spelling is.
 * Case-sensitive by default, as `awsf grant` matches role writes.
 */
function covers(entry: string, glob: string, caseSensitive = true): boolean {
  if (!matches(entry, glob, caseSensitive)) return false;
  if (!/[*?]/u.test(entry)) return true;
  return matches(entry.replace(/\*\*/gu, `${PROBE}/${PROBE}`).replace(/\*/gu, PROBE).replace(/\?/gu, "p"), glob, caseSensitive);
}

// ---------------------------------------------------------------- request-shape

export const REQUEST_LABELS = ["Ask:", "Where:", "Done means:", "Out of scope:"] as const;

export interface RequestLines {
  readonly ask: string;
  readonly where: string;
  readonly doneMeans: string;
  readonly outOfScope: string;
}

export type RequestParse = { readonly ok: true; readonly lines: RequestLines } | { readonly ok: false; readonly reason: string };

const FOUR_LINES = "write the four lines Ask:, Where:, Done means: and Out of scope:, in that order";

/**
 * The four labelled lines, in order, each non-empty. A label counts only at
 * the start of a line; an unlabelled line continues the line above it, and
 * text before `Ask:` is refused rather than silently ignored.
 */
export function parseRequestLines(request: string): RequestParse {
  const found: { label: (typeof REQUEST_LABELS)[number]; text: string }[] = [];
  for (const row of request.split(/\r?\n/u)) {
    const line = row.trim();
    const label = REQUEST_LABELS.find((candidate) => line.startsWith(candidate));
    if (label !== undefined) {
      if (found.some((entry) => entry.label === label)) return { ok: false, reason: `the request has more than one ${label} line` };
      found.push({ label, text: line.slice(label.length).trim() });
    } else if (line.length > 0) {
      const last = found.at(-1);
      if (last === undefined) return { ok: false, reason: `the request has text before its Ask: line; ${FOUR_LINES}` };
      last.text = last.text.length === 0 ? line : `${last.text} ${line}`;
    }
  }
  for (const label of REQUEST_LABELS) {
    if (!found.some((entry) => entry.label === label)) return { ok: false, reason: `the request has no ${label} line; ${FOUR_LINES}` };
  }
  for (const [index, entry] of found.entries()) {
    if (entry.label !== REQUEST_LABELS[index]) {
      return { ok: false, reason: `the request's ${entry.label} line is out of order; ${FOUR_LINES}` };
    }
  }
  const empty = found.find((entry) => entry.text.length === 0);
  if (empty !== undefined) return { ok: false, reason: `the request's ${empty.label} line is empty` };
  const [ask, where, doneMeans, outOfScope] = found.map((entry) => entry.text) as [string, string, string, string];
  return { ok: true, lines: Object.freeze({ ask, where, doneMeans, outOfScope }) };
}

export function evaluateRequestShape(request: string): FieldVerdict {
  const parsed = parseRequestLines(request);
  return parsed.ok ? PASS : verdict([parsed.reason]);
}

// ---------------------------------------------------------------- path tokens

const LEADING_PUNCTUATION = /^[`'"([{<]+/u;
const TRAILING_PUNCTUATION = /[`'")\]}>,;:.!]+$/u;

/** Every word of a text, with the punctuation prose wraps paths in stripped. */
function words(text: string): string[] {
  return text.split(/[\s,;]+/u)
    .map((word) => word.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, ""))
    .filter((word) => word.length > 0);
}

export interface PathToken {
  /** The token as the request spells it, wrapping punctuation stripped. */
  readonly text: string;
  /** Its repository-relative spellings: one, or every suffix of a path rooted outside the repository. */
  readonly candidates: readonly string[];
}

function isPathShaped(word: string): boolean {
  if (word.includes("://")) return false;
  return word.includes("/") || /[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,9}$/u.test(word);
}

function repositorySpellings(word: string): string[] {
  let path = word;
  let rooted = false;
  for (;;) {
    if (path.startsWith("/")) [path, rooted] = [path.slice(1), true];
    else if (path.startsWith("./")) path = path.slice(2);
    else if (path.startsWith("../")) [path, rooted] = [path.slice(3), true];
    else break;
  }
  path = path.replace(/\/+$/u, "");
  if (path.length === 0 || invalidPath(path) !== null) return [];
  if (!rooted) return [path];
  const segments = path.split("/");
  return segments.map((_, index) => segments.slice(index).join("/"));
}

/**
 * Every path-shaped token in a text: a word holding a `/`, or a file name with
 * an extension. Deliberately wide. A token that names a protected path only as
 * context is still a match, and the driver classifies it with `--read`; the
 * scan is never narrowed to make a request pass.
 */
export function extractPathTokens(text: string): readonly PathToken[] {
  const tokens = new Map<string, PathToken>();
  for (const word of words(text)) {
    if (tokens.has(word) || !isPathShaped(word)) continue;
    const candidates = repositorySpellings(word);
    if (candidates.length > 0) tokens.set(word, Object.freeze({ text: word, candidates: Object.freeze(candidates) }));
  }
  return [...tokens.values()];
}

/**
 * The directories a token may omit from the front of a protected glob: every
 * proper prefix of its leading literal segments. A bare `transport-broker.ts`
 * resolves against `core/src/execution/transport-broker.ts`, and `state/guards.ts`
 * against `core/src/state/**`; a bare `guards.ts` does not, because it would
 * then name no segment of that glob at all.
 */
function omittablePrefixes(glob: string): string[] {
  const segments = glob.split("/");
  const literal = segments.findIndex((segment) => /[*?[]/u.test(segment));
  const count = literal === -1 ? segments.length : literal;
  return Array.from({ length: Math.max(count, 1) }, (_, index) => index === 0 ? "" : `${segments.slice(0, index).join("/")}/`);
}

/** The protected spelling a candidate resolves to under a glob, or null. Naming a protected directory counts. */
function protectedSpelling(candidate: string, glob: string): string | null {
  for (const prefix of omittablePrefixes(glob)) {
    const path = `${prefix}${candidate}`;
    if (matches(path, glob, false) || matches(`${path}/${PROBE}`, glob, false)) return path;
  }
  return null;
}

/** Whether a `--where` or `--read` entry classifies a protected spelling: equal to it, or a glob over it. */
function classifies(entry: string, path: string): boolean {
  return entry === path || matches(path, entry, false) || matches(`${path}/${PROBE}`, entry, false);
}

// ---------------------------------------------------------------- write-boundary

/** A phase of the recipe that writes the repository, keyed as `awsf grant` keys it, with its role's `writes`. */
export interface WritingPhase {
  readonly phase: string;
  readonly writes: readonly string[];
}

/** Present only when the attempt's workflow is a shift. */
export interface ShiftFacts {
  /** The configured `writes` of the builder role every shift ticket's build runs as. */
  readonly builderWrites: readonly string[];
}

export interface WriteBoundaryFacts {
  readonly request: string;
  readonly where: readonly string[];
  readonly writers: readonly WritingPhase[];
  readonly shift: ShiftFacts | null;
}

/**
 * Every `--where` entry appears verbatim in the request's Where line, and at
 * least one writing role's `writes` covers it. On a shift every entry must also
 * be inside what a shift builder can write.
 */
export function evaluateWriteBoundary(facts: WriteBoundaryFacts): FieldVerdict {
  // A recipe with no writing phase (scout, plan) writes nothing, so there is
  // nothing to declare; any entry it is given is still checked and refused below.
  if (facts.where.length === 0 && facts.writers.length === 0 && facts.shift === null) return PASS;
  if (facts.where.length === 0) {
    return verdict(["no --where entry was given; pass every path the task may write, spelled as the request's Where line spells it"]);
  }
  const parsed = parseRequestLines(facts.request);
  if (!parsed.ok) return verdict([`--where cannot be checked against the request: ${parsed.reason}`]);
  const stated = new Set(words(parsed.lines.where));
  const problems: string[] = [];
  for (const entry of new Set(facts.where)) {
    const invalid = invalidPath(entry);
    if (invalid !== null) {
      problems.push(`--where ${JSON.stringify(entry)} is not a repository path: ${invalid}`);
      continue;
    }
    if (!stated.has(entry)) {
      problems.push(`--where ${entry} does not appear verbatim in the request's Where line; add it there or drop it`);
      continue;
    }
    if (facts.shift !== null && !facts.shift.builderWrites.some((glob) => covers(entry, glob))) {
      problems.push(`--where ${entry} is outside what a shift builder can write (${facts.shift.builderWrites.join(", ") || "nothing"}); a shift cannot carry it`);
      continue;
    }
    if (!facts.writers.some((writer) => writer.writes.some((glob) => covers(entry, glob)))) {
      const roles = facts.writers.map((writer) => writer.phase).join(", ") || "none";
      problems.push(`--where ${entry} is outside the writes of every writing role on this recipe (${roles}); no phase could write it`);
    }
  }
  return verdict(problems);
}

// ---------------------------------------------------------------- protected-paths

export interface ProtectedPathsFacts {
  readonly request: string;
  readonly where: readonly string[];
  readonly read: readonly string[];
  /** `policy.protected_paths`, as configured. */
  readonly protectedPaths: readonly string[];
  readonly writers: readonly WritingPhase[];
  readonly shift: ShiftFacts | null;
}

export interface ProtectedPathsResult {
  readonly verdict: FieldVerdict;
  /** One grant requirement per protected path the request writes and each phase whose role writes it. */
  readonly plan: readonly ProtectedPlanEntry[];
}

interface ProtectedHit {
  readonly token: string;
  readonly path: string;
  readonly glob: string;
}

function protectedHits(facts: ProtectedPathsFacts): ProtectedHit[] {
  const tokens = [...extractPathTokens(facts.request)];
  // A --where entry is scanned even where the request does not spell it, so a
  // protected path it names is planned though the text leaves it out. A glob
  // that only overlaps a protected glob (core/src/*/*.ts over core/src/state/**)
  // is no hit; the run's path policy is what refuses that write.
  for (const entry of facts.where) {
    if (invalidPath(entry) === null) tokens.push({ text: entry, candidates: [entry] });
  }
  const hits = new Map<string, ProtectedHit>();
  for (const token of tokens) {
    for (const candidate of token.candidates) {
      for (const glob of facts.protectedPaths) {
        const path = protectedSpelling(candidate, glob);
        if (path !== null && !hits.has(path)) hits.set(path, { token: token.text, path, glob });
      }
    }
  }
  // A --where glob broader than a protected glob writes all of it, though no
  // spelling falls under it: `core/src/**` over `core/src/state/**`. The
  // protected glob itself is then the hit, matched as widely as the scan.
  for (const entry of facts.where) {
    if (invalidPath(entry) !== null) continue;
    for (const glob of facts.protectedPaths) {
      if (!hits.has(glob) && covers(glob, entry, false)) hits.set(glob, { token: glob, path: glob, glob });
    }
  }
  return [...hits.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/**
 * Every path-shaped token in the whole request that matches a protected glob,
 * and every protected glob a `--where` entry covers, must be classified: in
 * `--read` it is only read; in `--where` it becomes a grant requirement for
 * each phase whose role writes it, and on a shift a refusal. Read wins over a
 * `--where` glob that merely covers the path; naming the same path exactly in
 * both lists is a contradiction.
 */
export function evaluateProtectedPaths(facts: ProtectedPathsFacts): ProtectedPathsResult {
  const problems: string[] = [];
  for (const entry of new Set(facts.read)) {
    const invalid = invalidPath(entry);
    if (invalid !== null) problems.push(`--read ${JSON.stringify(entry)} is not a repository path: ${invalid}`);
  }
  const plan = new Map<string, ProtectedPlanEntry>();
  for (const hit of protectedHits(facts)) {
    const named = hit.token === hit.path ? hit.path : `${hit.token} (${hit.path})`;
    const writes = facts.where.filter((entry) => classifies(entry, hit.path));
    const reads = facts.read.some((entry) => classifies(entry, hit.path));
    if (writes.length === 0 && !reads) {
      problems.push(`${named} is protected by ${hit.glob} and unclassified; pass it with --read if the task only reads it, or with --where if it writes it`);
    } else if (reads && writes.some((entry) => entry === hit.path || entry === hit.token)) {
      problems.push(`${hit.path} is named in both --where and --read; a protected path is either written or only read`);
    } else if (!reads && facts.shift !== null) {
      problems.push(`${hit.path} is protected by ${hit.glob} and in --where on a shift; a shift cannot write a protected path`);
    } else if (!reads) {
      const phases = facts.writers.filter((writer) => writer.writes.some((glob) => covers(hit.path, glob)));
      if (phases.length === 0) {
        const roles = facts.writers.map((writer) => writer.phase).join(", ") || "none";
        problems.push(`${hit.path} is protected and in --where, but no writing role on this recipe (${roles}) writes it, so no grant could be issued`);
      }
      for (const { phase } of phases) plan.set(`${hit.path}\u0000${phase}`, Object.freeze({ path: hit.path, phase }));
    }
  }
  const entries = [...plan.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, entry]) => entry);
  return Object.freeze({ verdict: verdict(problems), plan: Object.freeze(entries) });
}

// ---------------------------------------------------------------- suite

export interface SuiteFacts {
  /** The base L1 would pin. */
  readonly baseSha: string;
  readonly configuredGateIds: readonly string[];
  /** `gatesConfigDigest` of the current configuration's gates. */
  readonly gatesConfigDigest: string;
  /** The rows gathered, from the landed attempt at the base or the baseline worktree; null when none could be. */
  readonly suite: PreflightSuite | null;
  /** Why no row could be gathered, in the host's words, when `suite` is null. */
  readonly unavailable: string | null;
}

/** A passing row for every configured gate, at exactly the base, under the current gate configuration. */
export function evaluateSuite(facts: SuiteFacts): FieldVerdict {
  if (facts.configuredGateIds.length === 0) return verdict(["no gate is configured, so nothing shows the base is green"]);
  if (facts.suite === null) {
    return verdict([`no gate row was gathered at the base ${facts.baseSha}${facts.unavailable === null ? "" : `: ${facts.unavailable}`}`]);
  }
  const problems: string[] = [];
  const configured = new Set(facts.configuredGateIds);
  for (const row of facts.suite.rows) {
    if (!configured.has(row.gateId)) problems.push(`a row exists for ${row.gateId}, which is not a configured gate: the gate set changed`);
  }
  for (const gateId of facts.configuredGateIds) {
    const rows = facts.suite.rows.filter((row) => row.gateId === gateId);
    const row = rows[0];
    if (row === undefined) problems.push(`gate ${gateId} has no row at the base ${facts.baseSha}`);
    else if (rows.length > 1) problems.push(`gate ${gateId} has ${String(rows.length)} rows; exactly one is expected`);
    else if (row.sha !== facts.baseSha) problems.push(`gate ${gateId} ran at ${row.sha}, not at the base ${facts.baseSha}`);
    else if (row.gatesConfigDigest !== facts.gatesConfigDigest) problems.push(`gate ${gateId} ran under another gate configuration than the current one: the gate set changed`);
    else if (!row.passed) problems.push(`gate ${gateId} failed at the base ${facts.baseSha} (exit ${row.exitCode === null ? "none" : String(row.exitCode)}); the base is red`);
  }
  return verdict(problems);
}

// ---------------------------------------------------------------- git-storage

export interface StorageMode {
  /** What was read: the Git common directory's HEAD and config, and the worktree root. */
  readonly path: string;
  /** `stat` mode bits, or null when the entry could not be read. */
  readonly mode: number | null;
}

export interface GitStorageFacts {
  readonly entries: readonly StorageMode[];
}

/** Refuses all-0777 modes, the DrvFs signature behind forensics #36. Nothing is ever written to measure them. */
export function evaluateGitStorage(facts: GitStorageFacts): FieldVerdict {
  if (facts.entries.length === 0) return verdict(["no file mode was measured for the Git directory or the worktree root"]);
  const unreadable = facts.entries.filter((entry) => entry.mode === null);
  if (unreadable.length > 0) return verdict([`the mode of ${unreadable.map((entry) => entry.path).join(", ")} could not be read`]);
  if (facts.entries.every((entry) => ((entry.mode ?? 0) & 0o777) === 0o777)) {
    return verdict([
      `every measured entry (${facts.entries.map((entry) => entry.path).join(", ")}) reads mode 0777, the signature of a DrvFs-mounted drive; ` +
        "the Git directory and the worktree root must be on a filesystem that holds file modes",
    ]);
  }
  return PASS;
}

// ---------------------------------------------------------------- duplicate

/** The digest `duplicate` compares: the request with whitespace runs collapsed, so a re-wrapped request still matches. */
export function normalizedRequestDigest(request: string): string {
  return createHash("sha256").update(request.normalize("NFC").replace(/\s+/gu, " ").trim(), "utf8").digest("hex");
}

export interface TaskRequestFact {
  readonly taskId: string;
  readonly requestDigest: string;
  readonly planRef: string | null;
  /** The lifecycle state of the task's latest attempt. */
  readonly latestState: TaskState;
}

export interface DuplicateFacts {
  readonly taskId: string;
  /** Every task in this task's continuation chain, which may share its request. */
  readonly chain: readonly string[];
  /** `normalizedRequestDigest` of this task's request. */
  readonly requestDigest: string;
  readonly planRef: string | null;
  /** Every other task in the project. */
  readonly others: readonly TaskRequestFact[];
}

/** A latest attempt that ended BLOCKED or CANCELLED leaves its task neither live nor landed. */
const NOT_LIVE_OR_LANDED: readonly TaskState[] = ["BLOCKED", "CANCELLED"];

/** No other task outside the continuation chain with the same request or plan ref, whose latest attempt is live or landed. */
export function evaluateDuplicate(facts: DuplicateFacts): FieldVerdict {
  const problems: string[] = [];
  for (const other of facts.others) {
    if (other.taskId === facts.taskId || facts.chain.includes(other.taskId) || NOT_LIVE_OR_LANDED.includes(other.latestState)) continue;
    const sameRequest = other.requestDigest === facts.requestDigest;
    const samePlan = facts.planRef !== null && other.planRef === facts.planRef;
    if (!sameRequest && !samePlan) continue;
    const what = sameRequest && samePlan ? `the same request and plan ref ${facts.planRef ?? ""}` : sameRequest ? "the same request" : `the same plan ref ${facts.planRef ?? ""}`;
    problems.push(`task ${other.taskId} (latest attempt ${other.latestState}) already carries ${what}; continue that task or change this request`);
  }
  return verdict(problems);
}

// ---------------------------------------------------------------- prior-attempts

export interface PriorAttemptsFacts {
  /** The driver's `--consulted` session ids. */
  readonly consulted: readonly string[];
  /** The session ids the journal holds for this task's earlier attempts and every attempt of the tasks it continues. */
  readonly journal: readonly string[];
}

/** `--consulted` equals, as a set, the session ids the journal holds. */
export function evaluatePriorAttempts(facts: PriorAttemptsFacts): FieldVerdict {
  const consulted = new Set(facts.consulted);
  const journal = new Set(facts.journal);
  const missing = [...journal].filter((session) => !consulted.has(session)).sort();
  const unknown = [...consulted].filter((session) => !journal.has(session)).sort();
  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`--consulted lacks ${missing.join(", ")}, which the journal holds for this task's earlier attempts or the tasks it continues; read each and pass it`);
  }
  if (unknown.length > 0) {
    problems.push(`--consulted names ${unknown.join(", ")}, which the journal does not hold for this task's earlier attempts or the tasks it continues`);
  }
  return verdict(problems);
}

// ---------------------------------------------------------------- confirmation

export interface ConfirmationFacts {
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly requestDigest: string;
  /** `requestPathsDigest` of the `--where` and `--read` being confirmed. */
  readonly pathsDigest: string;
  /** Every request-confirmation record journaled for this attempt, oldest first. */
  readonly confirmations: readonly RequestConfirmationRecord[];
}

/** The attested field: a confirmation record exists for this attempt whose digests both match. */
export function evaluateConfirmation(facts: ConfirmationFacts): FieldVerdict {
  const own = facts.confirmations.filter((record) =>
    record.project === facts.project && record.taskId === facts.taskId && record.attempt === facts.attempt);
  if (own.some((record) => record.requestDigest === facts.requestDigest && record.pathsDigest === facts.pathsDigest)) return PASS;
  const latest = own.at(-1);
  if (latest === undefined) return verdict(["no owner confirmation of this request is recorded for this attempt"]);
  if (latest.requestDigest !== facts.requestDigest) {
    return verdict(["the owner's confirmation is bound to other request text: the request changed after it was confirmed"]);
  }
  return verdict(["the owner's confirmation is bound to other --where or --read paths: the paths changed after they were confirmed"]);
}

// ---------------------------------------------------------------- the record's fields

export interface PreflightFacts {
  readonly request: string;
  readonly where: readonly string[];
  readonly read: readonly string[];
  readonly suite: SuiteFacts;
  readonly writers: readonly WritingPhase[];
  readonly shift: ShiftFacts | null;
  readonly protectedPaths: readonly string[];
  readonly gitStorage: GitStorageFacts;
  readonly duplicate: DuplicateFacts;
  readonly priorAttempts: PriorAttemptsFacts;
  readonly confirmation: ConfirmationFacts;
}

export interface PreflightEvaluation {
  /** One result per K1 field, in K1's order: the record's `fields`. */
  readonly fields: readonly K1FieldResult[];
  readonly protectedPlan: readonly ProtectedPlanEntry[];
}

function result(id: K1FieldId, outcome: FieldVerdict): K1FieldResult {
  const kind = k1FieldKind(id);
  return Object.freeze(outcome.passed ? { id, kind, passed: true, reason: null } : { id, kind, passed: false, reason: outcome.reason });
}

/** Evaluates every K1 field over gathered facts. */
export function evaluatePreflightFields(facts: PreflightFacts): PreflightEvaluation {
  const protectedPaths = evaluateProtectedPaths(facts);
  const verdicts: Record<K1FieldId, FieldVerdict> = {
    suite: evaluateSuite(facts.suite),
    "write-boundary": evaluateWriteBoundary(facts),
    "protected-paths": protectedPaths.verdict,
    "git-storage": evaluateGitStorage(facts.gitStorage),
    duplicate: evaluateDuplicate(facts.duplicate),
    "request-shape": evaluateRequestShape(facts.request),
    "prior-attempts": evaluatePriorAttempts(facts.priorAttempts),
    confirmation: evaluateConfirmation(facts.confirmation),
  };
  return Object.freeze({
    fields: Object.freeze(K1_FIELD_IDS.map((id) => result(id, verdicts[id]))),
    protectedPlan: protectedPaths.plan,
  });
}

// ---------------------------------------------------------------- freshness

export { FRESHNESS_REFUSALS, type FreshnessRefusal };

export interface FreshnessFailure {
  readonly passed: false;
  readonly refusal: FreshnessRefusal;
  readonly field: K1FieldId | null;
  readonly reason: string;
}

export type FreshnessVerdict = { readonly passed: true } | FreshnessFailure;

export interface FreshnessFacts {
  /** The attempt's latest driver-preflight record, or null when none is journaled. */
  readonly record: DriverPreflightRecord | null;
  readonly current: {
    readonly project: string;
    readonly taskId: string;
    readonly attempt: number;
    readonly baseSha: string;
    readonly configDigest: string;
    readonly requestDigest: string;
  };
  /** Re-measured at start: both can change between preflight and start. */
  readonly gitStorage: GitStorageFacts;
  readonly duplicate: DuplicateFacts;
  readonly confirmations: readonly RequestConfirmationRecord[];
}

function stale(refusal: FreshnessRefusal, reason: string): FreshnessFailure {
  return Object.freeze({ passed: false, refusal, field: null, reason });
}

/**
 * Every refusal K1's freshness rule finds, in its order. A missing or stale
 * record is the only refusal, because its field results describe other facts;
 * otherwise each failing field in K1's order is one. Empty when L1 may fire.
 */
export function freshnessRefusals(facts: FreshnessFacts): readonly FreshnessFailure[] {
  const { record, current } = facts;
  if (record === null) return [stale("no-record", "no driver preflight record is journaled for this attempt")];
  if (record.project !== current.project || record.taskId !== current.taskId || record.attempt !== current.attempt) {
    return [stale("other-attempt", `the preflight record is for ${record.taskId} attempt ${String(record.attempt)}, not ${current.taskId} attempt ${String(current.attempt)}`)];
  }
  if (record.baseSha !== current.baseSha) {
    return [stale("stale-base", `the base moved from ${record.baseSha} to ${current.baseSha} since the preflight record was measured`)];
  }
  if (record.configDigest !== current.configDigest) {
    return [stale("stale-config", "the configuration changed since the preflight record was measured")];
  }
  if (record.requestDigest !== current.requestDigest) {
    return [stale("stale-request", "the request was edited since the preflight record was measured")];
  }
  const failures: FreshnessFailure[] = [];
  const recorded = new Map(record.fields.map((field) => [field.id, field]));
  for (const id of K1_FIELD_IDS) {
    let outcome: FieldVerdict;
    if (id === "git-storage") outcome = evaluateGitStorage(facts.gitStorage);
    else if (id === "duplicate") outcome = evaluateDuplicate(facts.duplicate);
    else if (id === "confirmation") {
      outcome = evaluateConfirmation({
        project: record.project,
        taskId: record.taskId,
        attempt: record.attempt,
        requestDigest: record.requestDigest,
        pathsDigest: requestPathsDigest(record.where, record.read),
        confirmations: facts.confirmations,
      });
    } else {
      const field = recorded.get(id);
      outcome = field === undefined
        ? { passed: false, reason: `the preflight record holds no result for ${id}` }
        : field.passed ? PASS : { passed: false, reason: field.reason };
    }
    if (!outcome.passed) failures.push(Object.freeze({ passed: false, refusal: "field-failed", field: id, reason: outcome.reason }));
  }
  return Object.freeze(failures);
}

/**
 * K1's freshness rule at `awsf start`. The record must be this attempt's and
 * bound to the current base, configuration and request; then each field in K1's
 * order must pass: the recorded result for the fields measured once, the
 * re-measured facts for `git-storage` and `duplicate`, and a confirmation bound
 * to the record's request and paths. The suite is never re-run here. The first
 * stale binding or failing field is the refusal.
 */
export function evaluateFreshness(facts: FreshnessFacts): FreshnessVerdict {
  return freshnessRefusals(facts)[0] ?? Object.freeze({ passed: true });
}

// ---------------------------------------------------------------- K2's requires

/** What K2's L1 step names when no single K1 field applies: the preflight record itself. */
export const PREFLIGHT_RECORD_REQUIREMENT = "preflight-record";

export interface K1Requirement {
  readonly check: "K1";
  readonly field: K1FieldId | typeof PREFLIGHT_RECORD_REQUIREMENT;
  /** `missing`, `failed`, the stale binding's kind, or `stale` for a confirmation bound to other words. */
  readonly status: string;
}

/** One requirement per refusal, for the L1 step's `requires`. */
export function k1Requirements(refusals: readonly FreshnessFailure[], confirmations: FreshnessFacts["confirmations"]): readonly K1Requirement[] {
  return refusals.map((refusal) => {
    if (refusal.field === null) {
      return { check: "K1", field: PREFLIGHT_RECORD_REQUIREMENT, status: refusal.refusal === "no-record" ? "missing" : refusal.refusal };
    }
    if (refusal.field === "confirmation") return { check: "K1", field: "confirmation", status: confirmations.length === 0 ? "missing" : "stale" };
    return { check: "K1", field: refusal.field, status: "failed" };
  });
}
