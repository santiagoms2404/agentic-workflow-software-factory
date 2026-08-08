# pi/Codex fixtures — where these bytes came from

The plan's **fixture integrity rule** says no task may satisfy itself with fixtures
invented from the same unverified protocol assumption it is testing. This file is how
that rule is checkable here rather than asserted: every fixture below is either bytes
that came off a live `pi` process, or a stated transformation of those bytes, and the
two are never mixed up.

## The one live probe

**T14's entire live budget: one bounded call.** It was spent on 2026-08-08.

```
node --experimental-strip-types core/test/fixtures/providers/codex/capture-probe.ts <out.jsonl>
```

`capture-probe.ts` is committed beside these files. It does not hard-code an argv — it
calls `PiCodexAdapter.buildSpec()` and spawns exactly what that returns, so the argv
under test and the argv that produced these bytes are the same argv by construction.
What it ran:

| | |
|---|---|
| CLI | `pi` 0.81.1 |
| argv | `--mode json -p --provider openai-codex --model gpt-5.6-sol --no-session --thinking low --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tools read,grep,find,ls` |
| prompt | on **stdin**: *"Use the ls tool to list the files in the current directory, then reply with only the number of files you found."* |
| cwd | `/tmp/awsf-codex-probe` — three throwaway files, so a read-only tool call had something to find |
| env | the adapter's allowlist (`PATH`, `HOME`, `TMPDIR`) plus its five injected values |
| exit | `0`, no signal, 13 399 bytes on stdout across 24 lines, **nothing on stderr** |

It was deliberately shaped to exercise the whole vocabulary in one call: a tool request
*and* its execution and result, streamed text deltas, two turns (so the per-turn usage
rule had something to be wrong about), a per-turn cost figure, and a settled terminal.

### `probe-readonly-tool.jsonl` — CAPTURED, verbatim

Byte-for-byte what the process wrote to stdout. Nothing removed, nothing reordered,
nothing redacted. Unlike T13's Claude capture it carries no machine paths at all — the
only path in it is the throwaway `cwd` — and no credential: the `--tools` allowlist kept
the run to `ls`, and the OAuth token never appears in the event stream.

### `probe-readonly-tool.stderr.txt` — CAPTURED, verbatim

Empty, and committed *because* it is empty: "the provider said nothing on stderr" is a
fact about this run, and an absent file would leave it unstated.

## Derived fixtures — real bytes, stated transformations

### `probe-readonly-tool.cancelled.jsonl` — a byte PREFIX of the capture

The first 5 273 of the capture's 13 399 bytes: ten whole lines through the `message_end`
that closes the assistant turn opening the `ls` call, then 40 bytes of the eleventh,
cutting mid-line inside `tool_execution_start`. **No byte was added or changed** —
`capture.startsWith(prefix)` is asserted in the test suite, so this file cannot drift
into fiction.

It is what a cancelled run's stdout actually looks like: a killed process group closes
its pipes wherever it happened to be, which is rarely a line boundary. It exercises the
tail-visibility rule and explicit tool settlement before a cancellation terminal, and it
is why "a cancelled run still carries the usage its completed turns reported" is a test
rather than a hope.

### `derived-quota-error.jsonl` — 4 captured lines, 1 substitution

The captured `session` header, the captured assistant `message_start`, and the captured
`agent_settled` line, all verbatim, plus the captured second `turn_end` line with exactly
one substitution:

```
"stopReason":"stop"
  →
"stopReason":"error","errorMessage":"You have hit your ChatGPT usage limit (plus plan). Try again in ~37 min."
```

The substitution is asserted line by line in the suite, so this file cannot drift either.

**What is real and what is not.** The `turn_end` envelope, its `stopReason` field, and
the `usage` block it still carries are captured. The error *text* is **representative,
not captured**: this subscription was not exhausted, so nobody has read a real refusal.
It is not invented either — it is the exact sentence pi builds for the operator on a
`usage_limit_reached` / `rate_limit_exceeded` / 429 response, from
`packages/ai/src/api/openai-codex-responses.ts` in the 0.80.3 checkout,
including the `(plus plan)` parenthetical and the `Try again in ~N min.` rendering of the
provider's absolute `resets_at`. What the suite proves is the **host's** mapping — quota-
shaped text ends the run with `E_QUOTA_EXHAUSTED` carrying a reset, and never with a
retry — not the provider's exact wording.

The `usage` block is deliberately left as captured rather than removed. A real refusal
would probably carry none, but removing it would be a second transformation with nothing
to check it against, and the host's behaviour on a terminal that reports usage is a case
worth keeping exercised.

## What this capture could NOT measure, and is not offered as though it could

`reasoningRelation: "included-in-output"` is the one relation this harness states rather
than recording as `unknown`, and **the capture does not confirm it**: the probe ran at
`--thinking low` and every turn reported `reasoning: 0`, so the arithmetic is consistent
with either relation. The claim rests on pi's own mapping, read in the 0.80.3
checkout and cited in `core/src/adapters/pi-codex-stream.ts`:

- `reasoning` is read from `output_tokens_details.reasoning_tokens`, which is a
  *breakdown of* `output_tokens` — the field `output` is read from
  (`packages/ai/src/api/openai-responses-shared.ts`);
- pi states it in words for the sibling API it shares the vendor's semantics with:
  *"OpenAI completion_tokens already includes reasoning_tokens"*
  (`packages/ai/src/api/openai-completions.ts`).

A future capture on a run that actually spends reasoning tokens would turn this from a
reviewed reading into a measurement. Until then it is labelled as what it is.

Four decoded shapes are in the same position — read from pi's own committed source
rather than from these bytes, because the probe could not produce them:
`thinking_delta`, the `error` and `aborted` stop reasons, `errorMessage`, and
`responseModel`. The tests covering them replay hand-built streams and assert only the
host's handling; none of them claims to be a recording of pi.

**Two versions are in play, and the first pass wrote them both down as one.** The CLI
that produced the capture, and whose `--help` the argv was reconciled against, is the
installed **0.81.1**. Every source citation — in this file and in
`core/src/adapters/pi-codex-stream.ts` — is from the local checkout at
`../../../../../pi`, which is **0.80.3**. The cross-building review caught the
conflation. Anything the two versions disagree about is unverified by definition.

### Two claims this file made that the review refuted, corrected here

**The stream's model identity is NOT provider evidence on this route.**
`packages/ai/src/api/openai-codex-responses.ts` builds the assistant message with
`model: model.id` and `provider: model.provider` — pi's own local configuration, the
values the adapter's own argv supplied — and never reads `response.model` back off the
API. `responseModel`, which pi documents as the concrete model "when different from the
requested model", is set only on the `openai-completions` path, never on this one. So
`model.resolved` from this route carries `provenance: "route-attributed"`, not
`"stream-authoritative"`. The capture cannot show this — it names the model that was
asked for, which is what both readings predict — and that is exactly why it took a
reader from the other provider family to catch.

**The cost is an ESTIMATE, not a provider-reported price.** `calculateCost`
(`packages/ai/src/models.ts`) multiplies rate-per-million from the model's entry in
pi's local model store by the token counts. OpenAI reports the tokens; it reports no
charge. The adapter therefore carries `costAuthority: "catalog-estimate"` and the
figures render `≈ $0.01`. The first pass called it `"provider"` and printed it as a
confirmed price — on the adapter whose whole point was making cost authority visible.

## Rules for whoever reads this next

- **These fixtures are replayed, never regenerated.** Re-running `capture-probe.ts` to
  "refresh" one spends live quota to prove something already provable from files, which
  the plan's never-do list forbids.
- A second live call is only warranted by a *new* fact nobody has captured. The three
  obvious ones: a run that actually spends reasoning tokens (which would settle the
  paragraph above), a genuinely exhausted ChatGPT window (which would replace
  `derived-quota-error.jsonl` with real bytes and delete its caveat), and a run long
  enough to trigger automatic compaction (which would settle whether a compaction's
  summarization call reports usage anywhere the decoder can sum it — the review says
  `compaction_end.result.usage`, and no such field exists in the 0.80.3 source).
