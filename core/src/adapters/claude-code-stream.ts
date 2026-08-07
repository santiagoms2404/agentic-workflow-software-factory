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
import type { EventSequencer } from "./stream/event-sequencer.ts";

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
  event?: { type?: string; delta?: ClaudeStreamDelta };
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
  #started = false;

  constructor(options: ClaudeStreamDecoderOptions) {
    this.#adapter = options.adapter;
    this.#provider = options.provider;
    this.#requestedModel = options.requestedModel;
    this.#session = options.session ?? { sessionId: null, resolvedModel: null };
  }

  get session(): ClaudeSessionRecord {
    return this.#session;
  }

  /** One line in, zero or more normalized events out, in order. */
  decode(line: string, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const text = line.trim();
    if (text.length === 0) return [];
    let parsed: ClaudeLine;
    try {
      parsed = JSON.parse(text) as ClaudeLine;
    } catch {
      // Never silently discarded: a line the host could not read is a fact
      // about the run, and the trace has to carry it.
      return sequencer.notice(
        "non-json-output",
        "the Claude CLI emitted a line that is not JSON",
        text.slice(0, 200),
      );
    }
    if (parsed === null || typeof parsed !== "object") {
      return sequencer.notice(
        "non-json-output",
        "the Claude CLI emitted a bare JSON value",
        text.slice(0, 200),
      );
    }
    if (typeof parsed.session_id === "string" && parsed.session_id.length > 0) {
      this.#session.sessionId = parsed.session_id;
    }

    const out = [...this.#ensureStarted(sequencer)];
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
  #ensureStarted(sequencer: EventSequencer): readonly NormalizedEvent[] {
    if (this.#started) return [];
    this.#started = true;
    return sequencer.started({ adapter: this.#adapter, requestedModel: this.#requestedModel });
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
    if (event === undefined || event.type !== "content_block_delta") return [];
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
   * Model identity is deliberately NOT re-read here. `message.model` is present
   * and correct, but the CLI also issues internal sub-requests on other models
   * (the probe's own `result` records a `claude-haiku-4-5` alongside the
   * `claude-sonnet-5` that answered), and a second identity claim would risk
   * `E_MODEL_MISMATCH` on a run that never changed models. `system/init` is the
   * CLI's own statement of the session model and is the only one read.
   */
  #assistant(line: ClaudeLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (const block of line.message?.content ?? []) {
      if (block.type !== "tool_use" || typeof block.id !== "string" || block.id.length === 0) continue;
      if (this.#openTools.has(block.id)) continue;
      this.#openTools.add(block.id);
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
      out.push(
        ...sequencer.toolCompleted({
          providerToolId: id,
          outcome: block.is_error === true ? "error" : "ok",
          resultSnippet: summarize(block.content),
          providerAt: providerAt(line),
        }),
      );
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
    if (status === "allowed") return out;
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
    const out = [...sequencer.usage(mapUsage(line.usage), at)];
    if (line.is_error !== true) return [...out, ...sequencer.complete(0, at)];

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

/** A bounded, printable stand-in for a tool input or result of any shape. */
function summarize(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : safeJson(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
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
function mapUsage(usage: Record<string, unknown> | undefined): unknown {
  if (usage === undefined) return null;
  const details = usage["output_tokens_details"];
  const thinking =
    details !== null && typeof details === "object"
      ? (details as Record<string, unknown>)["thinking_tokens"]
      : undefined;
  return {
    inputTokens: usage["input_tokens"] ?? null,
    outputTokens: usage["output_tokens"] ?? null,
    cacheReadTokens: usage["cache_read_input_tokens"] ?? null,
    cacheWriteTokens: usage["cache_creation_input_tokens"] ?? null,
    reasoningTokens: thinking ?? null,
    reasoningRelation: "unknown",
  };
}

/**
 * Quota-shaped error text.
 *
 * Carried from `my-agentic-workflow/src/providers/claude-code.mjs:15`, which is
 * the reviewed reading of this same CLI's error results.
 */
const QUOTA_SHAPED = /\b(?:usage limit|rate limit|quota)\b|limit reached/i;

/** `resets at 2026-08-08T00:00:00Z`, `reset_at: …` — the shapes that text uses. */
const RESET_IN_MESSAGE = /reset(?:s| at|_at)?\s*[:=]?\s*([^,;]+)/i;

/** `Claude AI usage limit reached|1786147200` — the CLI's own pipe-and-epoch form. */
const RESET_AS_EPOCH_SUFFIX = /\|\s*(\d{9,13})\s*$/;

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

/** `resetsAt` is epoch SECONDS on the wire — milliseconds would land in 1970. */
function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const at = new Date(value * 1000);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
