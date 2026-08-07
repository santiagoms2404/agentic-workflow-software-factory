# Claude Code fixtures — where these bytes came from

The plan's **fixture integrity rule** says no task may satisfy itself with fixtures
invented from the same unverified protocol assumption it is testing. This file is how
that rule is checkable here rather than asserted: every fixture below is either bytes
that came off a live `claude` process, or a stated transformation of those bytes, and
the two are never mixed up.

## The one live probe

**T13's entire live budget: one bounded call.** It was spent on 2026-08-07.

```
node --experimental-strip-types core/test/fixtures/providers/claude/capture-probe.ts <out.jsonl>
```

`capture-probe.ts` is committed beside these files. It does not hard-code an argv — it
calls `ClaudeCodeAdapter.buildSpec()` and spawns exactly what that returns, so the argv
under test and the argv that produced these bytes are the same argv by construction.
What it ran:

| | |
|---|---|
| CLI | `claude` 2.1.224 |
| argv | `--print --output-format stream-json --include-partial-messages --verbose --model sonnet --no-session-persistence --effort low --permission-mode dontAsk --tools Read,Glob,Grep --disallowed-tools Bash,Write,Edit,NotebookEdit` |
| prompt | on **stdin**: *"Use the Glob tool to list the files in the current directory, then reply with only the number of files you found."* |
| cwd | `/tmp/awsf-claude-probe` — three throwaway files, so a read-only tool call had something to find |
| env | the adapter's allowlist (`PATH`, `HOME`, `TMPDIR`) plus its five injected values |
| exit | `0`, no signal, 11 087 bytes on stdout, **nothing on stderr** |

It was deliberately shaped to exercise the whole vocabulary in one call: a tool
request *and* its result, streamed text deltas, the subscription's rate-limit
telemetry, and a terminal with usage.

### `probe-readonly-tool.jsonl` — CAPTURED, verbatim

Byte-for-byte what the process wrote to stdout. Nothing removed, nothing reordered,
nothing redacted. It carries this machine's home directory in `plugins[].path` and
`memory_paths.auto`, and the operator's installed skill and agent lists — that is what
the CLI emits, and editing it would make every other claim on this page unverifiable.
It contains no credential: `apiKeySource` is `"none"`.

### `probe-readonly-tool.stderr.txt` — CAPTURED, verbatim

Empty, and committed *because* it is empty: "the provider said nothing on stderr" is a
fact about this run, and an absent file would leave it unstated.

## Derived fixtures — real bytes, stated transformations

### `probe-readonly-tool.cancelled.jsonl` — a byte PREFIX of the capture

The first 4 948 of the capture's 11 087 bytes: nine whole lines through the `assistant`
message that opens the `Glob` tool call, then 40 bytes of the tenth, cutting mid-line.
**No byte was added or changed** — `capture.startsWith(prefix)` is asserted in the test
suite, so this file cannot drift into fiction.

It is what a cancelled run's stdout actually looks like: a killed process group closes
its pipes wherever it happened to be, which is rarely a line boundary. It exercises the
tail-visibility rule and explicit tool settlement before a cancellation terminal.

### `derived-quota-rate-limit.jsonl` — 1 substitution

The captured `system/init` line verbatim, plus the captured `rate_limit_event` line with
exactly one substitution:

```
"status":"allowed"   →   "status":"rejected"
```

`resetsAt`, `rateLimitType`, and every other field are the captured values.

**What is real and what is not.** The `rate_limit_event` envelope, its field names, and
its epoch-seconds `resetsAt` are captured — this run really did volunteer its five-hour
window. The exhausted `status` *string* is not: this subscription was not exhausted, so
nobody has read one. The parser is written so that does not matter — it treats anything
the CLI does not call `"allowed"` as exhausted, so the rule under test is "not allowed
blocks", which is correct whatever the exact vocabulary turns out to be. `"rejected"` is
a representative value, taken from the sibling `overageStatus` field in the same
captured envelope.

### `derived-quota-result-error.jsonl` — 2 substitutions

The captured `system/init` line verbatim, plus the captured `result` line with:

```
"is_error":false     →   "is_error":true
"result":"3"         →   "result":"Claude AI usage limit reached|1786147200"
```

**What is real and what is not.** The `result` envelope and its `is_error` flag are
captured. The limit message text is **representative, not captured** — it follows the
reading in `my-agentic-workflow/src/providers/claude-code.mjs:14-15`, which is a
reviewed implementation against this same CLI, not a guess. What the suite proves is the
host's mapping (quota-shaped error → `E_QUOTA_EXHAUSTED` carrying a reset, never a
retry), not the provider's exact wording. The parser reads a reset out of that text in
two shapes — a trailing `|<epoch seconds>` and a `reset[s|_at]: …` phrase — and records
`null` when it recognizes neither, rather than guessing a timestamp.

## Rules for whoever reads this next

- **These fixtures are replayed, never regenerated.** Re-running `capture-probe.ts` to
  "refresh" one spends live quota to prove something already provable from files, which
  the plan's never-do list forbids.
- A second live call is only warranted by a *new* fact nobody has captured — an
  exhausted `rate_limit_event` being the obvious one. If you ever capture one, replace
  `derived-quota-rate-limit.jsonl` with the real bytes and delete its paragraph above.
