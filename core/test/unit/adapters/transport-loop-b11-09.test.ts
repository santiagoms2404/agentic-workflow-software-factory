// B11-09: drainStderr consumption is bounded by awaitStderr against descendants holding pipe open
//
// drainStderr's raw `done` promise resolves only on EOF of the stderr stream,
// which is kept open if a descendant process outlives the provider and inherits
// the pipe. To prevent parse() from hanging indefinitely after provider exit,
// consumption of drainStderr is bounded via `awaitStderr(drain, waitMs)`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drainStderr,
  awaitStderr,
  cancellationReason,
  DEFAULT_EXIT_WAIT_MS,
  describeError,
  describeExit,
  isCancellation,
} from "../../../src/adapters/stream/transport-loop.ts";
import type { ProcessExit, ProcessTransport } from "../../../src/adapters/interface.ts";

function createMockTransport(options: {
  stderrChunks?: Uint8Array[];
  closeStderr?: boolean;
}): { transport: ProcessTransport; unblockStderr?: (() => void) | undefined } {
  let unblock: (() => void) | undefined;
  const unblockPromise = new Promise<void>((resolve) => {
    unblock = resolve;
  });

  const chunks = options.stderrChunks ?? [];
  const closeStderr = options.closeStderr ?? true;

  const stderrIterable: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
      if (!closeStderr) {
        // Simulates a descendant holding the pipe open indefinitely
        await unblockPromise;
      }
    },
  };

  const exitPromise: Promise<ProcessExit> = Promise.resolve({ code: 0, signal: null });

  const stdoutIterable: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      // empty stdout
    },
  };

  return {
    transport: {
      runId: "run-b11-09",
      identity: { pid: 1, pgid: 1 },
      stdout: stdoutIterable,
      stderr: stderrIterable,
      exit: exitPromise,
      cancel: async () => ({
        skipped: false,
        termSent: true,
        killSent: false,
        survivors: [],
        terminated: [],
      }),
    } as unknown as ProcessTransport,
    unblockStderr: unblock,
  };
}

test("B11-09: awaitStderr resolves promptly when stderr stream closes normally", async () => {
  const { transport } = createMockTransport({
    stderrChunks: [new TextEncoder().encode("normal provider diagnostic")],
    closeStderr: true,
  });

  const drain = drainStderr(transport);
  const start = Date.now();
  await awaitStderr(drain, 500);
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 400, `must resolve before waitMs expiry, took ${elapsed}ms`);
  assert.equal(drain.text(), "normal provider diagnostic");
});

test("B11-09: awaitStderr bounds consumption when a descendant holds stderr open indefinitely", async () => {
  const { transport, unblockStderr } = createMockTransport({
    stderrChunks: [new TextEncoder().encode("early diagnostic before fork\n")],
    closeStderr: false, // descendant holds stderr open
  });

  try {
    const drain = drainStderr(transport);
    const boundMs = 100;
    const start = Date.now();
    await awaitStderr(drain, boundMs);
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 80, `must wait at least boundMs (${boundMs}ms), took ${elapsed}ms`);
    assert.ok(elapsed < 1000, `must not hang indefinitely, took ${elapsed}ms`);
    assert.equal(drain.text(), "early diagnostic before fork");
  } finally {
    unblockStderr?.();
  }
});

test("B11-09: DEFAULT_EXIT_WAIT_MS is exported and set to 5000ms", () => {
  assert.equal(DEFAULT_EXIT_WAIT_MS, 5_000);
});

test("shared stream helpers retain cancellation and exit classifications", () => {
  const abortError = new Error("stop");
  abortError.name = "AbortError";
  assert.equal(isCancellation(abortError), true);
  assert.equal(isCancellation(Object.assign(new Error("closed"), { code: "ERR_STREAM_PREMATURE_CLOSE" })), true);
  assert.equal(isCancellation(new Error("other")), false);
  const controller = new AbortController();
  controller.abort(new Error("owner stop"));
  assert.equal(cancellationReason(controller.signal, new Error("ignored")), "the provider's output stream was cancelled: owner stop");
  assert.equal(describeError("non-error"), "non-error");
  assert.equal(describeExit({ code: 4, signal: null }, 25), "the process exited with code 4");
  assert.equal(describeExit(null, 25), "neither an exit code nor a signal was observed within 25 ms");
});
