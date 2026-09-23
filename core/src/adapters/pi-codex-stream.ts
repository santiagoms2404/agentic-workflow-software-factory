// Stage two, for one provider: the `pi` CLI's `--mode json` lines become
// sequencer calls.
//
// This is the whole of the pi/Codex adapter's parsing contribution, and it is
// deliberately the ONLY thing it contributes to the run. Every invariant that
// holds over a run — exactly one terminal, explicit tool settlement, host-minted
// tool ids, `null ≠ 0`, fail-closed model identity — belongs to
// `EventSequencer`, so no adapter can get one of them subtly wrong on its own.
// What lives here is the part nobody else can know: what this CLI's lines mean.
//
// ---------------------------------------------------------------------------
// PROVENANCE OF THE SHAPES BELOW — stated precisely, because two different
// kinds of evidence are used and conflating them is how fixture fiction starts.
//
//   CAPTURED. `core/test/fixtures/providers/codex/probe-readonly-tool.jsonl` is
//   verbatim stdout from one bounded live `pi` run. Every line type this file
//   decodes as a normal run — `session`, `agent_start`, `turn_start`,
//   `message_start`, `message_update` (`text_start`/`text_delta`/`text_end`,
//   `toolcall_start`/`toolcall_delta`/`toolcall_end`), `message_end`,
//   `tool_execution_start`, `tool_execution_end`, `turn_end`, `agent_end`,
//   `agent_settled` — appears in it, with the field names used here.
//
//   REVIEWED READING of pi's own committed source, NOT of documentation and NOT
//   of a guess, for four shapes the capture could not produce: `thinking_delta`
//   (a reasoning model that emitted no reasoning summary), the `error`/`aborted`
//   stop reasons, `errorMessage`, and `responseModel`. Sources:
//   `packages/ai/src/types.ts` for the event union and `AssistantMessage`,
//   `packages/ai/src/api/openai-codex-responses.ts` for this route's identity
//   and error paths, `packages/ai/src/models.ts` for how cost is computed.
//
//   TWO VERSIONS ARE IN PLAY AND THEY ARE NOT THE SAME NUMBER. The CLI that
//   produced the capture, and whose `--help` the argv is reconciled against, is
//   the installed **0.81.1**. The source read for every citation above is the
//   local checkout, which is **0.80.3** — the cross-building review caught the
//   first pass calling both of them 0.81.1. Line numbers therefore belong to
//   0.80.3 and are given as file references rather than line references where
//   the exact line would go stale first. Anything the two versions disagree
//   about is unverified by definition, and the safest reading of that is: these
//   four shapes are read from 0.80.3 and the bytes are from 0.81.1.
//
// The line between captured and read is kept in the comments below, per branch.
// ---------------------------------------------------------------------------

import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { ObservedToolImage } from "./interface.ts";
import type { EventSequencer } from "./stream/event-sequencer.ts";
import { summarize } from "./stream/snippet.ts";
import { redactToolImages, toolResultImages } from "./stream/tool-images.ts";

interface PiUsage {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  reasoning?: unknown;
  totalTokens?: unknown;
  cost?: { total?: unknown };
}

interface PiMessage {
  role?: string;
  content?: unknown;
  provider?: string;
  model?: string;
  /** Set only when the concrete model differs from the one asked for. */
  responseModel?: string;
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string;
  /** Unix MILLISECONDS. Not seconds — see `epochMillisToIso`. */
  timestamp?: unknown;
}

interface PiAssistantMessageEvent {
  type?: string;
  delta?: unknown;
  toolCall?: { id?: string; name?: string; arguments?: unknown };
  error?: PiMessage;
}

interface PiLine {
  type?: string;
  /** `session` header only: the run's session id. */
  id?: string;
  message?: PiMessage;
  assistantMessageEvent?: PiAssistantMessageEvent;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/**
 * Which provider session answered, as what, and for roughly how much.
 *
 * None of the three is on the normalized events, and each is absent for its own
 * reason. A provider session id is a transport fact rather than part of the
 * twelve-kind vocabulary — but it is the fact a same-session correction has to
 * assert. And MONEY is not an event kind at all: the twelve carry tokens, never
 * a price, because most routes cannot report one.
 *
 * `costUsd` is an ESTIMATE and is labelled as one everywhere it is rendered.
 * pi computes it locally with `calculateCost` (`packages/ai/src/models.ts`):
 * rate per million from the model's entry in pi's own model store, multiplied
 * by the token counts. OpenAI reports the tokens and reports no charge. So the
 * adapter carries `costAuthority: "catalog-estimate"` and `formatCost` renders
 * `≈ $0.01` — the first pass called it `"provider"` and printed it as a
 * confirmed price, which is the exact confusion `cost-display.ts` was written
 * to prevent.
 */
export interface PiSessionRecord {
  sessionId: string | null;
  resolvedModel: string | null;
  /**
   * The rate-card estimate for the run, in USD, summed over its turns.
   *
   * `null` means no turn carried one — never `0`, which is an estimate of zero.
   * Same discipline as `TokenUsage`.
   */
  costUsd: number | null;
}

export interface PiStreamDecoderOptions {
  adapter: string;
  /** The route the host launched. Compared against what the stream reports. */
  provider: string;
  /** What the host ASKED for. The stream says what answered; the two are different facts. */
  requestedModel: string;
  session?: PiSessionRecord;
  /** Filled with the digest of every image a settled tool call returned. */
  images?: ObservedToolImage[];
  /** Host clock, injected so a replayed transcript is byte-stable. */
  now?: () => string;
}

export class PiStreamDecoder {
  readonly #adapter: string;
  readonly #provider: string;
  readonly #requestedModel: string;
  readonly #session: PiSessionRecord;
  readonly #now: () => string;
  /**
   * Mirrors the sequencer's own map rather than reaching into it: the decoder
   * needs to know whether it has already opened a provider tool id, and the
   * sequencer's bookkeeping is its own.
   */
  readonly #openTools = new Set<string>();
  readonly #images: ObservedToolImage[] | undefined;
  #started = false;
  /** The last stop reason any assistant turn reported. Decides the terminal. */
  #stopReason: string | null = null;
  #errorMessage: string | null = null;
  /** Host clock at the moment the refusal was read — the reset's anchor. */
  #errorAt: string | null = null;

  constructor(options: PiStreamDecoderOptions) {
    this.#adapter = options.adapter;
    this.#provider = options.provider;
    this.#requestedModel = options.requestedModel;
    this.#session = options.session ?? { sessionId: null, resolvedModel: null, costUsd: null };
    this.#images = options.images;
    this.#now = options.now ?? ((): string => new Date().toISOString());
  }

  get session(): PiSessionRecord {
    return this.#session;
  }

  /** One line in, zero or more normalized events out, in order. */
  decode(line: string, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const text = line.trim();
    if (text.length === 0) return [];
    // Opened BEFORE the line is parsed, not after — the fix T13's review found.
    // A CLI that cannot authenticate or cannot read its own config prints prose
    // to stdout and never emits a single JSON line, and that run still started:
    // it started and then went wrong, which is a different fact from never
    // having begun. `validateEventSequence` checks terminals and tool pairing,
    // not openings, so nothing downstream would catch a missing one.
    const out = [...this.ensureStarted(sequencer)];
    let parsed: PiLine;
    try {
      parsed = JSON.parse(text) as PiLine;
    } catch {
      // Never silently discarded: a line the host could not read is a fact
      // about the run, and the trace has to carry it.
      return [...out, ...this.#unreadable(sequencer, "a line that is not JSON", text)];
    }
    if (parsed === null || typeof parsed !== "object") {
      return [...out, ...this.#unreadable(sequencer, "a bare JSON value", text)];
    }

    switch (parsed.type) {
      case "session":
        // The header pi writes before it subscribes anything. It carries the id
        // and nothing else this contract wants.
        if (typeof parsed.id === "string" && parsed.id.length > 0) {
          this.#session.sessionId = parsed.id;
        }
        return out;
      case "message_start":
        return [...out, ...this.#messageStart(parsed, sequencer)];
      case "message_update":
        return [...out, ...this.#messageUpdate(parsed, sequencer)];
      case "message_end":
        // The assembled message, arriving a second time. Its stop reason is
        // read (it is the same object `turn_end` carries, and a turn that ends
        // badly may not reach a `turn_end` at all); its usage is NOT, because
        // `turn_end` is the one place this decoder counts from.
        this.#noteStop(parsed.message);
        return out;
      case "tool_execution_start":
        return [...out, ...this.#toolStart(parsed, sequencer)];
      case "tool_execution_end":
        return [...out, ...this.#toolEnd(parsed, sequencer)];
      case "turn_end":
        return [...out, ...this.#turnEnd(parsed, sequencer)];
      case "agent_settled":
        return [...out, ...this.#settle(sequencer)];
      case "compaction_start":
      case "compaction_end":
        // Recognized so an automatic compaction does not arrive as an unknown
        // event, and NOT decoded for usage — which is a known gap, stated here
        // rather than papered over. Compaction runs a summarization call that
        // spends tokens this decoder's per-turn sum will miss. The review named
        // `compaction_end.result.usage` as the place to read it; the
        // `CompactionResult` in the source available here (0.80.3) has
        // `summary`, `firstKeptEntryId`, `tokensBefore`, `estimatedTokensAfter`
        // and `details`, and no `usage` at all. Decoding a field path that is
        // not in the source I can read is precisely the invented-shape failure
        // the fixture-integrity rule forbids, so the gap stays open until
        // someone captures a compacting run or reads 0.81.1's own source.
        return out;
      case "agent_start":
      case "turn_start":
      case "tool_execution_update":
      case "agent_end":
        // Recognized and carrying no normalized meaning. `agent_end` in
        // particular is NOT the terminal: it carries `willRetry`, so pi emits
        // it again after an internal retry, and its `messages` array is the
        // whole transcript a third time. `agent_settled` is the one line that
        // means the run is over.
        return out;
      default:
        return [
          ...out,
          ...sequencer.notice(
            "unknown-provider-event",
            `the pi CLI emitted an unrecognized line type ${JSON.stringify(parsed.type)}`,
            text.slice(0, 200),
          ),
        ];
    }
  }

  /**
   * `run.started` is minted by the HOST on the first readable line, not by an
   * event the provider sends.
   *
   * pi's `session` header normally arrives first and would be the obvious
   * trigger, but a run whose first line is anything else still started — and a
   * stream of deltas with no opening event would be a run the trace could not
   * even describe.
   */
  ensureStarted(sequencer: EventSequencer): readonly NormalizedEvent[] {
    if (this.#started) return [];
    this.#started = true;
    return sequencer.started({ adapter: this.#adapter, requestedModel: this.#requestedModel });
  }

  #unreadable(
    sequencer: EventSequencer,
    what: string,
    text: string,
  ): readonly NormalizedEvent[] {
    return sequencer.notice("non-json-output", `the pi CLI emitted ${what}`, text.slice(0, 200));
  }

  /**
   * The identity, taken from the first assistant message — and marked
   * `route-attributed`, NOT `stream-authoritative`.
   *
   * The first pass had this exactly backwards, and the cross-building review
   * caught it. On this route the CLI's `message.model` and `message.provider`
   * are not evidence of anything: `openai-codex-responses.ts:229-234` builds
   * the assistant message with `model: model.id` and `provider: model.provider`
   * — the values from pi's own LOCAL model configuration, the ones this
   * adapter's argv just supplied — and never reads `response.model` back off
   * the API. `responseModel`, the field pi documents as "the concrete
   * `chunk.model` when different from the requested model", is set only on the
   * `openai-completions` path and never on this one.
   *
   * So what the stream says is the argv coming back. Calling that
   * `stream-authoritative` would be the harness presenting an inferred identity
   * as a confirmed one, which is the single failure `provenance` exists to
   * prevent — and the first pass shipped a test whose name asserted the
   * opposite ("comes from the STREAM, not from the argv that asked").
   *
   * It is still read from the message rather than from the request, and it
   * still fails closed on an unrepresentable value: `responseModel` is
   * preferred in case a later pi version starts setting it, and a mismatch
   * between the stream's provider and the pinned route still raises a notice —
   * that would now mean pi's local store disagrees with the route on argv,
   * which is worth saying out loud even though the API cannot cause it.
   */
  #messageStart(line: PiLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const message = line.message;
    if (message === undefined || message.role !== "assistant") return [];
    const resolved =
      typeof message.responseModel === "string" && message.responseModel.length > 0
        ? message.responseModel
        : typeof message.model === "string"
          ? message.model
          : "";
    const provider = typeof message.provider === "string" ? message.provider : "";
    this.#session.resolvedModel = resolved.length > 0 ? resolved : null;
    const out: NormalizedEvent[] = [];
    if (provider.length > 0 && provider !== this.#provider) {
      out.push(
        ...sequencer.notice(
          "unknown-provider-event",
          "the pi CLI answered on a provider other than the one this launch pinned",
          `launched with ${JSON.stringify(this.#provider)}, answered by ${JSON.stringify(provider)}`,
          providerAt(message),
        ),
      );
    }
    return [
      ...out,
      ...sequencer.resolveModel({
        adapter: this.#adapter,
        // No fallback on either half: a message that names no model, or no
        // provider, is an identity the harness cannot represent, and it fails
        // closed rather than resolving to the selector we asked for.
        provider,
        requestedModel: this.#requestedModel,
        resolvedModel: resolved,
        provenance: "route-attributed",
        providerAt: providerAt(message),
      }),
    ];
  }

  /**
   * Streaming deltas, and the opening of a tool call.
   *
   * `text_end` and `toolcall_delta` are deliberately NOT decoded, for the same
   * two reasons T13's decoder skips their Claude equivalents: `text_end`
   * carries the assembled text the deltas already streamed, and emitting both
   * would double every answer in the trace; a partial `{"pat` of a tool's
   * arguments is not a summary of anything, and the complete arguments arrive
   * on `toolcall_end`.
   *
   * `toolcall_start` is not decoded either, and that one is a TRADE-OFF taken
   * knowingly rather than an omission — the cross-building review raised it and
   * it is declined with its cost stated. Opening there would make a tool call
   * abandoned mid-arguments (cancelled between `toolcall_start` and
   * `toolcall_end`) visible in the trace, which it currently is not. But the id
   * is all that exists at that point: the arguments arrive over the deltas that
   * follow, so opening early would give EVERY run an empty `inputSummary`,
   * since the sequencer mints the request once and there is no path to enrich
   * it afterwards. Trading every run's tool inputs for visibility into a rare
   * mid-argument cancellation is the wrong side of that bargain. The gap is
   * real and this is where it is written down.
   */
  #messageUpdate(line: PiLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const event = line.assistantMessageEvent;
    if (event === undefined) return [];
    switch (event.type) {
      case "text_delta":
        return typeof event.delta === "string" ? sequencer.text("text.delta", event.delta) : [];
      case "thinking_delta":
        // REVIEWED READING, not captured — the probe's model emitted no
        // reasoning summary. Streamed for live display and never persisted
        // (`isPersistableKind`); the alternative was letting a reasoning run's
        // whole thinking stream fall into the unknown-event branch and bury the
        // trace it describes.
        return typeof event.delta === "string" ? sequencer.text("thinking.delta", event.delta) : [];
      case "toolcall_end":
        return this.#openTool(sequencer, {
          providerToolId: event.toolCall?.id,
          name: event.toolCall?.name,
          input: event.toolCall?.arguments,
          providerAt: null,
        });
      case "error":
        // REVIEWED READING (`types.ts:465`): the failing message arrives here
        // as well as on the turn that ends. Recorded, never terminal — the
        // terminal is `agent_settled`'s alone.
        this.#noteStop(event.error);
        return [];
      default:
        return [];
    }
  }

  /**
   * The host began executing a tool.
   *
   * It opens the call too, and the duplicate is the point: `toolcall_end`
   * normally opens it first and this is a no-op, but a stream that reached
   * execution without a decodable request would otherwise settle a call the
   * host never opened — a `tool-settled-without-request` violation caused by
   * the host's own decoding rather than by the provider.
   */
  #toolStart(line: PiLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    return this.#openTool(sequencer, {
      providerToolId: line.toolCallId,
      name: line.toolName,
      input: line.args,
      providerAt: null,
    });
  }

  #openTool(
    sequencer: EventSequencer,
    input: {
      providerToolId: string | undefined;
      name: string | undefined;
      input: unknown;
      providerAt: string | null;
    },
  ): readonly NormalizedEvent[] {
    const id = input.providerToolId;
    if (typeof id !== "string" || id.length === 0) return [];
    if (this.#openTools.has(id)) return [];
    this.#openTools.add(id);
    return sequencer.toolRequested({
      providerToolId: id,
      name: typeof input.name === "string" ? input.name : "tool",
      inputSummary: summarize(input.input),
      providerAt: input.providerAt,
    });
  }

  /**
   * The tool settled, with the CLI's own verdict on it.
   *
   * Settled from HERE and not from the `toolResult` message that follows: the
   * two carry the same result, and settling twice would be a
   * `tool-settled-twice` violation. This one is chosen because `isError` is an
   * explicit boolean on it rather than something to infer from the payload.
   */
  #toolEnd(line: PiLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const id = line.toolCallId;
    if (typeof id !== "string" || id.length === 0) return [];
    this.#openTools.delete(id);
    const outcome = line.isError === true ? "error" : "ok";
    const settled = sequencer.toolCompleted({
      providerToolId: id,
      outcome,
      resultSnippet: summarizeResult(line.result),
      providerAt: null,
    });
    const completed = settled.find((event) => event.kind === "tool.completed");
    if (this.#images !== undefined && completed?.kind === "tool.completed") {
      for (const image of toolResultImages(line.result)) {
        this.#images.push(Object.freeze({ toolCallId: completed.toolCallId,
          toolName: typeof line.toolName === "string" ? line.toolName : "tool", outcome, ...image }));
      }
    }
    return settled;
  }

  /**
   * One provider API call finished. This is the only place usage is counted,
   * and it is counted PER TURN and summed — the exact inverse of T13's rule,
   * for a reason that is a property of the provider rather than a preference.
   *
   * The Claude CLI reports a running usage block on every `message_delta` AND a
   * true total on its terminal, so summing there would double-count. pi reports
   * usage per turn and reports NO total anywhere: `agent_end` carries only
   * `messages` and `willRetry`. So a run that made two API calls to answer one
   * prompt — which the captured probe did — is only fully described by the sum,
   * and refusing to sum would silently report the last turn as the whole run.
   *
   * Each turn's report is emitted as its own `usage` event, rather than one
   * aggregate at the end. That keeps every number an event the provider
   * actually reported at the moment it reported it, and it means a run
   * cancelled after its first turn still carries that turn's measured usage
   * instead of nothing.
   */
  #turnEnd(line: PiLine, sequencer: EventSequencer): readonly NormalizedEvent[] {
    const message = line.message;
    if (message === undefined || message.role !== "assistant") return [];
    this.#noteStop(message);
    const at = providerAt(message);
    const usage = message.usage;
    // A turn carrying NO usage block is a provider that did not report — which
    // is not the same as a provider whose report could not be read, and must
    // not be accused of the second.
    if (usage === undefined || usage === null) return [];
    this.#addCost(usage);
    return sequencer.usage(mapUsage(usage), at);
  }

  /** Sums the provider's own price. `null` stays `null` until one is reported. */
  #addCost(usage: PiUsage): void {
    const total = usage.cost?.total;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return;
    this.#session.costUsd = (this.#session.costUsd ?? 0) + total;
  }

  #noteStop(message: PiMessage | undefined): void {
    if (message === undefined || message.role !== "assistant") return;
    if (typeof message.stopReason === "string" && message.stopReason.length > 0) {
      this.#stopReason = message.stopReason;
    }
    if (typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0) {
      this.#errorMessage = message.errorMessage.trim();
      // Stamped HERE, when the refusal is read, and not at `agent_settled`.
      // pi's reset is a RELATIVE phrase computed against its clock at the moment
      // of the refusal, so the anchor has to be the host's clock at the nearest
      // moment it can observe — anything later adds the intervening time to a
      // deadline that was already counting down. A stream paused ten minutes
      // between the error and the terminal would otherwise report a reset ten
      // minutes late.
      this.#errorAt = this.#now();
    }
  }

  /**
   * The terminal, decided by the last stop reason the run reported.
   *
   * `aborted` becomes `run.cancelled` rather than a failure, and that matters
   * beyond the label: if the HOST cancelled, its own cancellation path would
   * also produce `run.cancelled`, so the two agree instead of racing to
   * contradict each other over which terminal a killed run gets.
   *
   * Anything that is not `error` or `aborted` completes. `exitCode` is `null`,
   * not `0`: the process's real exit code lives on `transport.exit` and this
   * decoder never sees it, so `0` would be a measurement it did not take —
   * `null ≠ 0` applies to exit codes for the same reason it applies to tokens.
   */
  #settle(sequencer: EventSequencer): readonly NormalizedEvent[] {
    if (this.#stopReason === "aborted") {
      return sequencer.cancel(
        `the pi CLI reported the run aborted${this.#errorMessage === null ? "" : `: ${this.#errorMessage}`}`,
      );
    }
    if (this.#stopReason !== "error") return sequencer.complete(null);

    const message = this.#errorMessage ?? "the pi CLI reported an error result";
    // REVIEWED READING of this route's own error path
    // (`openai-codex-responses.ts:1471-1477`), not of captured bytes: no
    // exhausted ChatGPT window has been captured. What the mapping proves is
    // the HOST's rule — quota-shaped text ends the run with the reset it can
    // recover, and never with a retry — not the provider's exact wording.
    if (!QUOTA_SHAPED.test(message)) {
      return sequencer.fail("E_BACKEND_FAILURE", message);
    }
    return [
      ...sequencer.quota({ scope: "provider", resetAt: this.#resetFrom(message), message }),
      ...sequencer.fail("E_QUOTA_EXHAUSTED", message),
    ];
  }

  /**
   * The reset time, from the only shape this route states it in.
   *
   * pi renders the provider's absolute `resets_at` as a RELATIVE phrase — "Try
   * again in ~37 min" — having computed the minutes against its own clock at
   * the moment of the refusal. Adding them back to the host's clock recovers
   * the absolute time to within the minute pi rounded to, and both clocks are
   * this machine's, so the recovery is arithmetic rather than a guess.
   *
   * Anything else stays `null`. An unreported reset is a gap; a nonsense one is
   * a lie, and the gap is the honest failure.
   */
  #resetFrom(message: string): string | null {
    const minutes = Number(RESET_IN_MINUTES.exec(message)?.[1]);
    if (!Number.isFinite(minutes)) return null;
    const from = Date.parse(this.#errorAt ?? this.#now());
    if (!Number.isFinite(from)) return null;
    return new Date(from + minutes * 60_000).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Payload helpers. Pure, and each one is a decision about what the host is
// entitled to claim from bytes it did not write.
// ---------------------------------------------------------------------------

/**
 * Provider timestamps are ADVISORY, and pi's are Unix MILLISECONDS.
 *
 * The range check is the whole point. A value outside it is not milliseconds —
 * a seconds stamp is the obvious way it happens, and it would land the event in
 * 1970 — so the host declines to guess which unit it was handed. Bounds are
 * 2001-09-09 and 2096-10-02, the same window T13's seconds reader uses, times a
 * thousand.
 */
const EPOCH_MILLIS_MIN = 1_000_000_000_000;
const EPOCH_MILLIS_MAX = 4_000_000_000_000;

export function epochMillisToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < EPOCH_MILLIS_MIN || value > EPOCH_MILLIS_MAX) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function providerAt(message: PiMessage | undefined): string | null {
  return message === undefined ? null : epochMillisToIso(message.timestamp);
}

/**
 * A tool result, which pi shapes as `{ content: [{ type: "text", text }] }`.
 *
 * The text blocks are joined when the shape is that one, and the whole value is
 * summarized when it is not. Reading the shape is worth it because the
 * alternative puts `{"content":[{"type":"text","text":"…` in front of every
 * result in the trace, spending the snippet's budget on the envelope instead of
 * on the answer.
 */
function summarizeResult(result: unknown): string {
  if (result === null || typeof result !== "object") return summarize(result);
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return summarize(redactToolImages(result));
  const texts = content
    .filter((block): block is { text: string } => {
      if (block === null || typeof block !== "object") return false;
      return typeof (block as { text?: unknown }).text === "string";
    })
    .map((block) => block.text);
  // An image-only result would otherwise put its base64 payload in the journal.
  return texts.length === 0 ? summarize(redactToolImages(result)) : summarize(texts.join("\n"));
}

/**
 * The five metrics, and only the five.
 *
 * Mapped explicitly rather than passed through: `normalizeUsage` reports every
 * key it does not carry as a fault, and pi's usage block carries two this
 * contract has no home for — `totalTokens` (which is arithmetic on the others)
 * and `cost` (which is money, and money is not a token count). Forwarding them
 * would produce a `malformed-usage` notice on every healthy run and train
 * everyone to ignore it.
 *
 * The VALUES are forwarded unjudged, so a provider that reports a string where
 * a count belonged still produces the fault it should.
 *
 * `input` is pi's own non-cached input: it subtracts `cached_tokens` from the
 * API's `input_tokens` before reporting (`openai-responses-shared.ts:364-367`),
 * so `inputTokens` and `cacheReadTokens` here are disjoint and adding them
 * gives the API's figure. That is a property of pi's mapping and not of this
 * contract, which only asks that each metric be what the provider said it was.
 *
 * `reasoningRelation` is `included-in-output` — the one route in this harness
 * that states a relation rather than `unknown`. The evidence is pi's own
 * mapping, twice: `reasoning` is read out of `output_tokens_details.reasoning_
 * tokens`, a BREAKDOWN of `output_tokens`, which is what `output` is read from
 * (`openai-responses-shared.ts:366-370`); and pi says so in words for the
 * sibling API it shares the vendor's semantics with — "OpenAI completion_tokens
 * already includes reasoning_tokens" (`openai-completions.ts:1134`). The
 * captured probe reported `reasoning: 0`, so it CONFIRMS nothing here and is
 * not offered as though it did.
 */
function mapUsage(usage: unknown): unknown {
  // Anything that is not an object is forwarded UNTOUCHED so `normalizeUsage`
  // can report it as unreadable. Mapping it here would read five fields off a
  // string, get `undefined` five times, and turn a malformed provider report
  // into five honest-looking nulls with no fault attached.
  if (usage === null || typeof usage !== "object") return usage;
  const source = usage as Record<string, unknown>;
  return {
    inputTokens: source["input"] ?? null,
    outputTokens: source["output"] ?? null,
    cacheReadTokens: source["cacheRead"] ?? null,
    cacheWriteTokens: source["cacheWrite"] ?? null,
    reasoningTokens: source["reasoning"] ?? null,
    reasoningRelation: "included-in-output",
  };
}

/**
 * Quota-shaped error text.
 *
 * The first alternation is carried unchanged from T13's reading of the Claude
 * CLI, because a host rule that recognized one provider's exhaustion and not
 * the other's would be a rule with a hole in it. The rest is this route's own
 * vocabulary, read off `openai-codex-responses.ts:115` — `isTerminalRateLimitError`,
 * the function pi itself uses to decide that a 429 is final rather than
 * retryable — plus the sentence pi builds for the operator at line 1477, "You
 * have hit your ChatGPT usage limit".
 *
 * TWO alternations T13's copy carries are deliberately absent here, and both
 * absences are this route's own reading rather than a simplification:
 *
 *   · bare `limit reached` matches "context token limit reached", which is a
 *     full context window — an `E_BACKEND_FAILURE` the operator fixes by
 *     sending less, not a subscription they fix by waiting.
 *   · bare `rate limit` is worse here than it is on T13's route, because pi
 *     itself disagrees with it. `isTerminalRateLimitError` exists precisely to
 *     separate a plain 429, which pi RETRIES, from the usage/billing forms it
 *     treats as final. Classifying "Rate limit exceeded" as exhaustion tells
 *     the host a transient throttle is a spent subscription — and since quota
 *     is structurally never a retry, the phase is lost to a condition that
 *     would have cleared on its own.
 *
 * Both of this route's real refusal texts still match, on `usage limit`.
 */
const QUOTA_SHAPED =
  /\b(?:usage limit|quota|insufficient_quota|out of budget|billing)\b|\b(?:usage|plan|subscription|account) limit reached\b|available balance|UsageLimitError/i;

/** `Try again in ~37 min.` — pi's rendering of the provider's `resets_at`. */
const RESET_IN_MINUTES = /try again in\s*~?\s*(\d{1,6})\s*min/i;
