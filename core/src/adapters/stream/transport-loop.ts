// What every adapter's `parse` owes the transport, in one place.
//
// Three obligations, and each of them was a defect in both adapters before it
// was a function here. They are shared rather than duplicated for the reason
// T12 gave when it pulled `usage.ts` out of the sequencer: this is not about
// any provider's vocabulary, it is about the pipes underneath all of them, and
// two copies of a pipe rule is two places for it to be subtly wrong.
//
//   1. STDERR MUST BE DRAINED. A pipe nobody reads fills — 64 KiB on Linux is
//      the usual figure — and a child that blocks writing to a full stderr
//      never reaches the part where it writes its result. Neither adapter read
//      it, and `transport-broker.ts` deliberately removes its own handshake
//      listener at settlement (`#handshake`, with a comment saying why), so
//      after launch nobody was reading it at all. The failure mode is a hang,
//      not a lost message, which is why this is a shared helper and not a
//      to-do.
//
//   2. WHAT THE PROVIDER SAID THERE IS EVIDENCE. A CLI that dies before
//      emitting a single JSON line usually explains itself on stderr, and a run
//      that reports `E_TERMINAL_MISSING` and nothing else has thrown that
//      explanation away.
//
//   3. THE EXIT CODE IS MEASURED, NOT ASSUMED. A decoder sees a success result
//      and mints a terminal; the process's actual exit code arrives later, on
//      `transport.exit`, and can disagree.
//
// The capture is BOUNDED. Draining a pipe into an unbounded string is a second
// way to lose the run, on memory rather than on a blocked write.

import type { ProcessExit, ProcessTransport } from "../interface.ts";

const STDERR_CAPTURE_LIMIT = 8 * 1024;

/**
 * How long a run waits for the process to exit once its stdout has closed.
 *
 * Not unbounded, deliberately. Stdout closing normally means the child is
 * already on its way out, but "normally" is the word doing the work: a child
 * that closed stdout and then hung would otherwise hang `parse` with it, and a
 * parser that never returns is worse than a terminal with no exit code. When
 * the wait expires the code is `null` — not reported — which is exactly what it
 * is.
 */
export const DEFAULT_EXIT_WAIT_MS = 5_000;

export interface StderrDrain {
  /** The captured tail, bounded and trimmed. Empty when the provider said nothing. */
  text: () => string;
  /** Resolves when stderr closes; awaited so a settled run has the whole tail. */
  done: Promise<void>;
}

/**
 * Starts reading stderr immediately and never stops until it closes.
 *
 * Errors on the stream are swallowed on purpose: stderr failing is not the run
 * failing, and a rejected promise here would replace a provider's real terminal
 * with a plumbing one.
 */
export function drainStderr(transport: ProcessTransport): StderrDrain {
  let captured = "";
  let truncated = false;
  // Streaming, like `LineFramer`'s: a multi-byte character split across two
  // chunks is not a replacement character here either.
  const decoder = new TextDecoder("utf-8");
  const done = (async (): Promise<void> => {
    try {
      for await (const chunk of transport.stderr) {
        // The chunk is still consumed when the cap is reached — draining is the
        // obligation; capturing is the bonus.
        const text = decoder.decode(chunk, { stream: true });
        if (captured.length >= STDERR_CAPTURE_LIMIT) {
          truncated = true;
          continue;
        }
        captured += text;
      }
    } catch {
      // Draining is the point; capturing is the bonus.
    }
  })();
  return {
    text: (): string => {
      const text = captured.slice(0, STDERR_CAPTURE_LIMIT).trim();
      return truncated || captured.length > STDERR_CAPTURE_LIMIT ? `${text}…` : text;
    },
    done,
  };
}

/** `; the provider said: …` — or nothing at all, when it said nothing. */
export function stderrSuffix(drain: StderrDrain): string {
  const text = drain.text();
  return text.length === 0 ? "" : `; the provider wrote to stderr: ${text}`;
}

/**
 * The process's exit, if it arrives before the wait expires.
 *
 * `null` means unmeasured, and callers must pass it through as `null` rather
 * than substituting a zero — a run whose exit nobody saw did not exit cleanly,
 * it exited unobserved.
 */
export async function awaitExit(
  transport: ProcessTransport,
  waitMs: number = DEFAULT_EXIT_WAIT_MS,
): Promise<ProcessExit | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    // Deliberately NOT unref'd. A child that closes stdout and then hangs
    // leaves this timer as the only thing pending, and an unref'd timer is
    // exactly the one the loop declines to wait for — so it would drain, the
    // race would never settle, and `parse` would never return. It is cleared on
    // the way out either way, so it holds the loop open for at most `waitMs`.
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([transport.exit.catch(() => null), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
