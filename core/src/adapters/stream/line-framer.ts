// Stage one of the observability pipeline: provider bytes become lines.
//
// ---------------------------------------------------------------------------
// LITERAL PORT — attribution required by the plan's Q9 resolution.
//
//   MIT License · Copyright (c) 2026 IndyDevDan
//   fusion-harness `core/adapters.ts:98-143` — `LineFramer`, its per-instance
//   streaming decoder, `flush`, and the `frameLines` whole-string entry point.
//   `NO_LINES` is carried with it.
//
// Carried rather than re-derived because the three properties this task has to
// prove are exactly the three that file already implements and tests, and a
// re-derivation would have been a second, subtly different copy of a boundary
// condition nobody wants two opinions about.
//
// AWSF's own additions are the `bytes` counter and `hasPending`; the framing
// logic itself is unchanged from the port.
// ---------------------------------------------------------------------------

import { utf8ByteLength } from "../../contracts/typebox.ts";

const NO_LINES: readonly string[] = Object.freeze([]);

/**
 * The most one unterminated line may hold, in UTF-16 code units.
 *
 * A provider line is `JSON.parse`d whole, and the framer used to hold it without
 * limit. A line grown past V8's string ceiling made `push` throw a RangeError,
 * which surfaced as a backend fault for a stream that was only oversized. Past
 * this ceiling the line is kept to its head instead. The head is not valid JSON,
 * so the decoder reports it as an unreadable line and the run goes on. The
 * ceiling sits far above any real event (a large file read is the usual case)
 * and far below V8's own limit (B11-20).
 */
export const MAX_LINE_LENGTH = 32 * 1024 * 1024;

/**
 * Incremental newline framing.
 *
 * A live child hands over bytes at boundaries it chooses, never at line
 * boundaries, so framing has to be incremental: `push` returns only the lines a
 * newline has closed and carries the rest forward, and `flush` releases whatever
 * an abrupt EOF left behind, so a half-written final line stays visible as a
 * malformed line instead of vanishing.
 *
 * Byte chunks run through one streaming decoder, so a chunk boundary landing
 * inside a multi-byte code point is carried across as well. That decoder is
 * per-framer state and deliberately not a module-level one: two concurrent runs
 * must not share a half-read code point.
 *
 * **Framing bounds no run.** The framer keeps reading lines past the output
 * budget so a run that overruns it can still observe its own terminal event
 * instead of being misreported as a truncated, terminal-less stream. The budget
 * lives one stage downstream, in `output-budget.ts`, and it bounds what is
 * *emitted*, never what is *read*. The only limit framing applies is on one
 * line's own size, at `MAX_LINE_LENGTH`.
 */
export class LineFramer {
  readonly #decoder = new TextDecoder("utf-8");
  #pending = "";
  #bytes = 0;

  /**
   * Bytes handed to this framer.
   *
   * AWSF's own: the liveness monitor's `noteOutput` takes a byte COUNT and
   * refuses to see content, so the framer — which is already touching every
   * byte — is the cheapest honest place to count them. A framer that reported
   * lines instead would let a provider emitting one endless unterminated line
   * look silent.
   */
  get bytes(): number {
    return this.#bytes;
  }

  /** Whether an unterminated tail is currently held — i.e. whether `flush` has anything to release. */
  get hasPending(): boolean {
    return this.#pending.length > 0;
  }

  /** Bytes may split a code point; text is taken as already decoded. */
  push(chunk: Uint8Array | string): readonly string[] {
    let text: string;
    if (typeof chunk === "string") {
      this.#bytes += utf8ByteLength(chunk);
      text = chunk;
    } else {
      this.#bytes += chunk.length;
      text = this.#decoder.decode(chunk, { stream: true });
    }
    if (text.length === 0) return NO_LINES;
    if (!text.includes("\n")) {
      this.#hold(text);
      return NO_LINES;
    }
    // Only this chunk is split, never the held line again: the held line was
    // already searched when it was received, so it is not rescanned here.
    const parts = text.split("\n");
    const last = parts.length - 1;
    const lines: string[] = [];
    for (let index = 0; index < last; index += 1) {
      this.#hold(parts[index] ?? "");
      lines.push(this.#pending);
      this.#pending = "";
    }
    this.#hold(parts[last] ?? "");
    return lines;
  }

  /** End of stream: releases the unterminated tail, and any dangling partial code point. */
  flush(): readonly string[] {
    this.#hold(this.#decoder.decode());
    const tail = this.#pending;
    this.#pending = "";
    return tail.length === 0 ? NO_LINES : [tail];
  }

  /** Appends a segment of the held line, cut at the ceiling. Everything past it is dropped. */
  #hold(segment: string): void {
    const room = MAX_LINE_LENGTH - this.#pending.length;
    this.#pending += segment.length <= room ? segment : segment.slice(0, Math.max(room, 0));
  }
}

/** Whole-string entry point, for callers that already hold the complete stream. */
export function frameLines(stdout: string): readonly string[] {
  const framer = new LineFramer();
  return [...framer.push(stdout), ...framer.flush()];
}
