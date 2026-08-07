// The output budget: what a run is allowed to EMIT.
//
// Two dimensions, both from `awsf.config.yaml` § runtime, and a unit test pins
// these defaults against that file so the two cannot drift apart unnoticed:
//
//   max_output_bytes  — how much provider text a run may put into the journal
//   max_event_count   — how many events a run may put into it
//
// The load-bearing rule is what the budget is NOT allowed to do. It never
// refuses a terminal event, never refuses the settlement a tool call already
// obliged, and never refuses `run.started`. A budget that could drop a terminal
// would turn "this run produced too much output" into "this run never ended",
// which is a strictly worse thing to have to explain — and it would do it
// silently, which is the defect class this whole milestone exists to eliminate.
// So the cap is held against *optional* provider events only, with the mandatory
// ones reserved out of it in advance.
//
// ---------------------------------------------------------------------------
// `truncateToCodePoint` is a LITERAL PORT — attribution per the plan's Q9:
//
//   MIT License · Copyright (c) 2026 IndyDevDan
//   fusion-harness `core/adapters.ts:81-96`
//
// The reserve-one-slot-for-the-notice rule in `offer` and the floor-budget case
// in `claimNotice` are ports of the same file's `#fits`/`emit`
// (`core/adapters.ts:305-339`) in shape, rewritten against AWSF's own vocabulary.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `runtime.max_output_bytes` in `awsf.config.yaml`. */
export const DEFAULT_MAX_OUTPUT_BYTES = 67_108_864;

/** `runtime.max_event_count` in `awsf.config.yaml`. */
export const DEFAULT_MAX_EVENT_COUNT = 100_000;

/**
 * `run.started` plus one terminal — the shortest stream that is still a run.
 *
 * A cap below this cannot hold a well-formed stream at all. The budget spends
 * past it rather than emitting a run that never settles, and says so.
 */
export const MIN_WELL_FORMED_EVENTS = 2;

/**
 * The longest prefix of `bytes` no longer than `limit` that ends on a UTF-8 code
 * point boundary.
 *
 * The decision is made on the bytes, never on the decoded text. Deciding on the
 * text would mean asking whether the result ends in U+FFFD, which cannot
 * distinguish a code point this cut split from a replacement character the
 * provider itself sent, so the guarantee would silently lapse on any stream
 * carrying one.
 */
export function truncateToCodePoint(bytes: Uint8Array, limit: number): Uint8Array {
  let end = Math.min(Math.max(limit, 0), bytes.length);
  // A continuation byte is 0b10xxxxxx; a cut immediately before one splits a code point.
  while (end > 0 && ((bytes[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return bytes.subarray(0, end);
}

export interface OutputBudgetOptions {
  maxOutputBytes?: number;
  maxEventCount?: number;
}

/** What of a text delta fits, and whether anything was left behind. */
export interface TextFit {
  /** The prefix that fits, cut on a code point boundary. Empty when nothing does. */
  text: string;
  /** UTF-8 bytes in `text` — what `chargeText` is to be given once it is emitted. */
  bytes: number;
  /** The value did not fit whole. */
  cut: boolean;
}

/** Which dimension ran out. One notice per run announces the first one to. */
export type TruncationDimension = "bytes" | "events";

export interface TruncationNotice {
  dimension: TruncationDimension;
  message: string;
  detail: string;
}

export class OutputBudget {
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  #textBytes = 0;
  #events = 0;
  /** Settlements owed by tool calls already emitted. Reserved, never refusable. */
  #obligations = 0;
  #truncated = false;
  #capped = false;
  #pending: TruncationNotice | null = null;
  #announced = false;

  constructor(options: OutputBudgetOptions = {}) {
    this.#maxBytes = positive(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes");
    this.#maxEvents = positive(options.maxEventCount ?? DEFAULT_MAX_EVENT_COUNT, "maxEventCount");
  }

  get maxOutputBytes(): number {
    return this.#maxBytes;
  }

  get maxEventCount(): number {
    return this.#maxEvents;
  }

  get textBytes(): number {
    return this.#textBytes;
  }

  get eventCount(): number {
    return this.#events;
  }

  /** The byte budget is spent; further text is dropped. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /** The event cap is reached; further optional events are dropped. */
  get capped(): boolean {
    return this.#capped;
  }

  /**
   * A cap this small cannot hold `run.started` plus a terminal.
   *
   * Reported rather than enforced: the caller still emits both, knowingly
   * spending past a cap it was given, because a stream with no terminal is the
   * worse breach of the two.
   */
  get unsatisfiable(): boolean {
    return this.#maxEvents < MIN_WELL_FORMED_EVENTS;
  }

  /** One terminal, plus one settlement per tool call left open. */
  get owed(): number {
    return 1 + this.#obligations;
  }

  /**
   * Offers `cost` OPTIONAL event slots. Charges them and returns `true` if they
   * fit; latches the cap and returns `false` if they do not.
   *
   * One slot beyond the caller's own cost is held back for the truncation
   * notice, so refusing an event never has to overrun the cap to explain the
   * refusal. That makes the bound conservative by one: a stream that would have
   * exactly filled the budget spends its last slot on the notice instead of on a
   * provider event — and the notice is still truthful, because that event really
   * was discarded.
   */
  offer(cost = 1): boolean {
    if (this.#capped) return false;
    if (this.#events + this.owed + cost + 1 <= this.#maxEvents) {
      this.#events += cost;
      return true;
    }
    this.#capped = true;
    this.#pending ??= {
      dimension: "events",
      message: "event budget reached; remaining provider events were discarded",
      detail: `max_event_count ${this.#maxEvents} reached after ${this.#events} events`,
    };
    return false;
  }

  /**
   * Charges an event the budget may never refuse — `run.started`, a settlement
   * a tool call already obliged, a terminal, or the truncation notice itself.
   */
  spend(cost = 1): void {
    this.#events += cost;
  }

  /** A tool call was emitted: the settlement it obliges is reserved from here on. */
  oblige(): void {
    this.#obligations += 1;
  }

  /** That settlement was emitted; the reservation is released. */
  discharge(): void {
    if (this.#obligations > 0) this.#obligations -= 1;
  }

  /**
   * What of `value` fits inside the byte budget.
   *
   * The overflow cut is one encode and one byte slice rather than a
   * shrink-and-retry search, so fitting text to the budget costs the same no
   * matter how far the provider overshoots it. A cut that lands mid code point
   * is always pulled back to the boundary, so no partial code point is ever
   * emitted as a replacement character.
   *
   * Truncation is one-way. Pulling a cut back to a code point boundary can leave
   * up to three bytes of headroom, and a later short delta slipping into it would
   * arrive after a notice that reads as final.
   */
  fitText(value: string): TextFit {
    if (this.#truncated) return { text: "", bytes: 0, cut: true };
    const remaining = this.#maxBytes - this.#textBytes;
    if (remaining <= 0) {
      this.#markTruncated();
      return { text: "", bytes: 0, cut: true };
    }
    const encoded = encoder.encode(value);
    if (encoded.length <= remaining) return { text: value, bytes: encoded.length, cut: false };
    const fitted = truncateToCodePoint(encoded, remaining);
    this.#markTruncated();
    return { text: decoder.decode(fitted), bytes: fitted.length, cut: true };
  }

  /** Commits the bytes of a fitted delta that was actually emitted. */
  chargeText(bytes: number): void {
    this.#textBytes += bytes;
  }

  /**
   * The truncation notice, at most once per run, and only while there is a slot
   * left to put it in.
   *
   * At the floor budget the mandatory events consume the whole cap and the
   * notice has nowhere to go. The cap wins: truncation goes unannounced rather
   * than overrunning the budget the caller asked for. The flag is cleared either
   * way, so a suppressed notice is not retried on the next event.
   *
   * Returning the notice CHARGES its slot — the slot `offer` reserved. The
   * caller emits it and does not call `spend` for it.
   */
  claimNotice(): TruncationNotice | null {
    const pending = this.#pending;
    this.#pending = null;
    if (pending === null || this.#announced) return null;
    if (this.#events + this.owed + 1 > this.#maxEvents) return null;
    this.#announced = true;
    this.#events += 1;
    return pending;
  }

  #markTruncated(): void {
    if (this.#truncated) return;
    this.#truncated = true;
    this.#pending ??= {
      dimension: "bytes",
      message: "output exceeded the run byte budget; the remainder was discarded",
      detail: `max_output_bytes ${this.#maxBytes} reached after ${this.#textBytes} bytes`,
    };
  }
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer, got ${String(value)}`);
  }
  return value;
}
