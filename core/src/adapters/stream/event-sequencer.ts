// Stage three: parsed lines become a sequenced, bounded, normalized event run.
//
// The sequencer owns every invariant in the plan's twelve-event list that holds
// over a RUN rather than over a single event, and it owns them by construction
// rather than by inspection:
//
//   · `seq` is authoritative and host-minted; `providerAt` is advisory, is never
//     sorted on, and a clock that goes backwards produces a `clock-skew` notice
//     instead of a reordered stream.
//   · Exactly one terminal event per run. There is no path that emits a second
//     one and no path that emits none — `finish()` fails the run closed with
//     `E_TERMINAL_MISSING` rather than letting a stream that merely stopped look
//     like a stream that succeeded.
//   · `tool.completed` is an EXPLICIT settlement. A terminal never closes a tool
//     call implicitly: every open call gets its own visible `tool.completed`
//     event, before the terminal, saying how it ended — `cancelled` when the run
//     was cancelled, `error` when a terminal arrived over the top of it.
//   · Provider tool ids never reach a normalized event. They are Map keys here
//     and nothing else; the host mints `t1, t2, …`.
//   · `null ≠ 0` on every token metric: a field the provider did not report is
//     `null`, and a `0` it did report is data.
//   · A model identity the harness cannot represent does not silently resolve.
//     It fails closed with `E_MODEL_UNRESOLVED`, and so does a run that reaches
//     `run.completed` having never named a model at all — unless the caller
//     supplied a route-attributed identity, which is emitted with
//     `provenance: "route-attributed"` so the UI can never present an inferred
//     identity as a confirmed one.
//
// Every method returns the events it produced, zero or more, in order. That is
// what lets an adapter's `parse` stay a generator over a live stream: nothing is
// buffered here, and a hundred-thousand-event run costs the sequencer a handful
// of counters rather than a hundred thousand retained objects.

import {
  mintToolCallId,
  type ModelResolutionProvenance,
  type NormalizedEvent,
  type NoticeCode,
  type RunErrorCode,
  type TerminalEventKind,
  type ToolOutcome,
} from "../../contracts/normalized-events.ts";
import { OutputBudget } from "./output-budget.ts";
import { isRepresentableIdentity, type ModelIdentity } from "./model-identity.ts";
import { normalizeUsage } from "./usage.ts";

const NO_EVENTS: readonly NormalizedEvent[] = Object.freeze([]);

/**
 * An event minus the four fields the host stamps on every one of them.
 *
 * Mapped over the kinds rather than written as `Omit<NormalizedEvent, …>`:
 * omitting from a union collapses it to the fields the members share, which
 * would make `errorCode`, `exitCode` and the rest unassignable. This keeps each
 * kind's own payload checked.
 */
export type EventBody = {
  [K in NormalizedEvent["kind"]]: Omit<
    Extract<NormalizedEvent, { kind: K }>,
    "seq" | "runId" | "hostAt" | "providerAt"
  >;
}[NormalizedEvent["kind"]];

export type { ModelIdentity };

export interface EventSequencerOptions {
  runId: string;
  /** Host observation time. Injected so a replayed transcript is byte-stable. */
  now?: () => string;
  budget?: OutputBudget;
  /**
   * The identity the ROUTE implies, for a run whose stream never names one.
   *
   * Supplying it is a claim the adapter has to be able to make: that the route
   * it asked for determines the model that answered. When it is absent — the
   * default, and the stub's case — a run that completes without a
   * stream-authoritative identity fails closed instead.
   */
  attributedModel?: ModelIdentity;
}

/** A tool name the host is willing to show. Anything else becomes `tool`. */
const REPRESENTABLE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

interface OpenTool {
  toolCallId: string;
  requestedAt: number;
}

export class EventSequencer {
  readonly #runId: string;
  readonly #now: () => string;
  readonly #budget: OutputBudget;
  readonly #attributed: ModelIdentity | null;

  #seq = 0;
  #started = false;
  #terminal: TerminalEventKind | null = null;
  #resolved: ModelIdentity | null = null;
  #provenance: ModelResolutionProvenance | null = null;
  #openTools = new Map<string, OpenTool>();
  #toolCount = 0;
  #lastProviderAt: number | null = null;
  #skewNoticed = false;

  constructor(options: EventSequencerOptions) {
    if (options.runId.length === 0) throw new RangeError("runId must not be empty");
    this.#runId = options.runId;
    this.#now = options.now ?? ((): string => new Date().toISOString());
    this.#budget = options.budget ?? new OutputBudget();
    this.#attributed = options.attributedModel ?? null;
  }

  get runId(): string {
    return this.#runId;
  }

  /** Events stamped so far. The next one carries `seq + 1`. */
  get seq(): number {
    return this.#seq;
  }

  /** The terminal that settled this run, or `null` while it is still open. */
  get terminal(): TerminalEventKind | null {
    return this.#terminal;
  }

  /** The identity the run resolved to, with the provenance it was resolved by. */
  get resolvedModel(): (ModelIdentity & { provenance: ModelResolutionProvenance }) | null {
    if (this.#resolved === null || this.#provenance === null) return null;
    return { ...this.#resolved, provenance: this.#provenance };
  }

  get openToolCount(): number {
    return this.#openTools.size;
  }

  get budget(): OutputBudget {
    return this.#budget;
  }

  // -------------------------------------------------------------------------
  // Provider events.
  // -------------------------------------------------------------------------

  /**
   * Opens the stream.
   *
   * `run.started` is charged but never refused: a stream the budget opened with
   * a notice instead of an opening event would be unreadable, and the cap is
   * held against provider chatter, not against the run's own skeleton. A second
   * one is a provider that announced itself twice — reported as an unknown
   * event, never emitted as a second `run.started`.
   */
  started(input: {
    adapter: string;
    requestedModel: string;
    providerAt?: string | null;
  }): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const providerAt = input.providerAt ?? null;
    if (this.#started) {
      return this.notice(
        "unknown-provider-event",
        "the provider opened the same run twice",
        `a second run.started naming ${JSON.stringify(input.requestedModel)} was not emitted`,
        providerAt,
      );
    }
    this.#started = true;
    const out = [...this.#clockAdvisory(providerAt)];
    this.#budget.spend();
    out.push(
      this.#stamp(
        {
          kind: "run.started",
          adapter: nonEmpty(input.adapter, "unknown-adapter"),
          requestedModel: nonEmpty(input.requestedModel, "unknown-model"),
        },
        providerAt,
      ),
    );
    return out;
  }

  /**
   * The provider named the model that answered.
   *
   * Charged but never refused, for the same reason a terminal is not: an
   * identity the budget dropped would make `complete()` fail closed with
   * `E_MODEL_UNRESOLVED`, turning "this run said too much" into "this run could
   * not say what it was" — a false statement about the provider.
   */
  resolveModel(
    identity: ModelIdentity & { provenance: ModelResolutionProvenance; providerAt?: string | null },
  ): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const providerAt = identity.providerAt ?? null;
    if (!isRepresentableIdentity(identity)) {
      return this.fail(
        "E_MODEL_UNRESOLVED",
        `the provider named a model identity the harness cannot represent: ` +
          `${JSON.stringify(identity.provider)} / ${JSON.stringify(identity.resolvedModel)}`,
        providerAt,
      );
    }
    const previous = this.#resolved;
    if (previous !== null) {
      if (
        previous.resolvedModel === identity.resolvedModel &&
        previous.provider === identity.provider &&
        previous.requestedModel === identity.requestedModel
      ) {
        return NO_EVENTS;
      }
      return this.fail(
        "E_MODEL_MISMATCH",
        `the provider resolved to ${previous.provider}/${previous.resolvedModel} and then to ` +
          `${identity.provider}/${identity.resolvedModel}; a run answers on one model`,
        providerAt,
      );
    }
    return this.#resolveTo(
      {
        adapter: identity.adapter,
        provider: identity.provider,
        requestedModel: identity.requestedModel,
        resolvedModel: identity.resolvedModel,
      },
      identity.provenance,
      providerAt,
    );
  }

  /** A text or thinking delta, bounded by the byte budget. */
  text(
    kind: "text.delta" | "thinking.delta",
    value: string,
    providerAt: string | null = null,
  ): readonly NormalizedEvent[] {
    if (this.#terminal !== null || value.length === 0) return NO_EVENTS;
    const out = [...this.#clockAdvisory(providerAt)];
    const fit = this.#budget.fitText(value);
    if (fit.text.length > 0 && this.#budget.offer()) {
      out.push(this.#stamp({ kind, text: fit.text }, providerAt));
      this.#budget.chargeText(fit.bytes);
    }
    this.#drainNotice(out);
    return out;
  }

  /**
   * A tool call opened.
   *
   * The settlement it obliges is reserved from the event budget BEFORE the
   * request is offered one, so a request that fits is always a request whose
   * settlement will fit too. A request the budget refuses opens nothing — an
   * unpaired `tool.completed` later would be a sequence violation the host
   * caused itself.
   */
  toolRequested(input: {
    providerToolId: string;
    name: string;
    inputSummary: string;
    providerAt?: string | null;
  }): readonly NormalizedEvent[] {
    if (this.#terminal !== null || input.providerToolId.length === 0) return NO_EVENTS;
    const providerAt = input.providerAt ?? null;
    const out = [...this.#clockAdvisory(providerAt)];
    if (this.#openTools.has(input.providerToolId)) {
      this.#drainNotice(out);
      return out;
    }
    this.#budget.oblige();
    if (!this.#budget.offer()) {
      this.#budget.discharge();
      this.#drainNotice(out);
      return out;
    }
    this.#toolCount += 1;
    const toolCallId = mintToolCallId(this.#toolCount);
    const event = this.#stamp(
      {
        kind: "tool.requested",
        toolCallId,
        name: REPRESENTABLE_TOOL_NAME.test(input.name) ? input.name : "tool",
        inputSummary: input.inputSummary,
      },
      providerAt,
    );
    this.#openTools.set(input.providerToolId, { toolCallId, requestedAt: msOf(event.hostAt) });
    out.push(event);
    this.#drainNotice(out);
    return out;
  }

  /**
   * A tool call settled. Charged but never refused — the slot was reserved when
   * the request was emitted, and dropping a settlement is what "implicitly
   * closed by the terminal" means.
   */
  toolCompleted(input: {
    providerToolId: string;
    outcome: ToolOutcome;
    resultSnippet: string;
    providerAt?: string | null;
  }): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const providerAt = input.providerAt ?? null;
    const open = this.#openTools.get(input.providerToolId);
    if (open === undefined) {
      // Never emitted as an unpaired settlement: `validateEventSequence` would
      // read that as `tool-settled-without-request`, and it would be right.
      return this.notice(
        "unknown-provider-event",
        "the provider settled a tool call the host never opened",
        `outcome ${input.outcome} arrived for a call with no preceding request`,
        providerAt,
      );
    }
    this.#openTools.delete(input.providerToolId);
    this.#budget.discharge();
    return this.#settle(open, input.outcome, input.resultSnippet, providerAt);
  }

  /** Provider-reported token usage, normalized so `null` never becomes `0`. */
  usage(raw: unknown, providerAt: string | null = null): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const { usage, faults } = normalizeUsage(raw);
    const out: NormalizedEvent[] = [];
    if (faults.length > 0) {
      // Emitted first: the caveat qualifies the numbers that follow it.
      out.push(
        ...this.notice(
          "malformed-usage",
          "the provider reported usage the host could not read; unreadable metrics are null, not zero",
          faults.join("; "),
          providerAt,
        ),
      );
    }
    out.push(...this.#optional({ kind: "usage", usage }, providerAt));
    return out;
  }

  /** A quota observation. Never a retry — it carries the reset time and blocks. */
  quota(input: {
    scope: string;
    resetAt: string | null;
    message: string;
    providerAt?: string | null;
  }): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    return this.#optional(
      {
        kind: "quota",
        scope: nonEmpty(input.scope, "provider"),
        resetAt: input.resetAt,
        message: input.message,
      },
      input.providerAt ?? null,
    );
  }

  notice(
    code: NoticeCode,
    message: string,
    detail: string | null,
    providerAt: string | null = null,
  ): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    return this.#optional(
      { kind: "notice", code, message: nonEmpty(message, code), detail },
      providerAt,
    );
  }

  // -------------------------------------------------------------------------
  // Terminals. Exactly one, always, and never over an open tool call.
  // -------------------------------------------------------------------------

  /**
   * The provider finished.
   *
   * A run that reaches here having never named a model does not complete: with
   * no route-attributed identity to fall back on it fails closed with
   * `E_MODEL_UNRESOLVED`, because an unnamed model is the one thing a completed
   * run's record cannot be reconstructed without.
   */
  complete(exitCode: number | null, providerAt: string | null = null): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const out = [...this.#clockAdvisory(providerAt)];
    out.push(...this.#settleAll("error", "the run's terminal arrived while this call was still open"));
    out.push(...this.#attributeModel(providerAt));
    if (this.#resolved === null) {
      return [
        ...out,
        ...this.#terminate(
          {
            kind: "run.failed",
            errorCode: "E_MODEL_UNRESOLVED",
            message: "the run completed without ever naming the model that answered",
          },
          providerAt,
        ),
      ];
    }
    return [...out, ...this.#terminate({ kind: "run.completed", exitCode }, providerAt)];
  }

  /**
   * The run failed.
   *
   * No model requirement here: a failure already has a cause, and replacing it
   * with a bookkeeping one would lose the only useful thing the event carries.
   */
  fail(
    errorCode: RunErrorCode,
    message: string,
    providerAt: string | null = null,
  ): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const out = [...this.#clockAdvisory(providerAt)];
    out.push(...this.#settleAll("error", "the run's terminal arrived while this call was still open"));
    return [
      ...out,
      ...this.#terminate({ kind: "run.failed", errorCode, message: nonEmpty(message, errorCode) }, providerAt),
    ];
  }

  /**
   * The run was cancelled.
   *
   * Every open tool call is settled `cancelled` FIRST, explicitly, before the
   * terminal — this is the case the plan names, and the ordering is the whole
   * point of it: a consumer reading the stream in order never has to infer that
   * a terminal closed something.
   */
  cancel(reason: string, providerAt: string | null = null): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    const out = [...this.#clockAdvisory(providerAt)];
    out.push(...this.#settleAll("cancelled", "the run was cancelled while this call was open"));
    return [...out, ...this.#terminate({ kind: "run.cancelled", reason: nonEmpty(reason, "cancelled") }, providerAt)];
  }

  /**
   * End of stream.
   *
   * A stream that simply stopped did not succeed quietly. If nothing settled the
   * run, it failed, and it says which way.
   */
  finish(): readonly NormalizedEvent[] {
    if (this.#terminal !== null) return NO_EVENTS;
    return this.fail("E_TERMINAL_MISSING", "the provider's stream ended without a terminal event");
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  #stamp(body: EventBody, providerAt: string | null): NormalizedEvent {
    return this.#stampAt(body, providerAt, this.#now());
  }

  #stampAt(body: EventBody, providerAt: string | null, hostAt: string): NormalizedEvent {
    this.#seq += 1;
    // The one cast is here rather than at each call site: spreading a union into
    // an object literal is something the compiler cannot follow, and a dozen
    // casts would be a dozen places for a real mistake to hide.
    return { ...body, seq: this.#seq, runId: this.#runId, hostAt, providerAt } as NormalizedEvent;
  }

  /** An optional provider event: offered to the budget, dropped if it will not fit. */
  #optional(body: EventBody, providerAt: string | null): readonly NormalizedEvent[] {
    const out = [...this.#clockAdvisory(providerAt)];
    if (this.#budget.offer()) out.push(this.#stamp(body, providerAt));
    this.#drainNotice(out);
    return out;
  }

  #drainNotice(out: NormalizedEvent[]): void {
    const truncation = this.#budget.claimNotice();
    if (truncation === null) return;
    out.push(
      this.#stamp(
        { kind: "notice", code: "output-truncated", message: truncation.message, detail: truncation.detail },
        null,
      ),
    );
  }

  /**
   * Sequence is authoritative; provider timestamps are advisory.
   *
   * A clock that jumps backwards or that cannot be read at all is a fact about
   * the run, so it is recorded — once. A provider with a broken clock stamps
   * every line, and a notice per line would bury the stream it is describing.
   */
  #clockAdvisory(providerAt: string | null): readonly NormalizedEvent[] {
    if (providerAt === null) return NO_EVENTS;
    const at = Date.parse(providerAt);
    let detail: string | null = null;
    if (!Number.isFinite(at)) {
      detail = `providerAt ${JSON.stringify(providerAt)} is not a readable timestamp`;
    } else {
      if (this.#lastProviderAt !== null && at < this.#lastProviderAt) {
        detail = `providerAt ${providerAt} precedes the previous one; seq, not the clock, orders this run`;
      }
      this.#lastProviderAt = Math.max(this.#lastProviderAt ?? at, at);
    }
    if (detail === null || this.#skewNoticed) return NO_EVENTS;
    this.#skewNoticed = true;
    this.#budget.spend();
    return [
      this.#stamp(
        {
          kind: "notice",
          code: "clock-skew",
          message: "the provider's timestamps are advisory and this run's cannot be trusted for ordering",
          detail,
        },
        null,
      ),
    ];
  }

  #resolveTo(
    identity: ModelIdentity,
    provenance: ModelResolutionProvenance,
    providerAt: string | null,
  ): readonly NormalizedEvent[] {
    this.#resolved = identity;
    this.#provenance = provenance;
    this.#budget.spend();
    return [
      this.#stamp(
        {
          kind: "model.resolved",
          adapter: nonEmpty(identity.adapter, "unknown-adapter"),
          provider: identity.provider,
          requestedModel: nonEmpty(identity.requestedModel, identity.resolvedModel),
          resolvedModel: identity.resolvedModel,
          provenance,
        },
        providerAt,
      ),
    ];
  }

  /** The route's identity, emitted only if the stream never gave one of its own. */
  #attributeModel(providerAt: string | null): readonly NormalizedEvent[] {
    const attributed = this.#attributed;
    if (this.#resolved !== null || attributed === null) return NO_EVENTS;
    // A configured fallback that is itself unrepresentable resolves nothing, and
    // the caller falls through to failing closed — which is the right direction.
    if (!isRepresentableIdentity(attributed)) return NO_EVENTS;
    return this.#resolveTo(attributed, "route-attributed", providerAt);
  }

  #settleAll(outcome: ToolOutcome, snippet: string): readonly NormalizedEvent[] {
    if (this.#openTools.size === 0) return NO_EVENTS;
    const out: NormalizedEvent[] = [];
    for (const open of this.#openTools.values()) {
      this.#budget.discharge();
      out.push(...this.#settle(open, outcome, snippet, null));
    }
    this.#openTools.clear();
    return out;
  }

  #settle(
    open: OpenTool,
    outcome: ToolOutcome,
    resultSnippet: string,
    providerAt: string | null,
  ): readonly NormalizedEvent[] {
    this.#budget.spend();
    // Duration is measured on the HOST's own clock, from the two `hostAt` stamps
    // this sequencer minted — never from provider timestamps, which are advisory
    // and may not exist at all.
    const hostAt = this.#now();
    const elapsed = msOf(hostAt) - open.requestedAt;
    return [
      this.#stampAt(
        {
          kind: "tool.completed",
          toolCallId: open.toolCallId,
          outcome,
          durationMs: elapsed > 0 ? Math.round(elapsed) : 0,
          resultSnippet,
        },
        providerAt,
        hostAt,
      ),
    ];
  }

  #terminate(body: EventBody, providerAt: string | null): readonly NormalizedEvent[] {
    this.#terminal = body.kind as TerminalEventKind;
    this.#budget.spend();
    return [this.#stamp(body, providerAt)];
  }
}

function nonEmpty(value: string, fallback: string): string {
  return value.trim().length > 0 ? value : fallback;
}

function msOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}
