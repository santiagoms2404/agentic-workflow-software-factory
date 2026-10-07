// K1's field evaluators and its freshness rule (core/src/preflight/fields.ts).
//
// Under test: each evaluator's pass and each refusal reason; the shift rules;
// the protected-paths scan on a request of forensics #34's shape, refused until
// the protected path it names as context is classified; the freshness function
// on every stale input; and the module's purity: callers gather, it judges.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../../src/config/load.ts";
import {
  DRIVER_PREFLIGHT_SCHEMA_ID,
  K1_FIELD_IDS,
  REQUEST_CONFIRMATION_SCHEMA_ID,
  assertDriverPreflightRecord,
  requestPathsDigest,
  requestTextDigest,
  type DriverPreflightRecord,
  type RequestConfirmationRecord,
  type SuiteGateRow,
} from "../../../src/contracts/driver-preflight.ts";
import {
  evaluateConfirmation,
  evaluateDuplicate,
  evaluateFreshness,
  evaluateGitStorage,
  evaluatePreflightFields,
  evaluatePriorAttempts,
  evaluateProtectedPaths,
  evaluateRequestShape,
  evaluateSuite,
  evaluateWriteBoundary,
  extractPathTokens,
  normalizedRequestDigest,
  parseRequestLines,
  type DuplicateFacts,
  type FieldVerdict,
  type FreshnessFacts,
  type PreflightFacts,
  type ProtectedPathsFacts,
  type SuiteFacts,
  type TaskRequestFact,
  type WriteBoundaryFacts,
  type WritingPhase,
} from "../../../src/preflight/fields.ts";

const BASE = "1".repeat(40);
const OTHER_SHA = "2".repeat(40);
const GATES_DIGEST = "3".repeat(64);
const CONFIG_DIGEST = "4".repeat(64);

/** A synthetic request; no owner run data. */
const REQUEST = [
  "Ask: Add the preflight evaluators.",
  "Where: core/src/preflight/**, core/test/**",
  "Done means: npm run test:unit passes.",
  "Out of scope: anything under docs/.",
].join("\n");

/** Forensics #34's shape: a protected path named as context, with a hedge about changing it. */
const REQUEST_34 = [
  "Ask: Make review transport diagnostics legible.",
  "Where: core/src/execution/review-diagnostics.ts, core/test/unit/execution/**",
  "Done means: a failed review stream names its cause in status.",
  "Out of scope: read transport-broker.ts for context before deciding whether a minimal shared change there is necessary.",
].join("\n");

const PROTECTED = loadConfig(readFileSync(resolve("awsf.config.yaml"), "utf8")).policy.protected_paths;
const BUILDER: WritingPhase = { phase: "builder", writes: ["core/src/**", "core/test/**", "dashboard/**", "prompts/**", "docs/cheatsheet.html"] };
const DOCUMENTER: WritingPhase = { phase: "documenter", writes: ["README.md", "docs/**"] };
const SHIFT = { builderWrites: BUILDER.writes };

function refused(outcome: FieldVerdict, pattern: RegExp): void {
  assert.equal(outcome.passed, false, "expected a refusal");
  if (!outcome.passed) assert.match(outcome.reason, pattern);
}

function request(where: string, outOfScope = "nothing else."): string {
  return `Ask: Do the thing.\nWhere: ${where}\nDone means: the suite passes.\nOut of scope: ${outOfScope}`;
}

// ---------------------------------------------------------------- request-shape

test("request-shape passes four labelled, ordered, non-empty lines, and joins continuation lines", () => {
  assert.deepEqual(evaluateRequestShape(REQUEST), { passed: true });
  const parsed = parseRequestLines("  Ask: one\n\nWhere: a/b.ts\n  and c/d.ts\nDone means: x\nOut of scope: y\n");
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.lines, { ask: "one", where: "a/b.ts and c/d.ts", doneMeans: "x", outOfScope: "y" });
});

test("request-shape refuses a missing, empty, out-of-order or repeated line, and text before Ask:", () => {
  refused(evaluateRequestShape("Ask: x\nWhere: a/b.ts\nDone means: y"), /no Out of scope: line/u);
  refused(evaluateRequestShape("Ask: x\nWhere:\nDone means: y\nOut of scope: z"), /Where: line is empty/u);
  refused(evaluateRequestShape("Ask: x\nDone means: y\nWhere: a/b.ts\nOut of scope: z"), /Done means: line is out of order/u);
  refused(evaluateRequestShape("Ask: x\nAsk: again\nWhere: a\nDone means: y\nOut of scope: z"), /more than one Ask: line/u);
  refused(evaluateRequestShape("Context first.\nAsk: x\nWhere: a\nDone means: y\nOut of scope: z"), /text before its Ask: line/u);
  refused(evaluateRequestShape(""), /no Ask: line/u);
});

test("request-shape refuses forensics #27's one-line request", () => {
  refused(evaluateRequestShape("Run the W16 M1 shift over specs/ and core/src/."), /text before its Ask: line/u);
  refused(evaluateRequestShape("Ask: Run the W16 M1 shift over specs/ and core/src/."), /no Where: line/u);
});

// ---------------------------------------------------------------- path tokens

test("the token scan finds paths and file names through prose punctuation, and skips plain words and URLs", () => {
  const tokens = extractPathTokens("Read `AGENTS.md`, (core/src/state/**) and ./docs/driving/x.md. See https://example.test/a.md or the plan.");
  assert.deepEqual(tokens.map((token) => token.text), ["AGENTS.md", "core/src/state/**", "./docs/driving/x.md"]);
  assert.deepEqual(tokens[2]!.candidates, ["docs/driving/x.md"]);
  const rooted = extractPathTokens("/home/someone/repo/AGENTS.md");
  assert.deepEqual(rooted[0]!.candidates, ["home/someone/repo/AGENTS.md", "someone/repo/AGENTS.md", "repo/AGENTS.md", "AGENTS.md"]);
});

// ---------------------------------------------------------------- write-boundary

function boundary(overrides: Partial<WriteBoundaryFacts> = {}): WriteBoundaryFacts {
  return { request: REQUEST, where: ["core/src/preflight/**", "core/test/**"], writers: [BUILDER], shift: null, ...overrides };
}

test("write-boundary passes entries the Where line spells verbatim and a writing role covers", () => {
  assert.deepEqual(evaluateWriteBoundary(boundary()), { passed: true });
  assert.deepEqual(evaluateWriteBoundary(boundary({ shift: SHIFT })), { passed: true });
  assert.deepEqual(evaluateWriteBoundary(boundary({ request: request("docs/cheatsheet.html."), where: ["docs/cheatsheet.html"] })), { passed: true });
});

test("write-boundary refuses no entry, an invalid entry, an entry absent from the Where line, and an uncovered entry", () => {
  refused(evaluateWriteBoundary(boundary({ where: [] })), /no --where entry was given/u);
  refused(evaluateWriteBoundary(boundary({ where: ["../outside/**"] })), /is not a repository path/u);
  refused(evaluateWriteBoundary(boundary({ where: ["core/src/cli/**"] })), /core\/src\/cli\/\*\* does not appear verbatim in the request's Where line/u);
  refused(evaluateWriteBoundary(boundary({ where: ["core/src/preflight"] })), /does not appear verbatim/u);
  refused(
    evaluateWriteBoundary(boundary({ request: request("specs/plan.html"), where: ["specs/plan.html"] })),
    /specs\/plan\.html is outside the writes of every writing role on this recipe \(builder\)/u,
  );
  refused(evaluateWriteBoundary(boundary({ request: "Ask: x", where: ["core/src/**"] })), /cannot be checked against the request: the request has no Where: line/u);
});

test("write-boundary asks nothing of a recipe with no writing phase, and still refuses any entry it is given", () => {
  assert.deepEqual(evaluateWriteBoundary(boundary({ where: [], writers: [] })), { passed: true });
  refused(evaluateWriteBoundary(boundary({ writers: [] })), /outside the writes of every writing role on this recipe \(none\)/u);
  // A shift always carries a builder, so an empty --where on one is still refused.
  refused(evaluateWriteBoundary(boundary({ where: [], writers: [], shift: SHIFT })), /no --where entry was given/u);
});

test("write-boundary does not read a glob as covered by a narrower writes glob it merely spells inside", () => {
  const narrow: WritingPhase = { phase: "builder", writes: ["core/src/*"] };
  refused(evaluateWriteBoundary(boundary({ request: request("core/src/**"), where: ["core/src/**"], writers: [narrow] })), /outside the writes/u);
  assert.deepEqual(evaluateWriteBoundary(boundary({ request: request("core/src/*.ts"), where: ["core/src/*.ts"], writers: [narrow] })), { passed: true });
});

test("write-boundary on a shift refuses a where entry outside what a shift builder can write (forensics #27)", () => {
  const facts = boundary({ request: request("specs/awsf-v2-w16.html, core/src/**"), where: ["specs/awsf-v2-w16.html", "core/src/**"], writers: [BUILDER, DOCUMENTER], shift: SHIFT });
  refused(evaluateWriteBoundary(facts), /--where specs\/awsf-v2-w16\.html is outside what a shift builder can write \(core\/src\/\*\*, .*\); a shift cannot carry it/u);
  const outcome = evaluateWriteBoundary({ ...facts, request: request("docs/notes.md"), where: ["docs/notes.md"] });
  refused(outcome, /docs\/notes\.md is outside what a shift builder can write/u);
  assert.deepEqual(evaluateWriteBoundary({ ...facts, shift: null, request: request("docs/notes.md"), where: ["docs/notes.md"] }), { passed: true },
    "the same entry passes off a shift, where the documenter writes it");
});

// ---------------------------------------------------------------- protected-paths

function guarded(overrides: Partial<ProtectedPathsFacts> = {}): ProtectedPathsFacts {
  return { request: REQUEST_34, where: [], read: [], protectedPaths: PROTECTED, writers: [BUILDER], shift: null, ...overrides };
}

test("protected-paths refuses forensics #34's request until the protected path it names as context is classified", () => {
  const unclassified = evaluateProtectedPaths(guarded());
  refused(unclassified.verdict, /transport-broker\.ts \(core\/src\/execution\/transport-broker\.ts\) is protected by core\/src\/execution\/transport-broker\.ts and unclassified; pass it with --read/u);
  assert.deepEqual(unclassified.plan, []);

  const read = evaluateProtectedPaths(guarded({ read: ["core/src/execution/transport-broker.ts"] }));
  assert.deepEqual(read.verdict, { passed: true });
  assert.deepEqual(read.plan, []);

  const written = evaluateProtectedPaths(guarded({ where: ["core/src/execution/transport-broker.ts"] }));
  assert.deepEqual(written.verdict, { passed: true });
  assert.deepEqual(written.plan, [{ path: "core/src/execution/transport-broker.ts", phase: "builder" }], "a write becomes the grant task 12 checks");
});

test("protected-paths resolves the scan's false positives by --read, never by narrowing the scan", () => {
  const prose = request("core/src/cli/**", "do not edit AGENTS.md or anything in core/src/state/, and leave docs/driving alone.");
  refused(evaluateProtectedPaths(guarded({ request: prose })).verdict, /AGENTS\.md .*unclassified.*core\/src\/state\/ \(core\/src\/state\) .*unclassified.*docs\/driving .*unclassified/u);
  const classified = evaluateProtectedPaths(guarded({ request: prose, read: ["AGENTS.md", "core/src/state/**", "docs/driving/**"] }));
  assert.deepEqual(classified.verdict, { passed: true });
  assert.deepEqual(classified.plan, []);
});

test("the scan matches protected paths named by a suffix, a directory or an outside root, and not by a bare unrelated name", () => {
  refused(evaluateProtectedPaths(guarded({ request: request("core/src/cli/**", "state/guards.ts") })).verdict, /state\/guards\.ts \(core\/src\/state\/guards\.ts\)/u);
  refused(evaluateProtectedPaths(guarded({ request: request("core/src/cli/**", "migrations/0009.sql") })).verdict, /core\/src\/observability\/migrations\/0009\.sql/u);
  refused(evaluateProtectedPaths(guarded({ request: request("core/src/cli/**", "/home/someone/repo/awsf.config.yaml") })).verdict, /awsf\.config\.yaml/u);
  assert.deepEqual(evaluateProtectedPaths(guarded({ request: request("core/src/cli/**", "guards.ts and start.ts") })).verdict, { passed: true });
});

test("protected-paths scans every --where entry, even one the request does not spell", () => {
  const outcome = evaluateProtectedPaths(guarded({ request: REQUEST, where: ["core/src/policy/path-policy.ts"] }));
  assert.deepEqual(outcome.plan, [{ path: "core/src/policy/path-policy.ts", phase: "builder" }]);
});

/** The protected globs under core/src, which a `core/src/**` --where covers whole. */
const UNDER_CORE_SRC = PROTECTED.filter((glob) => glob.startsWith("core/src/")).sort();

test("a --read entry wins over a --where glob that merely covers the protected path", () => {
  const facts = guarded({ request: request("core/src/**", "core/src/state/guards.ts is read only."), where: ["core/src/**"] });
  const covered = UNDER_CORE_SRC.map((path) => ({ path, phase: "builder" }));
  assert.deepEqual(evaluateProtectedPaths(facts).plan, [...covered, { path: "core/src/state/guards.ts", phase: "builder" }].sort((left, right) => left.path < right.path ? -1 : 1),
    "covered by where and not read: a write");
  const read = evaluateProtectedPaths({ ...facts, read: ["core/src/state/guards.ts"] });
  assert.deepEqual(read.verdict, { passed: true });
  assert.deepEqual(read.plan, covered, "reading one file leaves the protected globs the where entry covers as writes");
});

test("a --where glob broader than a protected glob is a protected hit for that glob, cleared only by --read", () => {
  assert.deepEqual(UNDER_CORE_SRC, ["core/src/execution/transport-broker.ts", "core/src/observability/migrations/**", "core/src/policy/**", "core/src/state/**"]);
  const facts = guarded({ request: request("core/src/**"), where: ["core/src/**"] });

  const onShift = evaluateProtectedPaths({ ...facts, shift: SHIFT });
  for (const glob of UNDER_CORE_SRC) {
    refused(onShift.verdict, new RegExp(`${glob.replace(/[.*]/gu, "\\$&")} is protected by .* and in --where on a shift; a shift cannot write a protected path`, "u"));
  }
  assert.deepEqual(onShift.plan, []);

  const fixer: WritingPhase = { phase: "fixer", writes: ["core/**"] };
  const written = evaluateProtectedPaths({ ...facts, writers: [BUILDER, fixer, DOCUMENTER] });
  assert.deepEqual(written.verdict, { passed: true });
  assert.deepEqual(written.plan, UNDER_CORE_SRC.flatMap((path) => [{ path, phase: "builder" }, { path, phase: "fixer" }]),
    "one grant requirement per covered protected glob and each phase whose role writes it");

  for (const shift of [null, SHIFT]) {
    const read = evaluateProtectedPaths({ ...facts, read: UNDER_CORE_SRC, shift });
    assert.deepEqual(read.verdict, { passed: true });
    assert.deepEqual(read.plan, []);
  }
  const partly = evaluateProtectedPaths({ ...facts, read: UNDER_CORE_SRC.slice(1), shift: SHIFT });
  refused(partly.verdict, /^core\/src\/execution\/transport-broker\.ts is protected by .* on a shift; a shift cannot write a protected path$/u);

  assert.deepEqual(evaluateProtectedPaths(guarded({ request: request("core/src/cli/**"), where: ["core/src/cli/**"] })).plan, [],
    "a --where glob that covers no protected glob adds no hit");
});

test("protected-paths refuses a path named exactly in both lists, an invalid --read, and a write no role can be granted", () => {
  refused(
    evaluateProtectedPaths(guarded({ where: ["core/src/execution/transport-broker.ts"], read: ["core/src/execution/transport-broker.ts"] })).verdict,
    /named in both --where and --read/u,
  );
  refused(evaluateProtectedPaths(guarded({ read: ["/abs/path"] })).verdict, /--read "\/abs\/path" is not a repository path/u);
  const ungrantable = evaluateProtectedPaths(guarded({ request: request("AGENTS.md"), where: ["AGENTS.md"] }));
  refused(ungrantable.verdict, /AGENTS\.md is protected and in --where, but no writing role on this recipe \(builder\) writes it, so no grant could be issued/u);
  assert.deepEqual(ungrantable.plan, []);
});

test("a protected --where names a grant for every phase whose role writes it", () => {
  const outcome = evaluateProtectedPaths(guarded({
    request: request("docs/driving/skills/x.md"), where: ["docs/driving/skills/x.md"], writers: [BUILDER, DOCUMENTER],
  }));
  assert.deepEqual(outcome.verdict, { passed: true });
  assert.deepEqual(outcome.plan, [{ path: "docs/driving/skills/x.md", phase: "documenter" }]);
});

test("protected-paths on a shift refuses a protected --where entry", () => {
  const outcome = evaluateProtectedPaths(guarded({ where: ["core/src/execution/transport-broker.ts"], shift: SHIFT }));
  refused(outcome.verdict, /core\/src\/execution\/transport-broker\.ts is protected by .* and in --where on a shift; a shift cannot write a protected path/u);
  assert.deepEqual(outcome.plan, []);
  assert.deepEqual(evaluateProtectedPaths(guarded({ read: ["core/src/execution/transport-broker.ts"], shift: SHIFT })).verdict, { passed: true },
    "reading a protected path on a shift is allowed");
});

// ---------------------------------------------------------------- suite

function row(overrides: Partial<SuiteGateRow> = {}): SuiteGateRow {
  return { gateId: "test", sha: BASE, gatesConfigDigest: GATES_DIGEST, passed: true, exitCode: 0, ...overrides };
}

function suite(rows: readonly SuiteGateRow[], overrides: Partial<SuiteFacts> = {}): SuiteFacts {
  return { baseSha: BASE, configuredGateIds: ["test", "lint"], gatesConfigDigest: GATES_DIGEST, suite: { source: "landed-attempt", rows: [...rows] }, unavailable: null, ...overrides };
}

test("suite passes a passing row for every configured gate at the base under the current gate configuration", () => {
  assert.deepEqual(evaluateSuite(suite([row(), row({ gateId: "lint" })])), { passed: true });
});

test("suite refuses a missing or failed row, a row at another SHA, and a changed gate set", () => {
  refused(evaluateSuite(suite([row()])), new RegExp(`gate lint has no row at the base ${BASE}`, "u"));
  refused(evaluateSuite(suite([row(), row({ gateId: "lint", passed: false, exitCode: 1 })])), /gate lint failed at the base .* \(exit 1\); the base is red/u);
  refused(evaluateSuite(suite([row(), row({ gateId: "lint", passed: false, exitCode: null })])), /\(exit none\)/u);
  refused(evaluateSuite(suite([row({ sha: OTHER_SHA }), row({ gateId: "lint" })])), new RegExp(`gate test ran at ${OTHER_SHA}, not at the base ${BASE}`, "u"));
  refused(evaluateSuite(suite([row(), row({ gateId: "lint", gatesConfigDigest: "5".repeat(64) })])), /gate lint ran under another gate configuration/u);
  refused(evaluateSuite(suite([row(), row({ gateId: "lint" }), row({ gateId: "journeys" })])), /a row exists for journeys, which is not a configured gate/u);
  refused(evaluateSuite(suite([row(), row(), row({ gateId: "lint" })])), /gate test has 2 rows/u);
});

test("suite refuses when no row was gathered, naming the host's reason, and when no gate is configured", () => {
  refused(evaluateSuite(suite([], { suite: null, unavailable: "the baseline worktree is dirty" })), /no gate row was gathered at the base .*: the baseline worktree is dirty/u);
  refused(evaluateSuite(suite([], { suite: null })), new RegExp(`no gate row was gathered at the base ${BASE}$`, "u"));
  refused(evaluateSuite(suite([], { configuredGateIds: [] })), /no gate is configured/u);
});

// ---------------------------------------------------------------- git-storage

const NATIVE = [
  { path: ".git/HEAD", mode: 0o100644 },
  { path: ".git/config", mode: 0o100644 },
  { path: "worktrees", mode: 0o40755 },
];

test("git-storage passes native file modes, including a mix with one 0777 entry", () => {
  assert.deepEqual(evaluateGitStorage({ entries: NATIVE }), { passed: true });
  assert.deepEqual(evaluateGitStorage({ entries: [...NATIVE.slice(0, 2), { path: "worktrees", mode: 0o40777 }] }), { passed: true });
});

test("git-storage refuses all-0777 modes (forensics #36), an unreadable entry and no measurement", () => {
  refused(evaluateGitStorage({ entries: NATIVE.map((entry) => ({ ...entry, mode: (entry.mode & ~0o777) | 0o777 })) }), /reads mode 0777, the signature of a DrvFs-mounted drive/u);
  refused(evaluateGitStorage({ entries: [...NATIVE.slice(0, 2), { path: "worktrees", mode: null }] }), /the mode of worktrees could not be read/u);
  refused(evaluateGitStorage({ entries: [] }), /no file mode was measured/u);
});

// ---------------------------------------------------------------- duplicate

function duplicate(overrides: Partial<DuplicateFacts> = {}): DuplicateFacts {
  return { taskId: "T", chain: ["T", "T-prior"], requestDigest: normalizedRequestDigest(REQUEST), planRef: "specs/p.html#t8", others: [], ...overrides };
}

test("duplicate passes when no other live or landed task shares the request or plan ref outside the chain", () => {
  const digest = normalizedRequestDigest(REQUEST);
  assert.deepEqual(evaluateDuplicate(duplicate({ others: [
    { taskId: "T", requestDigest: digest, planRef: "specs/p.html#t8", latestState: "DRAFT" },
    { taskId: "T-prior", requestDigest: digest, planRef: "specs/p.html#t8", latestState: "BLOCKED" },
    { taskId: "U", requestDigest: digest, planRef: null, latestState: "CANCELLED" },
    { taskId: "V", requestDigest: digest, planRef: "specs/p.html#t8", latestState: "BLOCKED" },
    { taskId: "W", requestDigest: "0".repeat(64), planRef: "specs/p.html#t9", latestState: "RUNNING" },
  ] })), { passed: true });
  assert.deepEqual(evaluateDuplicate(duplicate({ planRef: null, others: [{ taskId: "W", requestDigest: "0".repeat(64), planRef: null, latestState: "DRAFT" }] })), { passed: true },
    "a null plan ref never matches another null plan ref");
});

test("duplicate refuses a live or landed task with the same request or the same plan ref", () => {
  const digest = normalizedRequestDigest(REQUEST);
  refused(evaluateDuplicate(duplicate({ others: [{ taskId: "U", requestDigest: digest, planRef: null, latestState: "DRAFT" }] })),
    /task U \(latest attempt DRAFT\) already carries the same request/u);
  refused(evaluateDuplicate(duplicate({ others: [{ taskId: "U", requestDigest: "0".repeat(64), planRef: "specs/p.html#t8", latestState: "LANDED" }] })),
    /task U \(latest attempt LANDED\) already carries the same plan ref specs\/p\.html#t8/u);
  refused(evaluateDuplicate(duplicate({ others: [{ taskId: "U", requestDigest: digest, planRef: "specs/p.html#t8", latestState: "AWAITING_OWNER" }] })),
    /the same request and plan ref/u);
});

test("duplicate on a shared plan ref compares the shift selections: a common ticket, or neither side selecting, and never a mixed pair", () => {
  const digest = normalizedRequestDigest(REQUEST);
  const other = (tickets: readonly string[] | null | undefined, requestDigest = "0".repeat(64)): TaskRequestFact =>
    ({ taskId: "U", requestDigest, planRef: "p", ...(tickets === undefined ? {} : { tickets }), latestState: "LANDED" });
  const judge = (mine: readonly string[] | null | undefined, theirs: readonly string[] | null | undefined, requestDigest?: string): FieldVerdict =>
    evaluateDuplicate(duplicate({ planRef: "p", ...(mine === undefined ? {} : { tickets: mine }), others: [other(theirs, requestDigest)] }));
  // Two shift tasks of one plan with disjoint selections: an earlier milestone does not refuse a later one.
  assert.deepEqual(judge(["T05", "T06"], ["T01", "T02"]), { passed: true });
  // Overlapping selections select the same work.
  refused(judge(["T02", "T06"], ["T01", "T02"]), /task U \(latest attempt LANDED\) already carries the same plan ref p/u);
  // Neither carries a selection: the plan ref alone counts, whether absent or null.
  refused(judge(null, null), /the same plan ref p/u);
  refused(judge(undefined, undefined), /the same plan ref p/u);
  // A mixed pair never matches on the plan ref alone, in either direction.
  assert.deepEqual(judge(["T01"], null), { passed: true });
  assert.deepEqual(judge(null, ["T01"]), { passed: true });
  assert.deepEqual(judge(["T01"], undefined), { passed: true });
  // The same request is a duplicate whatever the selections.
  for (const [mine, theirs] of [[["T05"], ["T01"]], [["T01"], null], [null, ["T01"]], [null, null]] as const) {
    refused(judge(mine, theirs, digest), /already carries the same request/u);
  }
  refused(judge(["T01"], ["T01"], digest), /the same request and plan ref p/u);
});

test("the duplicate digest ignores re-wrapping and nothing else", () => {
  assert.equal(normalizedRequestDigest("Ask: a\n  Where: b"), normalizedRequestDigest("Ask: a Where: b "));
  assert.notEqual(normalizedRequestDigest("Ask: a"), normalizedRequestDigest("Ask: A"));
});

// ---------------------------------------------------------------- prior-attempts

test("prior-attempts passes when --consulted equals the journal's sessions as a set", () => {
  assert.deepEqual(evaluatePriorAttempts({ consulted: ["s2", "s1", "s1"], journal: ["s1", "s2"] }), { passed: true });
  assert.deepEqual(evaluatePriorAttempts({ consulted: [], journal: [] }), { passed: true });
});

test("prior-attempts refuses a missing id and an id the journal does not hold", () => {
  refused(evaluatePriorAttempts({ consulted: ["s1"], journal: ["s1", "s2"] }), /--consulted lacks s2, which the journal holds/u);
  refused(evaluatePriorAttempts({ consulted: ["s1", "made-up"], journal: ["s1"] }), /--consulted names made-up, which the journal does not hold/u);
  refused(evaluatePriorAttempts({ consulted: ["x"], journal: ["y"] }), /lacks y.*; --consulted names x/u);
});

// ---------------------------------------------------------------- confirmation

const PATHS = requestPathsDigest(["core/src/preflight/**"], []);

function confirmation(overrides: Partial<RequestConfirmationRecord> = {}): RequestConfirmationRecord {
  return {
    schema: REQUEST_CONFIRMATION_SCHEMA_ID, project: "demo", taskId: "T", attempt: 1,
    requestDigest: requestTextDigest(REQUEST), pathsDigest: PATHS, at: "2026-10-06T00:00:00.000Z", ...overrides,
  };
}

const CONFIRMING = { project: "demo", taskId: "T", attempt: 1, requestDigest: requestTextDigest(REQUEST), pathsDigest: PATHS };

test("confirmation passes when a record for this attempt binds both digests", () => {
  assert.deepEqual(evaluateConfirmation({ ...CONFIRMING, confirmations: [confirmation({ pathsDigest: "0".repeat(64) }), confirmation()] }), { passed: true });
});

test("confirmation refuses no record, a record bound to other text, and one bound to other paths", () => {
  refused(evaluateConfirmation({ ...CONFIRMING, confirmations: [] }), /no owner confirmation of this request is recorded/u);
  refused(evaluateConfirmation({ ...CONFIRMING, confirmations: [confirmation({ attempt: 2 }), confirmation({ taskId: "U" })] }), /no owner confirmation/u);
  refused(evaluateConfirmation({ ...CONFIRMING, confirmations: [confirmation({ requestDigest: requestTextDigest(`${REQUEST} `) })] }), /bound to other request text/u);
  refused(evaluateConfirmation({ ...CONFIRMING, confirmations: [confirmation({ pathsDigest: requestPathsDigest(["core/**"], []) })] }), /bound to other --where or --read paths/u);
});

// ---------------------------------------------------------------- the record's fields

function facts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
  return {
    request: REQUEST,
    where: ["core/src/preflight/**", "core/test/**"],
    read: [],
    suite: suite([row(), row({ gateId: "lint" })]),
    writers: [BUILDER],
    shift: null,
    protectedPaths: PROTECTED,
    gitStorage: { entries: NATIVE },
    duplicate: duplicate(),
    priorAttempts: { consulted: [], journal: [] },
    confirmation: { ...CONFIRMING, pathsDigest: requestPathsDigest(["core/src/preflight/**", "core/test/**"], []), confirmations: [] },
    ...overrides,
  };
}

function preflightRecord(input: PreflightFacts, overrides: Partial<DriverPreflightRecord> = {}): DriverPreflightRecord {
  const evaluated = evaluatePreflightFields(input);
  return {
    schema: DRIVER_PREFLIGHT_SCHEMA_ID, project: "demo", taskId: "T", attempt: 1, sessionId: "session-1",
    baseSha: BASE, configDigest: CONFIG_DIGEST, requestDigest: requestTextDigest(input.request),
    where: [...input.where], read: [...input.read], consulted: [...input.priorAttempts.consulted],
    fields: [...evaluated.fields], suite: input.suite.suite, protectedPlan: [...evaluated.protectedPlan],
    at: "2026-10-06T00:00:00.000Z", ...overrides,
  };
}

test("the evaluated fields are one result per K1 field, in order, and make a valid record whether or not they pass", () => {
  const evaluated = evaluatePreflightFields(facts());
  assert.deepEqual(evaluated.fields.map((field) => field.id), [...K1_FIELD_IDS]);
  assert.deepEqual(evaluated.fields.filter((field) => !field.passed).map((field) => field.id), ["confirmation"], "a preflight before confirm records the attested field as missing");
  assert.doesNotThrow(() => assertDriverPreflightRecord(preflightRecord(facts())));
  const failing = facts({ request: "one line", where: [], gitStorage: { entries: [] }, priorAttempts: { consulted: ["x"], journal: [] } });
  assert.deepEqual(evaluatePreflightFields(failing).fields.filter((field) => !field.passed).map((field) => field.id),
    ["write-boundary", "git-storage", "request-shape", "prior-attempts", "confirmation"]);
  assert.doesNotThrow(() => assertDriverPreflightRecord(preflightRecord(failing)));
});

test("the protected plan rides from the protected-paths evaluator into the record", () => {
  const evaluated = evaluatePreflightFields(facts({
    request: request("core/src/policy/path-policy.ts"), where: ["core/src/policy/path-policy.ts"],
  }));
  assert.deepEqual(evaluated.protectedPlan, [{ path: "core/src/policy/path-policy.ts", phase: "builder" }]);
  assert.equal(evaluated.fields.find((field) => field.id === "protected-paths")?.passed, true);
});

// ---------------------------------------------------------------- freshness

function freshness(overrides: Partial<FreshnessFacts> = {}): FreshnessFacts {
  const input = facts();
  const record = preflightRecord(input);
  return {
    record,
    current: { project: "demo", taskId: "T", attempt: 1, baseSha: BASE, configDigest: CONFIG_DIGEST, requestDigest: requestTextDigest(REQUEST) },
    gitStorage: { entries: NATIVE },
    duplicate: duplicate(),
    confirmations: [confirmation({ pathsDigest: requestPathsDigest(record.where, record.read) })],
    ...overrides,
  };
}

function staleAs(outcome: ReturnType<typeof evaluateFreshness>, refusal: string, field: string | null, pattern: RegExp): void {
  assert.equal(outcome.passed, false);
  if (outcome.passed) return;
  assert.equal(outcome.refusal, refusal);
  assert.equal(outcome.field, field);
  assert.match(outcome.reason, pattern);
}

test("freshness passes a current, passing, confirmed record", () => {
  assert.deepEqual(evaluateFreshness(freshness()), { passed: true });
});

test("freshness refuses a missing record, another attempt's record, and every stale binding", () => {
  const current = freshness().current;
  staleAs(evaluateFreshness(freshness({ record: null })), "no-record", null, /no driver preflight record/u);
  staleAs(evaluateFreshness(freshness({ current: { ...current, attempt: 2 } })), "other-attempt", null, /for T attempt 1, not T attempt 2/u);
  staleAs(evaluateFreshness(freshness({ current: { ...current, taskId: "U" } })), "other-attempt", null, /not U attempt 1/u);
  staleAs(evaluateFreshness(freshness({ current: { ...current, baseSha: OTHER_SHA } })), "stale-base", null, new RegExp(`moved from ${BASE} to ${OTHER_SHA}`, "u"));
  staleAs(evaluateFreshness(freshness({ current: { ...current, configDigest: "6".repeat(64) } })), "stale-config", null, /configuration changed/u);
  staleAs(evaluateFreshness(freshness({ current: { ...current, requestDigest: requestTextDigest(`${REQUEST}\nmore`) } })), "stale-request", null, /request was edited/u);
});

test("freshness refuses each recorded failing field by its own id and reason", () => {
  const base = freshness();
  for (const id of ["suite", "write-boundary", "protected-paths", "request-shape", "prior-attempts"] as const) {
    const record = { ...base.record!, fields: base.record!.fields.map((field) => field.id === id ? { id, kind: "measured" as const, passed: false as const, reason: `${id} was red` } : field) };
    staleAs(evaluateFreshness({ ...base, record }), "field-failed", id, new RegExp(`^${id} was red$`, "u"));
  }
  const missing = { ...base.record!, fields: base.record!.fields.filter((field) => field.id !== "suite") };
  staleAs(evaluateFreshness({ ...base, record: missing }), "field-failed", "suite", /holds no result for suite/u);
});

test("freshness re-measures git-storage and duplicate rather than trusting the record", () => {
  const drvfs = { entries: NATIVE.map((entry) => ({ ...entry, mode: (entry.mode & ~0o777) | 0o777 })) };
  staleAs(evaluateFreshness(freshness({ gitStorage: drvfs })), "field-failed", "git-storage", /DrvFs/u);
  const twin = duplicate({ others: [{ taskId: "U", requestDigest: normalizedRequestDigest(REQUEST), planRef: null, latestState: "PREPARED" }] });
  staleAs(evaluateFreshness(freshness({ duplicate: twin })), "field-failed", "duplicate", /task U \(latest attempt PREPARED\)/u);
  const recordedRed = freshness();
  const record = { ...recordedRed.record!, fields: recordedRed.record!.fields.map((field) => field.id === "git-storage" ? { id: field.id, kind: field.kind, passed: false as const, reason: "was 0777" } : field) };
  assert.deepEqual(evaluateFreshness({ ...recordedRed, record }), { passed: true }, "a re-measured pass replaces a recorded refusal");
});

test("freshness refuses a missing confirmation, one bound to other text, and paths edited after confirmation", () => {
  staleAs(evaluateFreshness(freshness({ confirmations: [] })), "field-failed", "confirmation", /no owner confirmation/u);
  const base = freshness();
  staleAs(evaluateFreshness({ ...base, confirmations: [confirmation({ requestDigest: requestTextDigest("Ask: other") })] }), "field-failed", "confirmation", /other request text/u);
  // The owner confirmed, then a new preflight recorded other paths for the same request.
  const edited = { ...base.record!, where: ["core/src/**"] };
  staleAs(evaluateFreshness({ ...base, record: edited }), "field-failed", "confirmation", /other --where or --read paths/u);
});

test("freshness names the first failing field in K1's order", () => {
  const base = freshness();
  const record = { ...base.record!, fields: base.record!.fields.map((field) =>
    field.id === "prior-attempts" ? { id: field.id, kind: field.kind, passed: false as const, reason: "later" } : field) };
  staleAs(evaluateFreshness({ ...base, record, gitStorage: { entries: [] }, confirmations: [] }), "field-failed", "git-storage", /no file mode/u);
});

// ---------------------------------------------------------------- purity

test("fields.ts reads no file, runs no Git and asks no clock: it imports only pure modules", () => {
  const source = readFileSync(resolve("core/src/preflight/fields.ts"), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["../contracts/driver-preflight.ts", "../policy/path-policy.ts", "../state/task-machine.ts", "node:crypto"]);
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/**")).join("\n");
  for (const forbidden of [/\bDate\b/u, /\bprocess\./u, /\brequire\(/u, /\bimport\(/u, /\bsetTimeout\b/u, /\bperformance\b/u]) {
    assert.doesNotMatch(code, forbidden);
  }
});
