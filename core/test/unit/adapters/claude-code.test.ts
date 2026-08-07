// The Claude Code adapter: exact argv, no child, and honest events.
//
// Two halves, matching the adapter's own. The descriptor half asserts a full
// launch down to the byte with nothing started — that is what makes "the prompt
// never rides argv" a test rather than a code review. The parser half replays
// the bytes a live `claude` process actually wrote (see
// `core/test/fixtures/providers/claude/PROVENANCE.md`) and asserts what the host
// is allowed to say about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_ADAPTER_ID,
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_PROVIDER,
  CLAUDE_TOOL_PROFILES,
  ClaudeCodeAdapter,
  MUTATING_OR_SHELL_TOOLS,
  assertSameSession,
  selectorFor,
} from "../../../src/adapters/claude-code.ts";
import {
  assertPrivateSystemPrompt,
  writeSystemPromptFile,
} from "../../../src/adapters/system-prompt-file.ts";
import type { ClaudeSessionRecord } from "../../../src/adapters/claude-code-stream.ts";
import { ENV_ALLOWLIST, ENV_INJECTED, filterEnv } from "../../../src/adapters/env.ts";
import {
  SUBSCRIPTION_COST_DISPLAY,
  formatCost,
} from "../../../src/adapters/cost-display.ts";
import {
  AdapterError,
  type ProcessRegistration,
  type ProcessSpec,
  type ProcessTransport,
} from "../../../src/adapters/interface.ts";
import {
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/normalized-events.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "providers", "claude");

const CAPTURED = join(FIXTURES, "probe-readonly-tool.jsonl");
const CANCELLED = join(FIXTURES, "probe-readonly-tool.cancelled.jsonl");
const QUOTA_RATE_LIMIT = join(FIXTURES, "derived-quota-rate-limit.jsonl");
const QUOTA_RESULT = join(FIXTURES, "derived-quota-result-error.jsonl");

const REQUEST = {
  model: "claude:sonnet",
  prompt: "summarize the repository",
  cwd: "/tmp/work",
  env: { PATH: "/usr/bin", HOME: "/home/owner" },
  effort: "low",
  profile: "readonly",
};

function adapter(): ClaudeCodeAdapter {
  let tick = 0;
  return new ClaudeCodeAdapter({
    now: () => `2026-08-07T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
}

// ---------------------------------------------------------------------------
// The descriptor. Byte-exact, and the ORDER is part of the assertion.
// ---------------------------------------------------------------------------

test("buildSpec produces the plan's argv byte for byte, in order", () => {
  const spec = adapter().buildSpec({ ...REQUEST, systemPromptPath: "/tmp/awsf/system-prompt.md" });
  assert.deepEqual(
    [...spec.argv],
    [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--model",
      "sonnet",
      "--no-session-persistence",
      "--effort",
      "low",
      "--append-system-prompt-file",
      "/tmp/awsf/system-prompt.md",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "Read,Glob,Grep",
      "--disallowed-tools",
      "Bash,Write,Edit,NotebookEdit",
    ],
  );
  assert.equal(spec.executable, "claude");
  assert.equal(spec.shell, false);
  assert.equal(spec.cwd, "/tmp/work");
});

test("the prompt is on stdin and appears nowhere in argv", () => {
  const spec = adapter().buildSpec(REQUEST);
  assert.equal(spec.stdin, "summarize the repository");
  for (const argument of spec.argv) {
    assert.equal(argument.includes("summarize"), false, `prompt leaked into argv: ${argument}`);
  }
});

test("a system prompt reaches argv as a PATH and never as its content", () => {
  const spec = adapter().buildSpec({ ...REQUEST, systemPromptPath: "/tmp/awsf/system-prompt.md" });
  const index = spec.argv.indexOf("--append-system-prompt-file");
  assert.notEqual(index, -1);
  assert.equal(spec.argv[index + 1], "/tmp/awsf/system-prompt.md");
  // The CLI also has `--append-system-prompt <prompt>`, which takes the text
  // itself. Reaching for it would publish the system prompt to every process on
  // the machine, because argv is world readable.
  assert.equal(spec.argv.includes("--append-system-prompt"), false);
});

test("optional flags are absent — not empty — when the caller states nothing", () => {
  const spec = adapter().buildSpec({
    model: "opus",
    prompt: "p",
    cwd: "/w",
    env: {},
    profile: "readonly",
  });
  assert.equal(spec.argv.includes("--effort"), false);
  assert.equal(spec.argv.includes("--append-system-prompt-file"), false);
  assert.equal(spec.argv[spec.argv.indexOf("--model") + 1], "opus");
});

test("every tool profile gets the exact flags its ceiling requires", () => {
  const flags = (profile: string): readonly string[] =>
    adapter().buildSpec({ ...REQUEST, profile }).argv.slice(-6);
  assert.deepEqual(flags("readonly"), [
    "--permission-mode",
    "dontAsk",
    "--tools",
    "Read,Glob,Grep",
    "--disallowed-tools",
    "Bash,Write,Edit,NotebookEdit",
  ]);
  assert.deepEqual([...flags("managed-worker")].slice(-4), [
    "--permission-mode",
    "acceptEdits",
    "--tools",
    "Read,Glob,Grep,Bash,Edit,Write",
  ]);
  assert.deepEqual([...flags("no-tools")], [
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--disallowed-tools",
    "Bash,Write,Edit,NotebookEdit",
  ]);
});

test("the STRICTEST profile carries the deny list too, and does not rely on `--tools \"\"`", () => {
  // A deliberate deviation from the reviewed fusion-harness builder, which
  // passes `--tools ""` alone. Confirming the flags PARSE says nothing about
  // how they GATE: if an empty value is ever read as "flag not set" rather than
  // "allowlist with nothing in it", the narrowest profile here silently becomes
  // the widest, Bash included.
  const spec = adapter().buildSpec({ ...REQUEST, profile: "no-tools" });
  const deny = spec.argv[spec.argv.indexOf("--disallowed-tools") + 1] ?? "";
  assert.deepEqual(deny.split(","), [...MUTATING_OR_SHELL_TOOLS]);
});

test("a read-only profile denies the mutating tools EXPLICITLY, never by default", () => {
  // A default that widens in a future release would silently widen the ceiling,
  // and nothing would fail to tell us.
  const spec = adapter().buildSpec({ ...REQUEST, profile: "readonly" });
  const deny = spec.argv[spec.argv.indexOf("--disallowed-tools") + 1] ?? "";
  assert.deepEqual(deny.split(","), [...MUTATING_OR_SHELL_TOOLS]);
});

test("the profile default is the narrowest one, not the widest", () => {
  const { profile: _stated, ...unstatedRequest } = REQUEST;
  const stated = adapter().buildSpec({ ...REQUEST, profile: "readonly" });
  const unstated = adapter().buildSpec(unstatedRequest);
  assert.deepEqual([...unstated.argv], [...stated.argv]);
});

test("gate execution is refused rather than approximated", () => {
  assert.throws(
    () => adapter().buildSpec({ ...REQUEST, profile: "gate-execute" }),
    (error: unknown) =>
      error instanceof AdapterError && error.code === "E_POLICY_CEILING_UNENFORCEABLE",
  );
});

test("an unknown tool profile fails closed instead of falling back to a wider one", () => {
  assert.throws(
    () => adapter().buildSpec({ ...REQUEST, profile: "trusted" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

test("`claude:opus` and `opus` are the same route", () => {
  assert.equal(selectorFor("claude:opus"), "opus");
  assert.equal(selectorFor("opus"), "opus");
  assert.equal(selectorFor("claude-fable-5"), "claude-fable-5");
});

test("a selector the harness cannot represent never reaches a command line", () => {
  for (const bad of ["", "claude:", "opus --dangerously-skip-permissions", "-p", "a b", "o\nx"]) {
    assert.throws(
      () => selectorFor(bad),
      (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_UNRESOLVED",
      `${JSON.stringify(bad)} should not resolve`,
    );
  }
});

test("`thinking: none` becomes the CLI's lowest effort rather than no flag at all", () => {
  // Omitting `--effort` inherits whatever the CLI's default is today.
  const spec = adapter().buildSpec({ ...REQUEST, effort: "none" });
  assert.equal(spec.argv[spec.argv.indexOf("--effort") + 1], "low");
});

test("every effort level the CLI accepts passes through unchanged", () => {
  for (const level of CLAUDE_EFFORT_LEVELS) {
    const spec = adapter().buildSpec({ ...REQUEST, effort: level });
    assert.equal(spec.argv[spec.argv.indexOf("--effort") + 1], level);
  }
  assert.throws(
    () => adapter().buildSpec({ ...REQUEST, effort: "ludicrous" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

// ---------------------------------------------------------------------------
// The environment: an allowlist, plus injection that ambient values cannot win.
// ---------------------------------------------------------------------------

test("the environment is an allowlist — everything unnamed is dropped", () => {
  const spec = adapter().buildSpec({
    ...REQUEST,
    env: {
      PATH: "/usr/bin",
      HOME: "/home/owner",
      TMPDIR: "/tmp",
      ANTHROPIC_BASE_URL: "https://elsewhere.example",
      EDITOR: "vim",
    },
  });
  assert.deepEqual(Object.keys(spec.env).sort(), [...ENV_ALLOWLIST, ...Object.keys(ENV_INJECTED)].sort());
  assert.equal("ANTHROPIC_BASE_URL" in spec.env, false);
});

test("injected values are applied AFTER filtering, so an ambient value cannot override them", () => {
  const filtered = filterEnv(CLAUDE_ADAPTER_ID, { PATH: "/usr/bin", TERM: "xterm-256color", TZ: "America/Bogota" });
  assert.equal(filtered["TERM"], "dumb");
  assert.equal(filtered["TZ"], "UTC");
});

test("an allowlisted key holding credential-shaped bytes is a hard E_REDACTION", () => {
  // PATH is allowlisted because a provider cannot resolve its tools without it,
  // not because whatever is inside it is safe to hand a child.
  assert.throws(
    () => filterEnv(CLAUDE_ADAPTER_ID, { PATH: "/usr/bin:/opt/sk-abcdefghijklmnop/bin" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION",
  );
  assert.throws(
    () => filterEnv(CLAUDE_ADAPTER_ID, { HOME: "Bearer abcdefghijklmnop" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION",
  );
});

test("an absent allowlisted variable is absent, not empty", () => {
  const filtered = filterEnv(CLAUDE_ADAPTER_ID, { PATH: "/usr/bin" });
  assert.equal("TMPDIR" in filtered, false);
});

// ---------------------------------------------------------------------------
// System prompts: a mode-0600 file, never argv.
// ---------------------------------------------------------------------------

test("a system prompt is written mode 0600, and a wider one is refused at launch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-claude-test-"));
  try {
    const path = await writeSystemPromptFile("you are a careful reviewer", dir);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, "utf8"), "you are a careful reviewer");
    assertPrivateSystemPrompt(CLAUDE_ADAPTER_ID, path);

    // The file the caller hands over is not necessarily the file this adapter
    // created, so the check is at launch and not only at write.
    chmodSync(path, 0o644);
    assert.throws(
      () => assertPrivateSystemPrompt(CLAUDE_ADAPTER_ID, path),
      (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a relative or missing system prompt path is refused", () => {
  for (const path of ["system-prompt.md", "./sys.md"]) {
    assert.throws(
      () => assertPrivateSystemPrompt(CLAUDE_ADAPTER_ID, path),
      (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
    );
  }
  assert.throws(
    () => assertPrivateSystemPrompt(CLAUDE_ADAPTER_ID, "/nonexistent/awsf/system-prompt.md"),
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

// ---------------------------------------------------------------------------
// What this route can and cannot say about itself.
// ---------------------------------------------------------------------------

test("Claude Pro measures tokens and cannot price them — and says both", async () => {
  const info = await adapter().getModelInfo("claude:opus");
  assert.equal(info.adapter, CLAUDE_ADAPTER_ID);
  assert.equal(info.provider, CLAUDE_PROVIDER);
  assert.equal(info.requestedModel, "opus");
  assert.equal(info.usageAuthority, "provider");
  assert.equal(info.costAuthority, "unavailable");
  assert.equal(info.continuity, "same-session-correction");
  // `null` = this adapter declares no ceiling. Not a ceiling of zero.
  assert.equal(info.contextWindow, null);
});

test("an unpriceable route renders `— subscription`, never `$0.00`", () => {
  assert.equal(formatCost("unavailable", null), SUBSCRIPTION_COST_DISPLAY);
  // The CLI DOES report a `total_cost_usd` API-list-price estimate. Handing it
  // to a route that has said it cannot price itself must not display it.
  assert.equal(formatCost("unavailable", 0.0400983), SUBSCRIPTION_COST_DISPLAY);
  assert.equal(formatCost("unavailable", 0), SUBSCRIPTION_COST_DISPLAY);
  assert.notEqual(formatCost("unavailable", 0), "$0.00");
  // A route that can price itself still does.
  assert.equal(formatCost("provider", 0.04), "$0.04");
  assert.equal(formatCost("catalog-estimate", 0.04), "≈ $0.04");
});

test("the adapter never spawns to answer `isAvailable`", async () => {
  assert.deepEqual(await adapter().isAvailable(), { status: "available" });
  const blocked = await new ClaudeCodeAdapter({ executable: "/usr/bin/claude" }).isAvailable();
  assert.equal(blocked.status, "blocked");
});

// ---------------------------------------------------------------------------
// The parser, on CAPTURED bytes.
// ---------------------------------------------------------------------------

/** Replays a fixture file through the adapter, in one chunk. */
async function replay(
  file: string,
  options: { signal?: AbortSignal; session?: ClaudeSessionRecord; chunkSize?: number } = {},
): Promise<NormalizedEvent[]> {
  const bytes = readFileSync(file);
  const size = options.chunkSize ?? bytes.length;
  const transport = {
    runId: "run-claude-1",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-07T00:00:00.000Z" },
    async *stdout(): AsyncIterable<Uint8Array> {
      for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
    },
    stderr: (async function* () {})(),
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;
  transport.stdout = (transport as unknown as { stdout: () => AsyncIterable<Uint8Array> }).stdout();

  const events: NormalizedEvent[] = [];
  for await (const event of adapter().parse(transport, options.signal, {
    requestedModel: "sonnet",
    ...(options.session === undefined ? {} : { session: options.session }),
  })) {
    events.push(event);
  }
  return events;
}

const kinds = (events: readonly NormalizedEvent[]): string[] => events.map((e) => e.kind);
const only = <K extends NormalizedEvent["kind"]>(
  events: readonly NormalizedEvent[],
  kind: K,
): Extract<NormalizedEvent, { kind: K }>[] =>
  events.filter((e): e is Extract<NormalizedEvent, { kind: K }> => e.kind === kind);

test("the captured probe replays into a well-formed run", async () => {
  const events = await replay(CAPTURED);
  assert.deepEqual(validateEventSequence(events), []);
  assert.equal(events[0]?.kind, "run.started");
  assert.equal(events[events.length - 1]?.kind, "run.completed");
});

test("the model that answered comes from the STREAM, not from the argv that asked", async () => {
  const events = await replay(CAPTURED);
  const [resolved] = only(events, "model.resolved");
  assert.equal(resolved?.resolvedModel, "claude-sonnet-5");
  assert.equal(resolved?.requestedModel, "sonnet");
  assert.equal(resolved?.provider, CLAUDE_PROVIDER);
  assert.equal(resolved?.provenance, "stream-authoritative");
});

test("the answer text is emitted once, from the deltas — not twice", async () => {
  // `--include-partial-messages` streams the text, and the `assistant` message
  // that follows carries the same bytes assembled. Emitting both would double
  // every answer in the trace.
  const text = only(await replay(CAPTURED), "text.delta")
    .map((e) => e.text)
    .join("");
  assert.equal(text, "3");
});

test("a tool call is requested and settled explicitly, with a host-minted id", async () => {
  const events = await replay(CAPTURED);
  const [requested] = only(events, "tool.requested");
  const [completed] = only(events, "tool.completed");
  assert.equal(requested?.name, "Glob");
  assert.equal(requested?.toolCallId, "t1");
  assert.equal(completed?.toolCallId, "t1");
  assert.equal(completed?.outcome, "ok");
  assert.equal(requested?.inputSummary, '{"pattern":"*"}');
  assert.ok(completed?.resultSnippet.includes("alpha.txt"));
});

test("the provider's own tool id reaches no event", async () => {
  const events = await replay(CAPTURED);
  const raw = readFileSync(CAPTURED, "utf8");
  assert.ok(raw.includes("toolu_"), "the fixture must actually carry a provider tool id");
  assert.equal(JSON.stringify(events).includes("toolu_"), false);
});

test("usage is reported once, from the terminal — never summed across messages", async () => {
  // Every `message_delta` carries usage too, and the probe made two API calls to
  // answer one prompt. Summing them would double-count the run.
  const usage = only(await replay(CAPTURED), "usage");
  assert.equal(usage.length, 1);
  assert.deepEqual(usage[0]?.usage, {
    inputTokens: 4,
    outputTokens: 52,
    cacheReadTokens: 18021,
    cacheWriteTokens: 5549,
    // Not reported at the terminal, so null — never 0.
    reasoningTokens: null,
    // Anthropic does not state whether thinking tokens sit inside output or
    // beside it, and this harness records measured conventions only.
    reasoningRelation: "unknown",
  });
});

test("the CLI's healthy usage block produces no malformed-usage notice", async () => {
  const notices = only(await replay(CAPTURED), "notice").map((e) => e.code);
  assert.equal(notices.includes("malformed-usage"), false);
  assert.equal(notices.includes("unknown-provider-event"), false);
  assert.equal(notices.includes("non-json-output"), false);
});

test("the subscription's rate-limit telemetry is recorded even when nothing is exhausted", async () => {
  const [quota] = only(await replay(CAPTURED), "quota");
  assert.equal(quota?.scope, "five_hour");
  // `resetsAt` is epoch SECONDS on the wire; milliseconds would land in 1970.
  assert.equal(quota?.resetAt, "2026-08-08T00:00:00.000Z");
});

test("chunk boundaries do not change the run", async () => {
  const whole = await replay(CAPTURED);
  const dribbled = await replay(CAPTURED, { chunkSize: 7 });
  assert.deepEqual(kinds(dribbled), kinds(whole));
  assert.deepEqual(validateEventSequence(dribbled), []);
});

// ---------------------------------------------------------------------------
// Cancellation, on a real byte prefix of the same capture.
// ---------------------------------------------------------------------------

test("the cancelled fixture is a real byte prefix of the capture — not a rewrite", () => {
  // The fixture-integrity rule, made mechanical: this file cannot drift into
  // fiction without failing here.
  const capture = readFileSync(CAPTURED, "utf8");
  const prefix = readFileSync(CANCELLED, "utf8");
  assert.ok(capture.startsWith(prefix));
  assert.ok(prefix.length < capture.length);
  // It really does cut mid-line: that is what a killed process group leaves.
  assert.equal(prefix.endsWith("\n"), false);
});

test("a cancelled run settles its open tool call FIRST, then reports the cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("owner cancelled the phase"));
  const events = await replay(CANCELLED, { signal: controller.signal });

  assert.deepEqual(validateEventSequence(events), []);
  const settlement = events.findIndex((e) => e.kind === "tool.completed");
  const terminal = events.findIndex((e) => e.kind === "run.cancelled");
  assert.notEqual(settlement, -1, "the open tool call must be settled explicitly");
  assert.ok(settlement < terminal, "settlement comes before the terminal, never after it");
  assert.equal(only(events, "tool.completed")[0]?.outcome, "cancelled");
  assert.equal(events[events.length - 1]?.kind, "run.cancelled");
});

test("the half-written tail stays visible as a malformed line", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const notices = only(await replay(CANCELLED, { signal: controller.signal }), "notice");
  const nonJson = notices.filter((n) => n.code === "non-json-output");
  assert.equal(nonJson.length, 1);
  assert.ok(nonJson[0]?.detail?.startsWith('{"type":"stream_event"'));
});

test("a stream that stops with no terminal and no cancellation is a failure, not a success", async () => {
  const events = await replay(CANCELLED);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_TERMINAL_MISSING");
});

// ---------------------------------------------------------------------------
// Quota. Blocks with the reset time; never a retry, never a substitution.
// ---------------------------------------------------------------------------

test("a rate-limit window the CLI does not call `allowed` ends the run", async () => {
  const events = await replay(QUOTA_RATE_LIMIT);
  const [quota] = only(events, "quota");
  assert.equal(quota?.scope, "five_hour");
  assert.equal(quota?.resetAt, "2026-08-08T00:00:00.000Z");

  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
  // The quota observation precedes the terminal: a consumer reading in order
  // never has to infer why the run stopped.
  assert.ok(events.indexOf(quota as NormalizedEvent) < events.length - 1);
  assert.deepEqual(validateEventSequence(events), []);
});

test("a quota-shaped error result maps to E_QUOTA_EXHAUSTED and carries its reset", async () => {
  const events = await replay(QUOTA_RESULT);
  const quota = only(events, "quota");
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
  assert.ok(quota.some((q) => q.resetAt === "2026-08-08T00:00:00.000Z"));
  assert.deepEqual(validateEventSequence(events), []);
});

test("quota is never a retry: `execute` starts exactly one process", async () => {
  const bytes = readFileSync(QUOTA_RATE_LIMIT);
  let starts = 0;
  const broker = {
    startProcess: async (_registration: ProcessRegistration, _spec: ProcessSpec) => {
      starts += 1;
      return {
        runId: "run-claude-2",
        identity: { pid: 1, pgid: 1, startedAt: "2026-08-07T00:00:00.000Z" },
        stdout: (async function* () {
          yield bytes;
        })(),
        stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 1, signal: null }),
        cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
      } as unknown as ProcessTransport;
    },
  };
  const registration = {
    runId: "run-claude-2",
    sessionId: "s1",
    from: "RUNNING",
    to: "RUNNING",
    edge: "L10",
    reservationId: "r1",
    adapterId: CLAUDE_ADAPTER_ID,
    role: "planner",
  } as unknown as ProcessRegistration;

  const events: NormalizedEvent[] = [];
  for await (const event of adapter().execute(REQUEST, broker, registration, new AbortController().signal)) {
    events.push(event);
  }
  assert.equal(starts, 1, "a quota refusal must not launch a second process");
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
});

// ---------------------------------------------------------------------------
// Same-session correction continuity.
// ---------------------------------------------------------------------------

test("the parser reports which provider session answered, and as what", async () => {
  const session: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  await replay(CAPTURED, { session });
  assert.equal(session.sessionId, "084d92eb-02ed-400e-8c85-ec3327d90e00");
  assert.equal(session.resolvedModel, "claude-sonnet-5");
});

test("a correction that re-enters the same session and model is accepted", async () => {
  // Replaying the same captured stream twice IS the continuity case: a
  // correction is another send into the session this one opened.
  const first: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  const second: ClaudeSessionRecord = { sessionId: null, resolvedModel: null };
  await replay(CAPTURED, { session: first });
  await replay(CAPTURED, { session: second });
  assert.doesNotThrow(() => assertSameSession(first, second));
});

test("a correction in a different session is a cold restart, and is refused", () => {
  const first: ClaudeSessionRecord = { sessionId: "s-one", resolvedModel: "claude-sonnet-5" };
  assert.throws(
    () => assertSameSession(first, { sessionId: "s-two", resolvedModel: "claude-sonnet-5" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_BACKEND_FAILURE",
  );
  // A session that was never named cannot be re-entered either.
  assert.throws(
    () => assertSameSession(first, { sessionId: null, resolvedModel: "claude-sonnet-5" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_BACKEND_FAILURE",
  );
});

test("a correction answered by a different model is a mismatch, not a continuation", () => {
  assert.throws(
    () =>
      assertSameSession(
        { sessionId: "s-one", resolvedModel: "claude-sonnet-5" },
        { sessionId: "s-one", resolvedModel: "claude-haiku-4-5" },
      ),
    (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_MISMATCH",
  );
});

// ---------------------------------------------------------------------------
// Fail-closed identity, on bytes the capture itself supplies.
// ---------------------------------------------------------------------------

test("a run whose init names no model does not silently resolve to what was asked", async () => {
  const capture = readFileSync(CAPTURED, "utf8").split("\n").filter(Boolean);
  const init = capture[0]?.replace('"model":"claude-sonnet-5"', '"model":""') ?? "";
  assert.ok(init.includes('"model":""'), "the substitution must apply");
  const dir = mkdtempSync(join(tmpdir(), "awsf-claude-noident-"));
  try {
    const path = join(dir, "no-model.jsonl");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, `${init}\n${capture[capture.length - 1]}\n`);
    const events = await replay(path);
    const terminal = events[events.length - 1];
    assert.equal(terminal?.kind, "run.failed");
    assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_MODEL_UNRESOLVED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the profile vocabulary matches what `awsf.config.yaml` declares", () => {
  assert.deepEqual([...CLAUDE_TOOL_PROFILES], ["readonly", "managed-worker", "no-tools"]);
});

// ---------------------------------------------------------------------------
// Regressions. Every case below is a defect that shipped in T13's first pass
// and that this suite did not catch, because the same session wrote the parser
// and the tests and so confirmed its own assumptions twice. They are kept as a
// group rather than scattered, so the shape of what a same-family review misses
// stays visible.
// ---------------------------------------------------------------------------

/** Replays literal text as one chunk — for streams no fixture should be invented for. */
async function replayText(text: string, session?: ClaudeSessionRecord): Promise<NormalizedEvent[]> {
  const dir = mkdtempSync(join(tmpdir(), "awsf-claude-regress-"));
  try {
    const path = join(dir, "stream.jsonl");
    writeFileSync(path, text);
    return await replay(path, session === undefined ? {} : { session });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const INIT_LINE = JSON.stringify({
  type: "system",
  subtype: "init",
  model: "claude-sonnet-5",
  session_id: "s-regression",
});

test("a run whose stdout is never JSON still opens — prose is how auth failures arrive", () => {
  // The CLI prints prose to stdout when it cannot authenticate or cannot read
  // its own config. That run started and then went wrong, which is a different
  // fact from never having begun — and `validateEventSequence` checks terminals
  // and tool pairing, not openings, so nothing else catches a missing one.
  return replayText("Invalid API key. Please run /login\nnot json either\n").then((events) => {
    assert.equal(events[0]?.kind, "run.started");
    assert.equal(only(events, "notice").filter((n) => n.code === "non-json-output").length, 2);
    assert.deepEqual(validateEventSequence(events), []);
  });
});

test("a terminal with no usage block reports no usage — it is not accused of a malformed one", async () => {
  // An error result normally carries no usage at all. Emitting an all-null
  // usage event plus `malformed-usage` fired on exactly the runs that already
  // had something else wrong, which is how a notice gets trained into noise.
  const events = await replayText(
    `${INIT_LINE}\n${JSON.stringify({ type: "result", is_error: true, error: "boom" })}\n`,
  );
  assert.equal(only(events, "usage").length, 0);
  assert.equal(only(events, "notice").some((n) => n.code === "malformed-usage"), false);
  assert.equal(events[events.length - 1]?.kind, "run.failed");
});

test("a usage block that is present but unreadable still produces its fault", async () => {
  // The fix above must not turn every malformed report into five silent nulls.
  const events = await replayText(
    `${INIT_LINE}\n${JSON.stringify({ type: "result", is_error: false, usage: "lots" })}\n`,
  );
  assert.equal(only(events, "notice").some((n) => n.code === "malformed-usage"), true);
  assert.deepEqual(only(events, "usage")[0]?.usage.inputTokens, null);
});

test("`resets at <timestamp>` yields a timestamp, not the word `at` glued to one", async () => {
  // Written as one alternation, `(?:s| at|_at)?` matches the `s` first and the
  // literal `at ` lands inside the capture. The result passes the schema's
  // minLength and is simply not parseable as a date by anything downstream.
  const events = await replayText(
    `${INIT_LINE}\n${JSON.stringify({
      type: "result",
      is_error: true,
      error: "Claude AI usage limit reached. resets at 2026-08-08T00:00:00Z",
    })}\n`,
  );
  const resetAt = only(events, "quota")[0]?.resetAt ?? "";
  assert.equal(resetAt, "2026-08-08T00:00:00Z");
  assert.ok(Number.isFinite(Date.parse(resetAt)), "a resetAt nothing can parse is not a reset time");
});

test("a millisecond epoch is refused rather than multiplied into the year 58570", async () => {
  // An unreported reset is a gap; a confident nonsense one is a lie.
  const events = await replayText(
    `${INIT_LINE}\n${JSON.stringify({
      type: "result",
      is_error: true,
      error: "usage limit reached|1786147200000",
    })}\n`,
  );
  assert.equal(only(events, "quota")[0]?.resetAt, null);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
});

test("a rate-limit status that says the request was ALLOWED does not kill the run", async () => {
  // Blocking on anything but the exact string `allowed` fails closed in the
  // wrong direction: quota is never a retry, so a warning-class status costs
  // the whole phase. Genuine exhaustion still fails the API call, and the
  // result path maps that to the same code — the backstop exists either way.
  const events = await replayText(
    `${INIT_LINE}\n` +
      `${JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning", resetsAt: 1786147200, rateLimitType: "five_hour" },
      })}\n` +
      `${JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
  );
  assert.equal(only(events, "quota")[0]?.resetAt, "2026-08-08T00:00:00.000Z");
  assert.equal(events[events.length - 1]?.kind, "run.completed");
});

test("a rate-limit status that does NOT say allowed still blocks, with its reset", async () => {
  // No exhausted window has ever been captured, so unknown statuses must still
  // fail closed. Only the `allowed`-prefixed ones are exempt.
  const events = await replayText(
    `${INIT_LINE}\n` +
      `${JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "blocked", resetsAt: 1786147200, rateLimitType: "five_hour" },
      })}\n`,
  );
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
  assert.equal(only(events, "quota")[0]?.resetAt, "2026-08-08T00:00:00.000Z");
});
