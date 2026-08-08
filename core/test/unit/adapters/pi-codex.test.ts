// The pi/Codex adapter: exact argv, no child, and honest events.
//
// Two halves, matching the adapter's own. The descriptor half asserts a full
// launch down to the byte with nothing started — that is what makes "the prompt
// never rides argv" a test rather than a code review. The parser half replays
// the bytes a live `pi` process actually wrote (see
// `core/test/fixtures/providers/codex/PROVENANCE.md`) and asserts what the host
// is allowed to say about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TOOL_PROFILE,
  PI_ADAPTER_ID,
  PI_MANAGED_WORKER_TOOLS,
  PI_PROVIDER,
  PI_READONLY_TOOLS,
  PI_THINKING_LEVELS,
  PI_TOOL_PROFILES,
  PiCodexAdapter,
  assertSameSession,
  selectorFor,
} from "../../../src/adapters/pi-codex.ts";
import {
  epochMillisToIso,
  type PiSessionRecord,
} from "../../../src/adapters/pi-codex-stream.ts";
import { ENV_ALLOWLIST, ENV_INJECTED, filterEnv } from "../../../src/adapters/env.ts";
import { formatCost } from "../../../src/adapters/cost-display.ts";
import { assertPrivateSystemPrompt } from "../../../src/adapters/system-prompt-file.ts";
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

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "providers", "codex");

const CAPTURED = join(FIXTURES, "probe-readonly-tool.jsonl");
const CANCELLED = join(FIXTURES, "probe-readonly-tool.cancelled.jsonl");
const QUOTA = join(FIXTURES, "derived-quota-error.jsonl");

const REQUEST = {
  model: "codex:gpt-5.6-sol",
  prompt: "summarize the repository",
  cwd: "/tmp/work",
  env: { PATH: "/usr/bin", HOME: "/home/owner" },
  effort: "high",
  profile: "readonly",
};

function adapter(): PiCodexAdapter {
  let tick = 0;
  return new PiCodexAdapter({
    now: () => `2026-08-08T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    // Short, so the "the process never exited" path is a test that runs in
    // milliseconds rather than a timeout nobody waits for.
    exitWaitMs: 25,
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
      "--mode",
      "json",
      "-p",
      "--provider",
      "openai-codex",
      "--model",
      "gpt-5.6-sol",
      "--no-session",
      "--thinking",
      "high",
      "--append-system-prompt",
      "/tmp/awsf/system-prompt.md",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--tools",
      "read,grep,find,ls",
    ],
  );
  assert.equal(spec.executable, "pi");
  assert.equal(spec.shell, false);
  assert.equal(spec.cwd, "/tmp/work");
});

test("the recursion guard is on every launch this adapter builds", () => {
  // `--no-extensions` is load-bearing: without it a pi child discovers and
  // loads this harness's own extensions, and a worker becomes a second
  // orchestrator. The plan calls it out by name; the Stop-when asks for it to
  // be asserted here rather than trusted to the argv list above.
  for (const profile of [...PI_TOOL_PROFILES, undefined]) {
    const spec = adapter().buildSpec({
      ...REQUEST,
      ...(profile === undefined ? {} : { profile }),
    });
    assert.ok(spec.argv.includes("--no-extensions"), `profile ${String(profile)} dropped the guard`);
  }
  // And it is not conditional on the optional flags either.
  const bare = adapter().buildSpec({ model: "gpt-5.4", prompt: "p", cwd: "/w", env: {} });
  assert.ok(bare.argv.includes("--no-extensions"));
});

test("the four other clean-room flags travel with it, so the run has no ambient state", () => {
  const spec = adapter().buildSpec(REQUEST);
  for (const flag of ["--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
    assert.ok(spec.argv.includes(flag), `missing ${flag}`);
  }
  // `--no-session` is the fifth: this harness owns continuity, and a session
  // file written under the operator's home directory is state nobody replays.
  assert.ok(spec.argv.includes("--no-session"));
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
  const index = spec.argv.indexOf("--append-system-prompt");
  assert.notEqual(index, -1);
  assert.equal(spec.argv[index + 1], "/tmp/awsf/system-prompt.md");
  // pi's flag takes text OR a path and decides with `existsSync`. Putting the
  // TEXT there would publish the system prompt to every process on the machine,
  // because argv is world readable.
  assert.equal(spec.argv.includes("--system-prompt"), false);
});

test("optional flags are absent — not empty — when the caller states nothing", () => {
  const spec = adapter().buildSpec({
    model: "gpt-5.6-sol",
    prompt: "p",
    cwd: "/w",
    env: {},
    profile: "readonly",
  });
  assert.equal(spec.argv.includes("--thinking"), false);
  assert.equal(spec.argv.includes("--append-system-prompt"), false);
  assert.equal(spec.argv[spec.argv.indexOf("--model") + 1], "gpt-5.6-sol");
});

test("every tool profile gets the exact flags its ceiling requires", () => {
  const tail = (profile: string, count: number): readonly string[] =>
    adapter().buildSpec({ ...REQUEST, profile }).argv.slice(-count);
  assert.deepEqual(tail("readonly", 2), ["--tools", "read,grep,find,ls"]);
  assert.deepEqual(tail("managed-worker", 2), ["--tools", "read,grep,find,ls,bash,edit,write"]);
  // The narrowest profile is a boolean flag, not an empty allowlist — there is
  // no `--tools ""` here to be misread as "the flag was not set", which is why
  // T13's explicit-deny-list deviation has nothing to fix on this route.
  assert.deepEqual(tail("no-tools", 1), ["--no-tools"]);
  assert.equal(adapter().buildSpec({ ...REQUEST, profile: "no-tools" }).argv.includes("--tools"), false);
});

test("the tool names are pi's own, not the Claude adapter's", () => {
  // `read,grep,find,ls` and `Read,Glob,Grep` are two CLIs' vocabularies. A
  // profile that shipped one provider's names to the other would narrow
  // nothing, because an allowlist of names that do not exist is an allowlist of
  // nothing — or, worse, is ignored.
  assert.deepEqual([...PI_READONLY_TOOLS], ["read", "grep", "find", "ls"]);
  assert.deepEqual([...PI_MANAGED_WORKER_TOOLS], [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
  ]);
});

test("the profile default is the narrowest one, not the widest", () => {
  const { profile: _stated, ...unstatedRequest } = REQUEST;
  const stated = adapter().buildSpec({ ...REQUEST, profile: DEFAULT_TOOL_PROFILE });
  const unstated = adapter().buildSpec(unstatedRequest);
  assert.deepEqual([...unstated.argv], [...stated.argv]);
  assert.equal(DEFAULT_TOOL_PROFILE, "readonly");
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

test("`codex:gpt-5.6-sol` and `gpt-5.6-sol` are the same route", () => {
  assert.equal(selectorFor("codex:gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(selectorFor("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(selectorFor("gpt-5.3-codex-spark"), "gpt-5.3-codex-spark");
});

test("a selector that would smuggle a second provider past `--provider` is refused", () => {
  // `pi --model` accepts a `provider/id` form. A slash-bearing selector would
  // name a provider from inside a flag that has already been told which
  // provider to use — and the one on the command line would lose.
  assert.throws(
    () => selectorFor("anthropic/claude-opus-5"),
    (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_UNRESOLVED",
  );
});

test("a selector carrying pi's `:<thinking>` shorthand is refused, not silently obeyed", () => {
  // It would outrank the `--thinking` this adapter puts on the line from the
  // agent's configured level, and nothing downstream would record that it did.
  for (const bad of ["codex:gpt-5.6-sol:high", "gpt-5.6-sol:max"]) {
    assert.throws(
      () => selectorFor(bad),
      (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_UNRESOLVED",
      `${JSON.stringify(bad)} should not resolve`,
    );
  }
});

test("a selector the harness cannot represent never reaches a command line", () => {
  for (const bad of ["", "codex:", "gpt-5.6-sol --no-approve", "-p", "a b", "g\nx"]) {
    assert.throws(
      () => selectorFor(bad),
      (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_UNRESOLVED",
      `${JSON.stringify(bad)} should not resolve`,
    );
  }
});

test("`thinking: none` becomes pi's real off switch, not a floor", () => {
  // T13 had to floor `none` at `low` because the Claude CLI has no off switch.
  // pi has one, so the harness says what it means.
  const spec = adapter().buildSpec({ ...REQUEST, effort: "none" });
  assert.equal(spec.argv[spec.argv.indexOf("--thinking") + 1], "off");
});

test("every thinking level the CLI accepts passes through unchanged", () => {
  for (const level of PI_THINKING_LEVELS) {
    const spec = adapter().buildSpec({ ...REQUEST, effort: level });
    assert.equal(spec.argv[spec.argv.indexOf("--thinking") + 1], level);
  }
  assert.throws(
    () => adapter().buildSpec({ ...REQUEST, effort: "ludicrous" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

test("the provider on the command line is pinned, not taken from a caller", () => {
  const spec = adapter().buildSpec(REQUEST);
  assert.equal(spec.argv[spec.argv.indexOf("--provider") + 1], PI_PROVIDER);
  assert.equal(PI_PROVIDER, "openai-codex");
});

// ---------------------------------------------------------------------------
// The environment: the same allowlist T13 uses, exercised on this route too.
// ---------------------------------------------------------------------------

test("the environment is an allowlist — everything unnamed is dropped", () => {
  const spec = adapter().buildSpec({
    ...REQUEST,
    env: {
      PATH: "/usr/bin",
      HOME: "/home/owner",
      TMPDIR: "/tmp",
      OPENAI_API_KEY: "sk-not-a-real-key-abcdefgh",
      EDITOR: "vim",
    },
  });
  assert.deepEqual(
    Object.keys(spec.env).sort(),
    [...ENV_ALLOWLIST, ...Object.keys(ENV_INJECTED)].sort(),
  );
  assert.equal("OPENAI_API_KEY" in spec.env, false);
});

test("an allowlisted key holding credential-shaped bytes is a hard E_REDACTION", () => {
  assert.throws(
    () => filterEnv(PI_ADAPTER_ID, { PATH: "/usr/bin:/opt/sk-abcdefghijklmnop/bin" }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_REDACTION",
  );
});

// ---------------------------------------------------------------------------
// What this route can and cannot say about itself.
// ---------------------------------------------------------------------------

test("ChatGPT Plus measures tokens AND prices them — and says both", async () => {
  const info = await adapter().getModelInfo("codex:gpt-5.6-sol");
  assert.equal(info.adapter, PI_ADAPTER_ID);
  assert.equal(info.provider, PI_PROVIDER);
  assert.equal(info.requestedModel, "gpt-5.6-sol");
  assert.equal(info.usageAuthority, "provider");
  // The whole difference from T13's route, in one field.
  assert.equal(info.costAuthority, "provider");
  assert.equal(info.continuity, "same-session-correction");
  // `null` = this adapter declares no ceiling. Not a ceiling of zero.
  assert.equal(info.contextWindow, null);
});

test("a priced route renders money, where the subscription route renders a dash", () => {
  // `formatCost`'s money branch, first exercised for real by this adapter.
  assert.equal(formatCost("provider", 0.0123), "$0.01");
  assert.equal(formatCost("provider", 1.5), "$1.50");
  // A provider that reported zero cost reported DATA, and `provider` is the one
  // authority allowed to say `$0.00` — because it measured it.
  assert.equal(formatCost("provider", 0), "$0.00");
  // Not yet reported is still a dash, even on an authority that has figures.
  assert.equal(formatCost("provider", null), "—");
});

test("the adapter never spawns to answer `isAvailable`", async () => {
  assert.deepEqual(await adapter().isAvailable(), { status: "available" });
  const blocked = await new PiCodexAdapter({ executable: "/usr/bin/pi" }).isAvailable();
  assert.equal(blocked.status, "blocked");
});

test("the profile vocabulary matches what `awsf.config.yaml` declares", () => {
  assert.deepEqual([...PI_TOOL_PROFILES], ["readonly", "managed-worker", "no-tools"]);
});

// ---------------------------------------------------------------------------
// The parser, on CAPTURED bytes.
// ---------------------------------------------------------------------------

/** Replays a fixture file through the adapter, in one chunk unless asked otherwise. */
async function replay(
  file: string,
  options: {
    signal?: AbortSignal;
    session?: PiSessionRecord;
    chunkSize?: number;
    exit?: { code: number | null; signal: string | null } | "never";
    stderr?: string;
  } = {},
): Promise<NormalizedEvent[]> {
  const bytes = readFileSync(file);
  const size = options.chunkSize ?? bytes.length;
  const stderrText = options.stderr ?? "";
  const transport = {
    runId: "run-pi-1",
    identity: { pid: 1, pgid: 1, startedAt: "2026-08-08T00:00:00.000Z" },
    async *stdout(): AsyncIterable<Uint8Array> {
      for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
    },
    stderr: (async function* () {
      if (stderrText.length > 0) yield new TextEncoder().encode(stderrText);
    })(),
    exit:
      options.exit === "never"
        ? new Promise(() => {})
        : Promise.resolve(options.exit ?? { code: 0, signal: null }),
    cancel: async () => ({ termSent: true, killSent: false, survivors: [], terminated: [] }),
  } as unknown as ProcessTransport;
  transport.stdout = (transport as unknown as { stdout: () => AsyncIterable<Uint8Array> }).stdout();

  const events: NormalizedEvent[] = [];
  for await (const event of adapter().parse(transport, options.signal, {
    requestedModel: "gpt-5.6-sol",
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
  assert.equal(resolved?.resolvedModel, "gpt-5.6-sol");
  assert.equal(resolved?.requestedModel, "gpt-5.6-sol");
  // The stream names its own provider, and this is that value — not the
  // constant this adapter pinned on the command line.
  assert.equal(resolved?.provider, "openai-codex");
  assert.equal(resolved?.provenance, "stream-authoritative");
});

test("the run answers on ONE model across both of its turns", async () => {
  // The capture is a two-turn run. A second identity claim that disagreed would
  // be `E_MODEL_MISMATCH`; an identical one is not re-emitted.
  const resolved = only(await replay(CAPTURED), "model.resolved");
  assert.equal(resolved.length, 1);
});

test("the answer text is emitted once, from the deltas — not twice", async () => {
  // `text_end` carries the assembled text the deltas already streamed, and the
  // final `message_end` carries it a third time. Emitting them would triple
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
  assert.equal(requested?.name, "ls");
  assert.equal(requested?.toolCallId, "t1");
  assert.equal(completed?.toolCallId, "t1");
  assert.equal(completed?.outcome, "ok");
  assert.equal(requested?.inputSummary, "{}");
  // The result's text blocks are unwrapped, so the snippet is the answer rather
  // than the envelope around it.
  assert.equal(completed?.resultSnippet, "alpha.txt\nbeta.txt\ngamma.txt");
});

test("the tool is opened ONCE even though two captured lines announce it", async () => {
  // `toolcall_end` opens it and `tool_execution_start` finds it already open.
  // Opening twice would be `tool-id-reused`; opening on neither would settle a
  // call the host never opened.
  const events = await replay(CAPTURED);
  assert.equal(only(events, "tool.requested").length, 1);
  assert.equal(only(events, "tool.completed").length, 1);
});

test("the provider's own tool id reaches no event", async () => {
  const events = await replay(CAPTURED);
  const raw = readFileSync(CAPTURED, "utf8");
  assert.ok(raw.includes("call_"), "the fixture must actually carry a provider tool id");
  assert.equal(JSON.stringify(events).includes("call_"), false);
});

test("usage is reported PER TURN and summed — because pi reports no run total", async () => {
  // The exact inverse of T13's rule, and for a provider-shaped reason: the
  // Claude CLI reports a running block plus a true total, so summing would
  // double-count; pi reports per turn and `agent_end` carries no total at all,
  // so the last turn alone would understate a two-call run.
  const usage = only(await replay(CAPTURED), "usage");
  assert.equal(usage.length, 2);
  assert.deepEqual(usage[0]?.usage, {
    inputTokens: 985,
    outputTokens: 14,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    reasoningRelation: "included-in-output",
  });
  assert.deepEqual(usage[1]?.usage, {
    inputTokens: 1018,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    reasoningRelation: "included-in-output",
  });
});

test("a zero the provider reported is DATA, not a missing metric", async () => {
  // `cacheRead: 0` came off the wire. `null` would say pi did not report it,
  // which is a different and false statement.
  const [first] = only(await replay(CAPTURED), "usage");
  assert.equal(first?.usage.cacheReadTokens, 0);
  assert.notEqual(first?.usage.cacheReadTokens, null);
});

test("pi's healthy usage block produces no malformed-usage notice", async () => {
  // `totalTokens` and `cost` are dropped by the explicit mapping rather than
  // forwarded, or every healthy run would carry a fault about them.
  const notices = only(await replay(CAPTURED), "notice").map((e) => e.code);
  assert.equal(notices.includes("malformed-usage"), false);
  assert.equal(notices.includes("unknown-provider-event"), false);
  assert.equal(notices.includes("non-json-output"), false);
});

test("the provider's own price is summed across turns and rendered as money", async () => {
  // The first route in this harness whose cost is a figure rather than a dash.
  const session: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  await replay(CAPTURED, { session });
  assert.ok(session.costUsd !== null);
  // 0.005345… + 0.005240… — both figures pi computed and reported.
  assert.ok(Math.abs((session.costUsd ?? 0) - 0.010585) < 1e-9, String(session.costUsd));
  assert.equal(formatCost("provider", session.costUsd), "$0.01");
});

test("money is not an event kind — no normalized event carries a price", async () => {
  // The twelve carry tokens. A cost field on `usage` would make every route
  // that cannot price itself look like it reported zero.
  const events = await replay(CAPTURED);
  for (const usage of only(events, "usage")) {
    assert.equal("cost" in usage.usage, false);
    assert.equal("totalTokens" in usage.usage, false);
  }
});

test("`agent_end` is not the terminal — `agent_settled` is", async () => {
  // `agent_end` carries `willRetry`, so pi emits it again after an internal
  // retry. Terminating there would end a run that was about to continue.
  const raw = readFileSync(CAPTURED, "utf8");
  assert.ok(raw.includes('"type":"agent_end"'));
  assert.ok(raw.includes('"type":"agent_settled"'));
  const events = await replay(CAPTURED);
  assert.equal(events.filter((e) => e.kind === "run.completed").length, 1);
});

test("the exit code on a completed run is MEASURED, not assumed", async () => {
  // The decoder mints the terminal when it sees `agent_settled`; the process's
  // real code arrives later, on `transport.exit`. The terminal is held back
  // until it does.
  const terminal = (await replay(CAPTURED)).at(-1);
  assert.equal(terminal?.kind, "run.completed");
  assert.equal(terminal?.kind === "run.completed" ? terminal.exitCode : "unset", 0);
});

test("a CLI that reports success and then exits non-zero is not recorded as clean", async () => {
  const terminal = (await replay(CAPTURED, { exit: { code: 1, signal: null } })).at(-1);
  assert.equal(terminal?.kind, "run.completed");
  assert.equal(terminal?.kind === "run.completed" ? terminal.exitCode : "unset", 1);
});

test("an exit nobody saw is `null` — never a substituted zero", async () => {
  // A child that closed stdout and then hung must not hang `parse` with it, and
  // the code it never reported is not `0`; it is unobserved.
  const terminal = (await replay(CAPTURED, { exit: "never" })).at(-1);
  assert.equal(terminal?.kind === "run.completed" ? terminal.exitCode : "unset", null);
});

test("provider timestamps are read as MILLISECONDS, and a seconds stamp is refused", async () => {
  const events = await replay(CAPTURED);
  const withStamp = events.find((e) => e.providerAt !== null);
  assert.ok(withStamp !== undefined, "the capture carries provider timestamps");
  assert.equal(withStamp?.providerAt, "2026-08-08T19:56:30.934Z");
  // A seconds stamp multiplied by nothing lands in 1970; the host declines to
  // guess which unit it was handed.
  assert.equal(epochMillisToIso(1786218990), null);
  assert.equal(epochMillisToIso(1786218990934), "2026-08-08T19:56:30.934Z");
  assert.equal(epochMillisToIso("1786218990934"), null);
});

test("no clock-skew notice fires on a healthy run", async () => {
  const notices = only(await replay(CAPTURED), "notice").map((e) => e.code);
  assert.equal(notices.includes("clock-skew"), false);
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
  assert.ok(nonJson[0]?.detail?.startsWith('{"type":"tool_execution_start"'));
});

test("a stream that stops with no terminal and no cancellation is a failure, not a success", async () => {
  const events = await replay(CANCELLED);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_TERMINAL_MISSING");
});

test("a cancelled run still carries the usage its completed turn reported", async () => {
  // Emitting each turn's report as it arrives, rather than one aggregate at the
  // end, is what makes this true: an aggregate would have been lost with the
  // terminal it never reached.
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const session: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  const events = await replay(CANCELLED, { signal: controller.signal, session });
  assert.equal(only(events, "usage").length, 0, "the prefix cuts before any turn_end");
  assert.equal(session.costUsd, null, "no turn reported a price, so there is no price");
});

// ---------------------------------------------------------------------------
// Quota. Blocks with the reset time; never a retry, never a substitution.
// ---------------------------------------------------------------------------

test("the quota fixture is the captured lines with exactly the stated substitution", () => {
  // Mechanical, for the same reason the prefix check is: a derived fixture that
  // nothing checks is a fixture that can drift into fiction.
  const capture = readFileSync(CAPTURED, "utf8").split("\n").filter(Boolean);
  const derived = readFileSync(QUOTA, "utf8").split("\n").filter(Boolean);
  assert.equal(derived.length, 4);
  assert.equal(derived[0], capture[0], "the session header is verbatim");
  assert.equal(derived[1], capture[16], "the assistant message_start is verbatim");
  assert.equal(derived[3], capture[23], "the agent_settled line is verbatim");
  assert.equal(
    derived[2],
    capture[21]?.replace(
      '"stopReason":"stop"',
      '"stopReason":"error","errorMessage":"You have hit your ChatGPT usage limit ' +
        '(plus plan). Try again in ~37 min."',
    ),
    "the turn_end line is the captured one with one substitution",
  );
});

test("a quota-shaped error maps to E_QUOTA_EXHAUSTED and carries its reset", async () => {
  const events = await replay(QUOTA);
  const [quota] = only(events, "quota");
  assert.equal(quota?.scope, "provider");
  // pi states the reset as a RELATIVE phrase computed against its own clock, so
  // the host adds the minutes back to its own — 37 minutes past the injected
  // `now` of the second stamped event.
  assert.ok(quota?.resetAt !== null && quota?.resetAt !== undefined);
  assert.ok(Number.isFinite(Date.parse(quota?.resetAt ?? "")), "a resetAt nothing can parse is not a reset time");
  assert.equal(quota?.resetAt, "2026-08-08T00:37:03.000Z");

  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
  // The quota observation precedes the terminal: a consumer reading in order
  // never has to infer why the run stopped.
  assert.ok(events.indexOf(quota as NormalizedEvent) < events.length - 1);
  assert.deepEqual(validateEventSequence(events), []);
});

test("quota is never a retry: `execute` starts exactly one process", async () => {
  const bytes = readFileSync(QUOTA);
  let starts = 0;
  const broker = {
    startProcess: async (_registration: ProcessRegistration, _spec: ProcessSpec) => {
      starts += 1;
      return {
        runId: "run-pi-2",
        identity: { pid: 1, pgid: 1, startedAt: "2026-08-08T00:00:00.000Z" },
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
    runId: "run-pi-2",
    sessionId: "s1",
    from: "RUNNING",
    to: "RUNNING",
    edge: "L10",
    reservationId: "r1",
    adapterId: PI_ADAPTER_ID,
    role: "builder",
  } as unknown as ProcessRegistration;

  const events: NormalizedEvent[] = [];
  for await (const event of adapter().execute(
    REQUEST,
    broker,
    registration,
    new AbortController().signal,
  )) {
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
  const session: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  await replay(CAPTURED, { session });
  assert.equal(session.sessionId, "019fe2f2-ccee-7b73-bf45-a6587c010d98");
  assert.equal(session.resolvedModel, "gpt-5.6-sol");
});

test("a correction that re-enters the same session and model is accepted", async () => {
  const first: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  const second: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  await replay(CAPTURED, { session: first });
  await replay(CAPTURED, { session: second });
  assert.doesNotThrow(() => assertSameSession(first, second));
});

test("a correction in a different session is a cold restart, and is refused", () => {
  const first: PiSessionRecord = { sessionId: "s-one", resolvedModel: "gpt-5.6-sol", costUsd: null };
  assert.throws(
    () => assertSameSession(first, { sessionId: "s-two", resolvedModel: "gpt-5.6-sol", costUsd: null }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_BACKEND_FAILURE",
  );
  // A session that was never named cannot be re-entered either.
  assert.throws(
    () => assertSameSession(first, { sessionId: null, resolvedModel: "gpt-5.6-sol", costUsd: null }),
    (error: unknown) => error instanceof AdapterError && error.code === "E_BACKEND_FAILURE",
  );
});

test("a correction answered by a different model is a mismatch, not a continuation", () => {
  assert.throws(
    () =>
      assertSameSession(
        { sessionId: "s-one", resolvedModel: "gpt-5.6-sol", costUsd: null },
        { sessionId: "s-one", resolvedModel: "gpt-5.4-mini", costUsd: null },
      ),
    (error: unknown) => error instanceof AdapterError && error.code === "E_MODEL_MISMATCH",
  );
});

// ---------------------------------------------------------------------------
// Host behaviour on streams no fixture should be invented for.
//
// Every case below drives a hand-built stream. None of them claims anything
// about pi's protocol — the shapes are either captured line kinds re-arranged
// or the four documented in `pi-codex-stream.ts`'s provenance header, and what
// each one asserts is the HOST's handling, which is this repository's to own.
// ---------------------------------------------------------------------------

/** Replays literal text as one chunk. */
async function replayText(
  text: string,
  options: { session?: PiSessionRecord; signal?: AbortSignal; stderr?: string } = {},
): Promise<NormalizedEvent[]> {
  const dir = mkdtempSync(join(tmpdir(), "awsf-pi-stream-"));
  try {
    const path = join(dir, "stream.jsonl");
    writeFileSync(path, text);
    return await replay(path, options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const START_LINE = JSON.stringify({
  type: "message_start",
  message: { role: "assistant", provider: "openai-codex", model: "gpt-5.6-sol" },
});
const SETTLED_LINE = JSON.stringify({ type: "agent_settled" });

test("a run whose stdout is never JSON still opens — prose is how auth failures arrive", async () => {
  // The CLI prints prose to stdout when it cannot authenticate. That run
  // started and then went wrong, which is a different fact from never having
  // begun — and `validateEventSequence` checks terminals and tool pairing, not
  // openings, so nothing else catches a missing one.
  const events = await replayText("Not authenticated. Run `pi` and sign in.\nstill not json\n");
  assert.equal(events[0]?.kind, "run.started");
  assert.equal(only(events, "notice").filter((n) => n.code === "non-json-output").length, 2);
  assert.deepEqual(validateEventSequence(events), []);
});

test("a turn with no usage block reports no usage — it is not accused of a malformed one", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.equal(only(events, "usage").length, 0);
  assert.equal(
    only(events, "notice").some((n) => n.code === "malformed-usage"),
    false,
  );
  assert.equal(events[events.length - 1]?.kind, "run.completed");
});

test("a usage block that is present but unreadable still produces its fault", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop", usage: "lots" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.equal(
    only(events, "notice").some((n) => n.code === "malformed-usage"),
    true,
  );
  assert.equal(only(events, "usage")[0]?.usage.inputTokens, null);
});

test("a run that never names a model does not silently resolve to what was asked", async () => {
  const events = await replayText(
    `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_MODEL_UNRESOLVED");
});

test("a message that names a model but no provider fails closed too", async () => {
  // Both halves, not either: a resolved model with no provider is as unusable
  // for reconstruction as a provider with no model.
  const events = await replayText(
    `${JSON.stringify({ type: "message_start", message: { role: "assistant", model: "gpt-5.6-sol" } })}\n`,
  );
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_MODEL_UNRESOLVED");
});

test("answering on a provider other than the pinned route is reported, not hidden", async () => {
  const events = await replayText(
    `${JSON.stringify({
      type: "message_start",
      message: { role: "assistant", provider: "github-copilot", model: "gpt-5.6-sol" },
    })}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  const [notice] = only(events, "notice");
  assert.equal(notice?.code, "unknown-provider-event");
  assert.ok(notice?.detail?.includes("github-copilot"));
  // The identity still records what actually answered — that is what identity
  // means — and the notice is how the swap stays visible.
  assert.equal(only(events, "model.resolved")[0]?.provider, "github-copilot");
});

test("thinking is streamed for display and is not the answer text", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "weighing options" },
      })}\n` +
      `${JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "42" },
      })}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.equal(only(events, "thinking.delta")[0]?.text, "weighing options");
  assert.equal(only(events, "text.delta")[0]?.text, "42");
});

test("`aborted` is a cancellation, not a failure — so the host's own cancel agrees with it", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "aborted" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.equal(events[events.length - 1]?.kind, "run.cancelled");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a non-quota error is a backend failure, and carries what the provider said", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "connection reset by peer" },
      })}\n` +
      `${SETTLED_LINE}\n`,
  );
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_BACKEND_FAILURE");
  assert.ok(terminal?.kind === "run.failed" && terminal.message.includes("connection reset"));
  assert.equal(only(events, "quota").length, 0);
});

test("an error with no reset phrase blocks with a null reset rather than a guessed one", async () => {
  // An unreported reset is a gap; a nonsense one is a lie, and the gap is the
  // honest failure.
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "Monthly usage limit reached" },
      })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.equal(only(events, "quota")[0]?.resetAt, null);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_QUOTA_EXHAUSTED");
});

test("an unrecognized line type is reported, never dropped", async () => {
  const events = await replayText(
    `${JSON.stringify({ type: "compaction_start", reason: "threshold" })}\n`,
  );
  const [notice] = only(events, "notice");
  assert.equal(notice?.code, "unknown-provider-event");
  assert.ok(notice?.message.includes("compaction_start"));
});

test("a settlement for a call the host never opened is a notice, not an unpaired event", async () => {
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({ type: "tool_execution_end", toolCallId: "", toolName: "ls", result: {}, isError: false })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.deepEqual(validateEventSequence(events), []);
  assert.equal(only(events, "tool.completed").length, 0);
});

test("a tool that reached execution without a decodable request still pairs", async () => {
  // `tool_execution_start` opens what `toolcall_end` would normally have
  // opened. Without it, the settlement below would be
  // `tool-settled-without-request` — a violation the host caused itself.
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({ type: "tool_execution_start", toolCallId: "call_x", toolName: "read", args: { path: "a" } })}\n` +
      `${JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "call_x",
        toolName: "read",
        result: { content: [{ type: "text", text: "contents" }] },
        isError: true,
      })}\n` +
      `${JSON.stringify({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } })}\n` +
      `${SETTLED_LINE}\n`,
  );
  assert.deepEqual(validateEventSequence(events), []);
  assert.equal(only(events, "tool.requested")[0]?.name, "read");
  assert.equal(only(events, "tool.completed")[0]?.outcome, "error");
  assert.equal(only(events, "tool.completed")[0]?.resultSnippet, "contents");
});

test("a cost the provider did not report stays null — never zero", async () => {
  const session: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", stopReason: "stop", usage: { input: 1, output: 1 } },
      })}\n` +
      `${SETTLED_LINE}\n`,
    { session },
  );
  assert.equal(session.costUsd, null);
  // And an unpriced run renders as a dash, not as free.
  assert.equal(formatCost("provider", session.costUsd), "—");
});

// ---------------------------------------------------------------------------
// The cross-building review pass, on this route. Every case below is a defect
// the GPT review found in T13's decoder that this one shares or mirrors —
// landed here in the same pass, because a fix applied to one adapter and not
// the other is a fix that has to be found twice.
// ---------------------------------------------------------------------------

test("stderr is DRAINED, so a chatty provider cannot block itself into a hang", async () => {
  // A pipe nobody reads fills at 64 KiB, and a child that blocks writing to a
  // full stderr never reaches the part where it writes its result.
  const events = await replay(CAPTURED, { stderr: "x".repeat(64 * 1024) });
  assert.equal(events[events.length - 1]?.kind, "run.completed");
  assert.deepEqual(validateEventSequence(events), []);
});

test("what a dying provider said on stderr survives into the failure", async () => {
  const events = await replayText("", { stderr: "pi: not authenticated" });
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_TERMINAL_MISSING");
  assert.ok(terminal?.kind === "run.failed" && terminal.message.includes("not authenticated"));
});

test("a process that writes nothing to stdout still OPENS its run", async () => {
  const events = await replayText("", { stderr: "pi: not authenticated" });
  assert.equal(events[0]?.kind, "run.started");
  assert.deepEqual(validateEventSequence(events), []);
});

test("`context token limit reached` is a backend failure, not an exhausted subscription", async () => {
  // A full context window is fixed by sending less; a spent subscription is
  // fixed by waiting. Quota is structurally never a retry, so mislabelling the
  // first costs a phase that could have recovered.
  const events = await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "context token limit reached" },
      })}\n` +
      `${SETTLED_LINE}\n`,
  );
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" ? terminal.errorCode : null, "E_BACKEND_FAILURE");
  assert.equal(only(events, "quota").length, 0);
});

test("this route's own refusal texts still map to quota", async () => {
  for (const message of [
    "You have hit your ChatGPT usage limit (plus plan). Try again in ~37 min.",
    "Monthly usage limit reached",
    "insufficient_quota",
  ]) {
    const events = await replayText(
      `${START_LINE}\n` +
        `${JSON.stringify({
          type: "turn_end",
          message: { role: "assistant", stopReason: "error", errorMessage: message },
        })}\n` +
        `${SETTLED_LINE}\n`,
    );
    const terminal = events[events.length - 1];
    assert.equal(
      terminal?.kind === "run.failed" ? terminal.errorCode : null,
      "E_QUOTA_EXHAUSTED",
      `${JSON.stringify(message)} should read as exhaustion`,
    );
  }
});

test("a system prompt that does not exist is refused before any child starts", () => {
  // Load-bearing on THIS route in a way it is not on T13's: pi's
  // `--append-system-prompt` takes text or a path and decides with `existsSync`,
  // so a missing file is not an error — the run goes out with the path string
  // itself as its system prompt, and nothing says so.
  assert.throws(
    () => assertPrivateSystemPrompt(PI_ADAPTER_ID, "/nonexistent/awsf/system-prompt.md"),
    (error: unknown) => error instanceof AdapterError && error.code === "E_INVALID_REQUEST",
  );
});

test("a zero cost the provider DID report is a price, and renders as one", async () => {
  const session: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
  await replayText(
    `${START_LINE}\n` +
      `${JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } },
      })}\n` +
      `${SETTLED_LINE}\n`,
    { session },
  );
  assert.equal(session.costUsd, 0);
  assert.equal(formatCost("provider", session.costUsd), "$0.00");
});
