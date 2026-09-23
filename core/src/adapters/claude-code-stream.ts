// Stage two, for one provider: the Claude CLI's `stream-json` lines become
// sequencer calls.
//
// This is the whole of the Claude adapter's parsing contribution, and it is
// deliberately the ONLY thing it contributes to the run. Every invariant that
// holds over a run — exactly one terminal, explicit tool settlement, host-minted
// tool ids, `null ≠ 0`, fail-closed model identity — belongs to
// `EventSequencer`, so no adapter can get one of them subtly wrong on its own.
// What lives here is the part nobody else can know: what this CLI's lines mean.
//
// It is a separate file from `claude-code.ts` along the seam that file's own
// header names. Describing a launch and decoding a stream are two jobs; the
// advisory LOC budget noticed the second one before anybody else did, exactly as
// it did for `usage.ts` and `event-sequencer.ts` in T12.
//
// ---------------------------------------------------------------------------
// EVERY SHAPE BELOW APPEARS IN A CAPTURED STREAM.
// `core/test/fixtures/providers/claude/probe-readonly-tool.jsonl` is verbatim
// stdout from one bounded live `claude` run; `PROVENANCE.md` beside it names the
// exact command and states which of the sibling fixtures are derived and how.
// Nothing in this file was written from documentation.
// ---------------------------------------------------------------------------

import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { ObservedToolImage } from "./interface.ts";
import type { EventSequencer } from "./stream/event-sequencer.ts";
import { summarize } from "./stream/snippet.ts";
import { redactToolImages, toolResultImages } from "./stream/tool-images.ts";

interface ClaudeContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface ClaudeStreamDelta {
  type?: string;
  text?: string;
  thinking?: string;
}

interface ClaudeLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  timestamp?: string;
  is_error?: boolean;
  result?: unknown;
  error?: unknown;
  api_error_status?: unknown;
  usage?: Record<string, unknown>;
  message?: { model?: string; content?: readonly ClaudeContentBlock[] };
  event?: { type?: string; delta?: ClaudeStreamDelta; usage?: Record<string, unknown> };
  rate_limit_info?: { status?: string; resetsAt?: unknown; rateLimitType?: string };
}

/**
 * Which provider session answered, and as what.
 *
 * Not on the normalized events, because a provider session id is a transport
 * fact rather than part of the twelve-kind vocabulary — but it is the fact a
 * same-session correction has to assert, so the decoder fills it in for whoever
 * asked. See `assertSameSession` in `claude-code.ts`.
 */
export interface ClaudeSessionRecord {
  sessionId: string | null;
  resolvedModel: string | null;
}

export interface ClaudeStreamDecoderOptions {
  adapter: string;
  provider: string;
  /** What the host ASKED for. The stream says what answered; the two are different facts. */
  requestedModel: string;
  session?: ClaudeSessionRecord;
  /** Filled with the digest of every image a settled tool call returned. */
  images?: ObservedToolImage[];
}

export class ClaudeStreamDecoder {
  readonly #adapter: string;
  readonly #provider: string;
  readonly #requestedModel: string;
  readonly #session: ClaudeSessionRecord;
  /**
   * Mirrors the sequencer's own map rather than reaching into it: the decoder
   * needs to know whether it has already opened a provider tool id, and the
   * sequencer's bookkeeping is its own.
   */
  readonly #openTools = new Set<string>();
  /** Tool names by provider id; a `tool_result` names only the id it settles. */
  readonly #toolNames = new Map<string, string>();
  readonly #images: ObservedToolImage[] | undefined;
  #started = false;
  /**
   * The per-API-call usage the `message_delta` events report, accumulated.
   *
   * Kept, but NOT emitted alongside the terminal's own block: on the captured
   * probe these two reports sum to exactly the terminal's totals — 2+2 input,
   * 5479+70 cache-creation, 6271+11750 cache-read, 49+3 output — so a run that
   * emitted both would double every figure. It exists for the two things the
   * terminal cannot supply: `thinking_tokens`, which only the deltas carry, and
   * a usage report for a run that never reaches a terminal at all.
   */
  #deltaUsage: { totals: Record<string, number>; reasoning: number | null } | null = null;
  #usageReported = false;

  constructor(options: ClaudeStreamDecoderOptions) {
    this.#adapter = options.adapter;
    this.#provider = options.provider;
    this.#requestedModel = options.requestedModel;
    this.#session = options.session ?? { sessionId: null, resolvedModel: null };
    this.#images = options.images;
  }

  get session(): ClaudeSessionRecord {
    return this.#session;
  }

  /** One line in, zero or more normalized events out, in order. */
  decode(line: string, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const text = line.trim();
    if (text.length === 0) return [];
    // Opened BEFORE the line is parsed, not after. A CLI that fails to
    // authenticate or to read its own config prints prose to stdout and never
    // emits a single JSON line, and that run still started — it started and
    // then went wrong, which is a different thing from never having begun. When
    // this lived below the parse branches, exactly that case produced a stream
    // of notices and a terminal with no opening event, and nothing caught it:
    // `validateEventSequence` checks terminals and tool pairing, not openings.
    const out = [...this.ensureStarted(sequencer)];
    let parsed: ClaudeLine;
    try {
      parsed = JSON.parse(text) as ClaudeLine;
    } catch {
      // Never silently discarded: a line the host could not read is a fact
      // about the run, and the trace has to carry it.
      return [
        ...out,
        ...sequencer.notice(
          "non-json-output",
          "the Claude CLI emitted a line that is not JSON",
          text.slice(0, 200),
        ),
      ];
    }
    if (parsed === null || typeof parsed !== "object") {
      return [
        ...out,
        ...sequencer.notice(
          "non-json-output",
          "the Claude CLI emitted a bare JSON value",
          text.slice(0, 200),
        ),
      ];
    }
    if (typeof parsed.session_id === "string" && parsed.session_id.length > 0) {
      this.#session.sessionId = parsed.session_id;
    }

    switch (parsed.type) {
      case "system":
        return [...out, ...this.#system(parsed, sequencer)];
      case "stream_event":
        return [...out, ...this.#streamEvent(parsed, sequencer)];
      case "assistant":
        return [...out, ...this.#assistant(parsed, sequencer)];
      case "user":
        return [...out, ...this.#user(parsed, sequencer)];
      case "rate_limit_event":
        return [...out, ...this.#rateLimit(parsed, sequencer)];
      case "result":
        return [...out, ...this.#result(parsed, sequencer)];
      default:
        return [
          ...out,
          ...sequencer.notice(
            "unknown-provider-event",
            `the Claude CLI emitted an unrecognized line type ${JSON.stringify(parsed.type)}`,
            text.slice(0, 200),
          ),
        ];
    }
  }

  /**
   * `run.started` is minted by the HOST on the first readable line, not by an
   * event the provider sends.
   *
   * `system/init` normally arrives first and would be the obvious trigger, but a
   * run whose first line is anything else still started — and a stream of deltas
   * with no opening event would be a run the trace could not even describe.
   * Opening here keeps the run well-formed and leaves "did the provider ever
   * name its model" a separate question, answered by `model.resolved` or by
   * failing closed at the terminal.
   */
  ensureStarted(sequencer: EventSequencer): readonly NormalizedEvent[] {
    if (this.#started) return [];
    this.#started = true;
    return sequencer.started({ adapter: this.#adapter, requestedModel: this.#requestedModel });
  }

  /**
   * The usage a run consumed but never got to report, emitted before its
   * terminal.
   *
   * A run cancelled mid-answer has already spent the tokens its `message_delta`
   * events reported, and the `result` line that would have totalled them never
   * arrives. Reporting nothing there says the run cost nothing, which is the
   * one thing it definitely did not. Called by `parse` on the paths where a
   * terminal is minted by the HOST rather than decoded from the stream; a no-op
   * on a run that reached its own terminal, so it can never double-count.
   */
  flushUsage(sequencer: EventSequencer): readonly NormalizedEvent[] {
    const pending = this.#deltaUsage;
    if (this.#usageReported || pending === null) return [];
    this.#usageReported = true;
    return sequencer.usage({
      inputTokens: pending.totals["input_tokens"] ?? null,
      outputTokens: pending.totals["output_tokens"] ?? null,
      cacheReadTokens: pending.totals["cache_read_input_tokens"] ?? null,
      cacheWriteTokens: pending.totals["cache_creation_input_tokens"] ?? null,
      reasoningTokens: pending.reasoning,
      reasoningRelation: "unknown",
    });
  }

  /**
   * Sums one `message_delta`'s usage into the running total.
   *
   * Only well-formed counts are added. A field the provider reported as
   * something other than a count is left out of the sum rather than coerced,
   * because a sum with a guess in it is worse than a sum with a gap.
   */
  #accumulate(usage: Record<string, unknown> | undefined): void {
    if (usage === undefined || usage === null) return;
    const state = this.#deltaUsage ?? { totals: {}, reasoning: null };
    for (const field of DELTA_USAGE_FIELDS) {
      const value = usage[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
      state.totals[field] = (state.totals[field] ?? 0) + value;
    }
    const details = usage["output_tokens_details"];
    const thinking =
      details !== null && typeof details === "object"
        ? (details as Record<string, unknown>)["thinking_tokens"]
        : undefined;
    if (typeof thinking === "number" && Number.isSafeInteger(thinking) && thinking >= 0) {
      state.reasoning = (state.reasoning ?? 0) + thinking;
    }
    this.#deltaUsage = state;
  }

  #system(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    // `system/status` ("requesting", …) is recognized and carries no normalized
    // meaning; a notice per status line would bury the stream it describes.
    if (line.subtype !== "init") return [];
    const model = typeof line.model === "string" ? line.model : "";
    this.#session.resolvedModel = model.length > 0 ? model : null;
    return sequencer.resolveModel({
      adapter: this.#adapter,
      provider: this.#provider,
      requestedModel: this.#requestedModel,
      // No fallback: an init event that names no model is an identity the
      // harness cannot represent, and it fails closed rather than resolving to
      // the selector we asked for, which would render as a confirmed answer.
      resolvedModel: model,
      provenance: "stream-authoritative",
    });
  }

  /**
   * Partial-message deltas. `--include-partial-messages` is pinned in the argv,
   * so these are the streaming source of truth for text — which is why the
   * assembled `text` blocks on the `assistant` message that follows are NOT
   * re-emitted. They are the same bytes arriving a second time, and emitting
   * both would double every answer in the trace.
   *
   * `input_json_delta` is ignored for the mirror-image reason: the complete tool
   * input arrives on the `assistant` message, and a partial `{"pattern": "*` is
   * not a summary of anything.
   */
  #streamEvent(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const event = line.event;
    if (event === undefined) return [];
    if (event.type === "message_delta") {
      this.#accumulate(event.usage);
      return [];
    }
    if (event.type !== "content_block_delta") return [];
    const delta = event.delta;
    if (delta === undefined) return [];
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return sequencer.text("text.delta", delta.text);
    }
    // Streamed for live display and never persisted — `isPersistableKind`.
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return sequencer.text("thinking.delta", delta.thinking);
    }
    return [];
  }

  /**
   * A completed assistant message. Its `tool_use` blocks open tool calls; its
   * `text` blocks are the deltas again and are skipped.
   *
   * Model identity IS re-read here, reversing this decoder's first pass.
   *
   * That pass declined to, reasoning that the CLI issues internal sub-requests
   * on other models and a second identity claim would risk `E_MODEL_MISMATCH`
   * on a run that never changed models. The captured probe refutes it: both of
   * its top-level `assistant` messages name `claude-sonnet-5`, and the
   * `claude-haiku-4-5` that also ran appears ONLY under `result.modelUsage` —
   * never as a top-level identity. So there was no false-positive risk to
   * avoid, and what the rule actually did was discard the one signal that would
   * catch a run whose model changed under it. `system/init` and the assistant
   * turns now have to agree, and the sequencer raises `E_MODEL_MISMATCH` if
   * they do not.
   */
  #assistant(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    const model = line.message?.model;
    if (typeof model === "string" && model.length > 0) {
      out.push(
        ...sequencer.resolveModel({
          adapter: this.#adapter,
          provider: this.#provider,
          requestedModel: this.#requestedModel,
          resolvedModel: model,
          provenance: "stream-authoritative",
          providerAt: providerAt(line),
        }),
      );
    }
    for (const block of line.message?.content ?? []) {
      if (block.type !== "tool_use" || typeof block.id !== "string" || block.id.length === 0) continue;
      if (this.#openTools.has(block.id)) continue;
      this.#openTools.add(block.id);
      this.#toolNames.set(block.id, typeof block.name === "string" ? block.name : "tool");
      out.push(
        ...sequencer.toolRequested({
          providerToolId: block.id,
          name: typeof block.name === "string" ? block.name : "tool",
          inputSummary: summarize(block.input),
          providerAt: providerAt(line),
        }),
      );
    }
    return out;
  }

  /** Tool results arrive as a synthetic `user` turn — the CLI's own convention. */
  #user(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (const block of line.message?.content ?? []) {
      if (block.type !== "tool_result") continue;
      const id = block.tool_use_id;
      if (typeof id !== "string" || id.length === 0) continue;
      this.#openTools.delete(id);
      const outcome = block.is_error === true ? "error" : "ok";
      const settled = sequencer.toolCompleted({
        providerToolId: id,
        outcome,
        // An image result would otherwise put its base64 payload in the journal.
        resultSnippet: summarize(redactToolImages(block.content)),
        providerAt: providerAt(line),
      });
      out.push(...settled);
      const completed = settled.find((event) => event.kind === "tool.completed");
      if (this.#images !== undefined && completed?.kind === "tool.completed") {
        for (const image of toolResultImages(block.content)) {
          this.#images.push(Object.freeze({ toolCallId: completed.toolCallId,
            toolName: this.#toolNames.get(id) ?? "tool", outcome, ...image }));
        }
      }
    }
    return out;
  }

  /**
   * The subscription's own rate-limit telemetry, which the CLI volunteers on
   * every run.
   *
   * Always an observation — the `quota` event carries the window and its reset
   * whether or not anything is exhausted, because "four hours left on the
   * five-hour window" is exactly the fact the owner needs before a run rather
   * than after one. A status the CLI does not call `allowed` additionally ENDS
   * the run: quota is never a retry and never a substitution, so there is no
   * path from here that starts another process.
   */
  #rateLimit(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const info = line.rate_limit_info ?? {};
    const status = typeof info.status === "string" ? info.status : "unknown";
    const scope = typeof info.rateLimitType === "string" ? info.rateLimitType : "provider";
    const resetAt = epochSecondsToIso(info.resetsAt);
    const out = [
      ...sequencer.quota({
        scope,
        resetAt,
        message: `the ${scope} subscription window reports ${status}`,
      }),
    ];
    // `allowed` is read as a PREFIX, and the difference is a whole phase.
    //
    // No exhausted window has ever been captured (`PROVENANCE.md` says so), so
    // the blocking rule cannot be an enumeration of real statuses. The first
    // draft blocked on anything that was not the exact string `allowed`, which
    // fails closed — but in the wrong direction: a warning-class status whose
    // own name says the request WAS allowed would have killed a healthy run,
    // and since quota is never a retry, the phase is simply lost.
    //
    // Blocking here is not the safety net it looks like. A genuinely exhausted
    // window fails the API call, and `#result` maps that to the same
    // `E_QUOTA_EXHAUSTED` from the error text — so the backstop exists either
    // way, and the only thing the strict comparison bought was false positives.
    // Anything that does not begin with `allowed` still blocks, which keeps the
    // unknown-status case failing closed where failing closed is right.
    // ...but a status that BEGINS with `allowed` and also reads as exhausted —
    // `allowed_limit_reached` is the shape to worry about — is not exempt. The
    // prefix rule exists so a warning-class status does not cost a phase; it was
    // never meant to let the word `allowed` outrank the rest of the sentence,
    // and reading it that way is fail-open on an invented vocabulary in the one
    // direction that matters.
    // The status is a snake_case identifier and `QUOTA_SHAPED` reads prose, so
    // the separators are normalized before the two meet — without it,
    // `allowed_usage_limit_reached` is one long word that matches nothing.
    if (status.startsWith("allowed") && !QUOTA_SHAPED.test(status.replace(/[_-]+/g, " "))) {
      return out;
    }
    return [
      ...out,
      ...sequencer.fail(
        "E_QUOTA_EXHAUSTED",
        `the ${scope} subscription window reports ${JSON.stringify(status)}` +
          `${resetAt === null ? "" : `; it resets at ${resetAt}`}`,
      ),
    ];
  }

  /**
   * The terminal line.
   *
   * Usage is emitted from HERE and nowhere else. Every `message_delta` in the
   * stream carries a usage block too, and summing them would double-count a run
   * that made two API calls to answer one prompt — which the probe's own
   * two-turn tool run did.
   */
  #result(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const at = providerAt(line);
    // A terminal carrying NO usage block is a provider that did not report —
    // which is not the same as a provider whose report could not be read, and
    // must not be accused of the second. An error result normally carries none
    // at all, so emitting an empty usage event plus a `malformed-usage` notice
    // fired on exactly the runs that already had something else wrong with
    // them: the "train everyone to ignore this notice" outcome `mapUsage`'s own
    // docstring exists to prevent. A usage block that is present but unreadable
    // still goes through and still produces the fault.
    const reported = line.usage !== undefined && line.usage !== null;
    if (reported) this.#usageReported = true;
    const out = reported
      ? [...sequencer.usage(mapUsage(line.usage, this.#deltaUsage?.reasoning ?? null), at)]
      : [];
    // `null`, not `0`. The process's real exit code lives on `transport.exit`
    // and this decoder never sees it, so a `0` here would be a measurement it
    // did not take — and a CLI that emits a success result and then exits
    // non-zero would be recorded as clean. `null ≠ 0` applies to exit codes for
    // the same reason it applies to tokens. Measuring it properly means
    // awaiting the exit inside the read loop, which is a shape change to
    // `parse` rather than a patch; until then this says "not reported" instead
    // of asserting a number.
    if (line.is_error !== true) return [...out, ...sequencer.complete(null, at)];

    const message = errorMessageOf(line);
    if (QUOTA_SHAPED.test(message)) {
      return [
        ...out,
        ...sequencer.quota({ scope: "provider", resetAt: resetFromMessage(message), message, providerAt: at }),
        ...sequencer.fail("E_QUOTA_EXHAUSTED", message, at),
      ];
    }
    return [...out, ...sequencer.fail("E_BACKEND_FAILURE", message, at)];
  }
}

// ---------------------------------------------------------------------------
// Payload helpers. Pure, and each one is a decision about what the host is
// entitled to claim from bytes it did not write.
// ---------------------------------------------------------------------------

/**
 * Provider timestamps are ADVISORY. Only two of the CLI's line kinds carry one
 * at all, which is exactly why `seq` is what orders a run.
 */
function providerAt(line: ClaudeLine): string | null {
  return typeof line.timestamp === "string" && line.timestamp.length > 0 ? line.timestamp : null;
}

/**
 * The five metrics, and only the five.
 *
 * Mapped explicitly rather than passed through: `normalizeUsage` reports every
 * key it does not carry as a fault, and the CLI's usage block is full of fields
 * this contract has no home for (`service_tier`, `iterations`, `cache_creation`,
 * `server_tool_use`). Forwarding them would produce a `malformed-usage` notice
 * on every healthy run and train everyone to ignore it.
 *
 * The VALUES are forwarded unjudged, so a provider that reports a string where a
 * count belonged still produces the fault it should. `reasoningRelation` stays
 * `unknown`: Anthropic does not state whether thinking tokens sit inside
 * `output_tokens` or beside them, and this harness records measured conventions
 * only.
 */
const DELTA_USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

function mapUsage(usage: unknown, reasoningFromDeltas: number | null): unknown {
  // Anything that is not an object is forwarded UNTOUCHED so `normalizeUsage`
  // can report it as unreadable. Mapping it here would read five fields off a
  // string, get `undefined` five times, and turn a malformed provider report
  // into five honest-looking nulls with no fault attached.
  if (usage === null || typeof usage !== "object") return usage;
  const source = usage as Record<string, unknown>;
  const details = source["output_tokens_details"];
  const thinking =
    details !== null && typeof details === "object"
      ? (details as Record<string, unknown>)["thinking_tokens"]
      : undefined;
  return {
    inputTokens: source["input_tokens"] ?? null,
    outputTokens: source["output_tokens"] ?? null,
    cacheReadTokens: source["cache_read_input_tokens"] ?? null,
    cacheWriteTokens: source["cache_creation_input_tokens"] ?? null,
    // The terminal block carries no `output_tokens_details` at all — the
    // captured probe proves it — while every `message_delta` on the way there
    // carries one and reports `thinking_tokens`. Recording `null` because the
    // LAST report omitted a field the run had already reported is the `null ≠ 0`
    // rule failing in its own name: on the capture the provider said `0` twice
    // and the host said "not reported".
    reasoningTokens: thinking ?? reasoningFromDeltas,
    reasoningRelation: "unknown",
  };
}

/**
 * Quota-shaped error text.
 *
 * Carried from `my-agentic-workflow/src/providers/claude-code.mjs:15`, which is
 * the reviewed reading of this same CLI's error results.
 */
const QUOTA_SHAPED =
  /\b(?:usage limit|rate limit|quota)\b|\b(?:usage|plan|subscription|account) limit reached\b/i;

/**
 * The bare `limit reached` alternation this pattern used to carry is GONE, and
 * its absence is the fix.
 *
 * It matched "context token limit reached" — a full context window, which is a
 * `E_BACKEND_FAILURE` the operator fixes by sending less, not a subscription
 * the operator fixes by waiting. Calling it quota produced a `quota` event with
 * a reset time for a window that was never exhausted, and, because quota is
 * structurally never a retry, ended the phase for a reason the phase could
 * have recovered from. Nothing was lost by removing it: the CLI's own message
 * is "Claude AI usage limit reached", which the first alternation already
 * matches on `usage limit`.
 */

/**
 * `resets at 2026-08-08T00:00:00Z`, `reset at …`, `reset_at: …`, `reset: …`.
 *
 * The optional `s` and the optional `at` are SEPARATE groups, and they have to
 * be. Written as one alternation — `(?:s| at|_at)?` — the engine matches `s`
 * first on the plural form and the literal `at ` then falls inside the capture,
 * yielding a `resetAt` of `"at 2026-08-08T00:00:00Z"`. That is a string, so it
 * satisfies the schema's `minLength: 1` and nothing downstream complains; it is
 * simply not a timestamp, and anything that tries to `Date.parse` it to
 * schedule a resume gets `NaN`.
 */
const RESET_IN_MESSAGE = /reset(?:s)?(?:\s+at|_at)?\s*[:=]?\s*([^,;]+)/i;

/**
 * `Claude AI usage limit reached|1786147200` — the CLI's own pipe-and-epoch form.
 *
 * Bounded to ten digits so a millisecond epoch cannot match. Thirteen digits
 * would, and `epochSecondsToIso` would multiply them by a thousand again.
 */
const RESET_AS_EPOCH_SUFFIX = /\|\s*(\d{9,10})\s*$/;

function errorMessageOf(line: ClaudeLine): string {
  for (const candidate of [line.error, line.result, line.api_error_status]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return `the Claude CLI reported an error result (${line.subtype ?? "unknown subtype"})`;
}

/**
 * The reset time out of an error message, in the two shapes this CLI uses.
 *
 * Both are read because the quota contract is that a block always carries its
 * reset — a `quota` event with `resetAt: null` tells the owner they are stopped
 * and not when they are unstopped, which is the half of the fact that matters.
 * Anything neither shape matches stays `null` rather than becoming a guessed
 * timestamp.
 */
function resetFromMessage(message: string): string | null {
  const suffix = RESET_AS_EPOCH_SUFFIX.exec(message)?.[1];
  if (suffix !== undefined) return epochSecondsToIso(Number(suffix));
  const raw = RESET_IN_MESSAGE.exec(message)?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return null;
  const epoch = Number(raw);
  // Passed through as the provider wrote it rather than reformatted into a
  // timestamp nobody verified.
  return Number.isInteger(epoch) && epoch > 0 ? epochSecondsToIso(epoch) : raw;
}

/**
 * `resetsAt` is epoch SECONDS on the wire.
 *
 * The range check is the whole point of the function. A value outside it is not
 * epoch seconds — a millisecond stamp is the obvious way it happens — and
 * multiplying one by a thousand produces `+058570-10-02T00:00:00.000Z`, a
 * `resetAt` that is well-formed, confident, and fifty-six thousand years wrong.
 * The host declines to guess which unit it was handed: an unreported reset is a
 * gap, while a nonsense one is a lie, and the gap is the honest failure.
 *
 * Bounds are 2001-09-09 and 2096-10-02 in seconds — wide enough that no real
 * reset window is refused, narrow enough that no millisecond stamp survives.
 */
const EPOCH_SECONDS_MIN = 1_000_000_000;
const EPOCH_SECONDS_MAX = 4_000_000_000;

function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < EPOCH_SECONDS_MIN || value > EPOCH_SECONDS_MAX) return null;
  const at = new Date(value * 1000);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
