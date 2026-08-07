// The stub adapter: exact argv, no child, and honest events.
//
// `buildSpec` is the descriptor discipline in miniature — a full launch
// described down to the byte with nothing started. Everything else here is the
// parse side: the ugly lines a provider really produces, and what the host is
// allowed to say about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STUB_MODEL_PREFIX,
  STUB_SCRIPTS,
  StubAdapter,
  scriptFor,
} from "../../../src/adapters/stub.ts";
import { AdapterError, type ProcessTransport } from "../../../src/adapters/interface.ts";
import {
  validateEventSequence,
  type NormalizedEvent,
} from "../../../src/contracts/normalized-events.ts";
import type { OutputBudgetOptions } from "../../../src/adapters/stream/output-budget.ts";

const PROVIDER_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "providers",
  "stub",
  "stub-provider.mjs",
);

function adapterFor(sideEffectPath: string, limits?: OutputBudgetOptions): StubAdapter {
  let tick = 0;
  return new StubAdapter({
    providerPath: PROVIDER_PATH,
    sideEffectPath,
    now: () => `2026-08-07T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    ...(limits === undefined ? {} : { limits }),
  });
}

const REQUEST = {
  model: "stub/success",
  prompt: "summarize the repository",
  cwd: "/tmp/work",
  env: { PATH: "/usr/bin", HOME: "/home/owner" },
};

// ---------------------------------------------------------------------------
// The eight scripts.
// ---------------------------------------------------------------------------

test("the adapter is scriptable with exactly the eight behaviours the plan names", () => {
  assert.deepEqual(
    [...STUB_SCRIPTS],
    [
      "success",
      "timeout",
      "silence",
      "overload",
      "malformed",
      "model-line",
      "no-model-line",
      "grandchild-spawner",
    ],
  );
});

test("the provider executable implements every script the adapter can ask for", () => {
  // The adapter's list and the fixture's list are two files; a script named in
  // one and missing from the other is a stub that fails in a way no test would
  // otherwise explain.
  const source = readFileSync(PROVIDER_PATH, "utf8");
  for (const script of STUB_SCRIPTS) {
    assert.ok(source.includes(`'${script}'`), `the provider handles ${script}`);
  }
});

test("a model the stub cannot represent fails closed rather than resolving to something near it", () => {
  assert.throws(
    () => scriptFor("stub/succes"),
    (error: Error) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.code, "E_MODEL_UNRESOLVED");
      return true;
    },
  );
  assert.throws(() => scriptFor("claude-opus-5"), AdapterError);
  // Prefixed and bare both name the same script.
  assert.equal(scriptFor("stub/success"), "success");
  assert.equal(scriptFor("success"), "success");
});

// ---------------------------------------------------------------------------
// buildSpec: pure, and exact.
// ---------------------------------------------------------------------------

test("buildSpec produces the exact descriptor, with the prompt on stdin and nowhere else", () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-stub-"));
  try {
    const sideEffect = join(dir, "ran.json");
    const spec = adapterFor(sideEffect).buildSpec(REQUEST);

    assert.deepEqual(spec, {
      executable: PROVIDER_PATH,
      argv: ["success", sideEffect],
      cwd: "/tmp/work",
      env: { PATH: "/usr/bin", HOME: "/home/owner" },
      stdin: "summarize the repository",
      shell: false,
    });
    assert.ok(!spec.argv.some((arg) => arg.includes("summarize")), "the prompt never rides argv");

    // Pure: describing a launch starts nothing and touches nothing.
    assert.equal(existsSync(sideEffect), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every script builds a spec, and the script is the only thing that differs", () => {
  const adapter = adapterFor("/tmp/ran.json");
  for (const script of STUB_SCRIPTS) {
    const spec = adapter.buildSpec({ ...REQUEST, model: `${STUB_MODEL_PREFIX}${script}` });
    assert.deepEqual(spec.argv, [script, "/tmp/ran.json"]);
    assert.equal(spec.shell, false);
  }
});

test("the stub reports no usage and no cost, and says so rather than reporting zeros", async () => {
  const info = await adapterFor("/tmp/ran.json").getModelInfo("stub/success");
  assert.equal(info.usageAuthority, "none");
  assert.equal(info.costAuthority, "unavailable");
  assert.equal(info.contextWindow, null, "null is not zero");
  assert.equal(info.continuity, "none");
});

test("the provider fixture is committed executable, and says so where it is diagnosable", () => {
  // `core.filemode` is false on the development mount, so the working-tree bit
  // proves nothing about what a fresh clone gets — the INDEX mode is what
  // travels. Without 100755 the barrier fails at `execve` with a permission
  // error three layers away from the cause, so it fails here instead.
  const recorded = execFileSync("git", ["ls-files", "-s", "--", "core/test/fixtures/providers/stub/stub-provider.mjs"], {
    cwd: join(import.meta.dirname, "..", "..", "..", ".."),
    encoding: "utf8",
  });
  assert.match(recorded, /^100755 /, `the stub provider must be committed executable, got: ${recorded.trim()}`);
});

test("availability is checked, not asserted", async () => {
  assert.equal((await adapterFor("/tmp/ran.json").isAvailable()).status, "available");
  const missing = new StubAdapter({
    providerPath: "/nonexistent/stub-provider.mjs",
    sideEffectPath: "/tmp/ran.json",
  });
  const blocked = await missing.isAvailable();
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.detail ?? "", /not executable/);
});

// ---------------------------------------------------------------------------
// parse: bytes to events.
// ---------------------------------------------------------------------------

/** An `Error` in the chunk list is thrown out of the iterator, as a real stream does. */
function transportOf(chunks: readonly (string | Uint8Array | Error)[]): ProcessTransport {
  const encoder = new TextEncoder();
  return {
    runId: "run-1",
    identity: { pid: 1, pgid: 1, startIdentity: null, startIdentitySource: "test" },
    stdout: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (chunk instanceof Error) throw chunk;
          yield typeof chunk === "string" ? encoder.encode(chunk) : chunk;
        }
      },
    },
    stderr: {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {},
    },
    exit: Promise.resolve({ code: 0, signal: null }),
    cancel: async () => ({
      termSent: false,
      killSent: false,
      survivors: [],
      terminated: true,
      skipped: null,
    }),
  };
}

async function collect(
  chunks: readonly (string | Uint8Array | Error)[],
  limits?: OutputBudgetOptions,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of adapterFor("/tmp/ran.json", limits).parse(transportOf(chunks))) {
    events.push(event);
  }
  return events;
}

test("a clean run parses into a contiguous, single-terminal event sequence", async () => {
  const events = await collect([
    '{"type":"started","script":"success"}\n',
    '{"type":"model","model":"stub-model-1"}\n',
    '{"type":"text","text":"hello"}\n',
    '{"type":"result","exitCode":0}\n',
  ]);

  assert.deepEqual(
    events.map((event) => event.kind),
    ["run.started", "model.resolved", "text.delta", "run.completed"],
  );
  assert.deepEqual(validateEventSequence(events), []);
  const resolved = events[1];
  assert.equal(resolved?.kind === "model.resolved" && resolved.provenance, "stream-authoritative");
  assert.equal(resolved?.kind === "model.resolved" && resolved.requestedModel, "stub/success");
});

test("a line split across chunks — mid-code-point included — parses as one line", async () => {
  const encoder = new TextEncoder();
  const full = encoder.encode('{"type":"text","text":"héllo wörld"}\n');
  const cut = 25; // lands inside the two-byte ö
  const events = await collect([
    '{"type":"started","script":"success"}\n{"type":"te',
    'xt","text":"first"}\n',
    full.slice(0, cut),
    full.slice(cut),
    // The model line is here because `run.completed` requires one: a run that
    // never names its model fails closed. That rule has its own test below; this
    // one is about the chunk boundaries and must not accidentally become a
    // second copy of it.
    '{"type":"model","model":"stub-model-1"}\n',
    '{"type":"result","exitCode":0}\n',
  ]);

  assert.deepEqual(
    events.map((event) => event.kind),
    ["run.started", "text.delta", "text.delta", "model.resolved", "run.completed"],
  );
  assert.equal(events[2]?.kind === "text.delta" && events[2].text, "héllo wörld");
});

test("a malformed line becomes a visible notice, never a silent discard", async () => {
  const events = await collect([
    '{"type":"started","script":"malformed"}\n',
    '{"type":"text","text":"half a re\n',
    "not json at all\n",
    '{"type":"result","exitCode":0}\n',
  ]);

  const notices = events.filter((event) => event.kind === "notice");
  assert.equal(notices.length, 2);
  for (const notice of notices) {
    assert.equal(notice.kind === "notice" && notice.code, "non-json-output");
  }
  assert.deepEqual(validateEventSequence(events), []);
});

test("an unrecognized line type is reported as unknown rather than assumed harmless", async () => {
  const events = await collect([
    '{"type":"started","script":"grandchild-spawner"}\n',
    '{"type":"grandchild","pid":991}\n',
    '{"type":"result","exitCode":0}\n',
  ]);
  const notice = events[1];
  assert.equal(notice?.kind === "notice" && notice.code, "unknown-provider-event");
});

test("a stream that simply stops did not succeed quietly", async () => {
  const events = await collect(['{"type":"started","script":"success"}\n', '{"type":"text","text":"…"}\n']);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_TERMINAL_MISSING");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a provider error becomes a terminal failure, and the trailing line without a newline is still read", async () => {
  const events = await collect([
    '{"type":"started","script":"overload"}\n',
    '{"type":"error","kind":"overload","message":"the stub provider is overloaded"}',
  ]);
  const terminal = events[1];
  assert.equal(terminal?.kind, "run.failed");
  assert.match(terminal?.kind === "run.failed" ? terminal.message : "", /overload/);
  assert.deepEqual(validateEventSequence(events), []);
});

// ---------------------------------------------------------------------------
// The three stream stages, through a real adapter.
// ---------------------------------------------------------------------------

test("the `no-model-line` script is what it is for: a run that names no model fails closed", async () => {
  // The script exists so this rule has a provider that really produces the case.
  const events = await collect([
    '{"type":"started","script":"no-model-line"}\n',
    '{"type":"text","text":"prompt:12"}\n',
    '{"type":"result","exitCode":0}\n',
  ]);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_MODEL_UNRESOLVED");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a `model` line naming nothing does not resolve to a placeholder", async () => {
  const events = await collect([
    '{"type":"started","script":"model-line"}\n',
    '{"type":"model"}\n',
    '{"type":"result","exitCode":0}\n',
  ]);
  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_MODEL_UNRESOLVED");
});

test("framing reads PAST the output budget, so the terminal is still observable", async () => {
  // The budget bounds what is emitted; it never bounds what is read. A framer
  // that stopped at the cap would misreport an over-talkative run as one that
  // never ended — the exact silent failure this milestone exists to remove.
  const chatter = Array.from({ length: 40 }, (_, index) => `{"type":"text","text":"line ${index}"}\n`);
  const events = await collect(
    [
      '{"type":"started","script":"success"}\n',
      '{"type":"model","model":"stub-model-1"}\n',
      ...chatter,
      '{"type":"result","exitCode":7}\n',
    ],
    { maxEventCount: 8 },
  );

  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.completed");
  assert.equal(terminal?.kind === "run.completed" && terminal.exitCode, 7);
  assert.ok(events.length <= 10, `the cap held at ${events.length} events`);
  const truncated = events.filter((event) => event.kind === "notice" && event.code === "output-truncated");
  assert.equal(truncated.length, 1, "the run says out loud that it dropped output");
  assert.deepEqual(validateEventSequence(events), []);
});

test("a byte budget cuts text on a code point boundary rather than mid-character", async () => {
  const events = await collect(
    [
      '{"type":"started","script":"success"}\n',
      '{"type":"model","model":"stub-model-1"}\n',
      '{"type":"text","text":"ab🙂cd"}\n',
      '{"type":"result","exitCode":0}\n',
    ],
    { maxOutputBytes: 6 },
  );
  const delta = events.find((event) => event.kind === "text.delta");
  assert.equal(delta?.kind === "text.delta" && delta.text, "ab🙂");
  assert.equal(events[events.length - 1]?.kind, "run.completed");
});

test("a stream that ENDED under an aborted signal was cancelled, not terminal-less", async () => {
  // Killing a process group closes its pipes cleanly, so a cancelled run reaches
  // EOF exactly like a provider that stopped talking. Only the host knows which
  // it was, and it says so with the signal it already holds.
  const cancelling = new AbortController();
  cancelling.abort("the owner cancelled the task");
  const events: NormalizedEvent[] = [];
  const transport = transportOf(['{"type":"started","script":"timeout"}\n', '{"type":"text","text":"…"}\n']);
  for await (const event of adapterFor("/tmp/ran.json").parse(transport, cancelling.signal)) {
    events.push(event);
  }

  const terminal = events[events.length - 1];
  assert.equal(terminal?.kind, "run.cancelled");
  assert.match(terminal?.kind === "run.cancelled" ? terminal.reason : "", /the owner cancelled the task/);
  assert.deepEqual(validateEventSequence(events), []);
});

test("a stream that fails mid-run still settles: cancellation and fault are told apart", async () => {
  const cancelled = new Error("the transport was destroyed");
  (cancelled as { code?: string }).code = "ERR_STREAM_PREMATURE_CLOSE";
  const events = await collect([
    '{"type":"started","script":"success"}\n',
    '{"type":"model","model":"stub-model-1"}\n',
    cancelled,
  ]);
  assert.equal(events[events.length - 1]?.kind, "run.cancelled");
  assert.deepEqual(validateEventSequence(events), []);

  const broke = await collect([
    '{"type":"started","script":"success"}\n',
    new Error("read ECONNRESET"),
  ]);
  const terminal = broke[broke.length - 1];
  assert.equal(terminal?.kind, "run.failed");
  assert.equal(terminal?.kind === "run.failed" && terminal.errorCode, "E_BACKEND_FAILURE");
});
