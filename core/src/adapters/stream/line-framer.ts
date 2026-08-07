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
 * **Framing bounds nothing.** The framer keeps reading lines past the output
 * budget so a run that overruns it can still observe its own terminal event
 * instead of being misreported as a truncated, terminal-less stream. The budget
 * lives one stage downstream, in `output-budget.ts`, and it bounds what is
 * *emitted*, never what is *read*.
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
    this.#pending += text;
    if (!this.#pending.includes("\n")) return NO_LINES;
    const parts = this.#pending.split("\n");
    this.#pending = parts.pop() ?? "";
    return parts;
  }

  /** End of stream: releases the unterminated tail, and any dangling partial code point. */
  flush(): readonly string[] {
    this.#pending += this.#decoder.decode();
    const tail = this.#pending;
    this.#pending = "";
    return tail.length === 0 ? NO_LINES : [tail];
  }
}

/** Whole-string entry point, for callers that already hold the complete stream. */
export function frameLines(stdout: string): readonly string[] {
  const framer = new LineFramer();
  return [...framer.push(stdout), ...framer.flush()];
}
