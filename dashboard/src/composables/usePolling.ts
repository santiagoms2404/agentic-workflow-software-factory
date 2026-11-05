import { onBeforeUnmount, onMounted, ref, watch } from "vue";

export type PollMode = "live" | "grid" | "idle";
const cadence: Record<PollMode, number> = { live: 500, grid: 2_000, idle: 5_000 };
/**
 * The longest a poll may stay in flight before it counts as a failed attempt.
 * It equals the longest retry backoff, so no slow-but-answering poll is cut off
 * by it. Without a bound, a request the server never answers holds the
 * in-flight guard forever and every later poll becomes a no-op.
 */
const POLL_DEADLINE_MS = 30_000;

/** Rejects once the deadline passes. The work is not cancelled, and once abandoned its late settlement is not recorded here. */
function withDeadline(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("poll deadline exceeded")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * The window's focus events, typed structurally. The core build compiles this
 * module under test without the DOM library, where a bare `window` does not
 * type; the browser supplies the object, and the hooks below only run inside a
 * mounted component.
 */
interface FocusTarget {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}
function focusTarget(): FocusTarget {
  return (globalThis as unknown as { window: FocusTarget }).window;
}

/** Owns polling cadence, bounded exponential retry, and focus catch-up. */
export function usePolling(poll: () => Promise<void>, mode: () => PollMode, shouldRepeat: () => boolean = () => true) {
  const lastPollAt = ref<number | null>(null);
  const polling = ref(false);
  const failedAttempts = ref(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const pollMs = () => cadence[mode()];
  const schedule = () => {
    if (stopped || !shouldRepeat()) return;
    const backoff = Math.min(pollMs() * 2 ** failedAttempts.value, 30_000);
    timer = setTimeout(voidPoll, backoff);
  };
  const voidPoll = async () => {
    if (polling.value || stopped) return;
    polling.value = true;
    try {
      await withDeadline(poll(), POLL_DEADLINE_MS);
      lastPollAt.value = Date.now();
      failedAttempts.value = 0;
    } catch {
      failedAttempts.value += 1;
    } finally {
      polling.value = false;
      schedule();
    }
  };
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    return voidPoll();
  };
  const onFocus = () => {
    if (!shouldRepeat()) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    void voidPoll();
  };

  watch(shouldRepeat, (repeat) => {
    if (!repeat) {
      if (timer) clearTimeout(timer);
      timer = undefined;
    } else {
      void voidPoll();
    }
  });
  onMounted(() => {
    focusTarget().addEventListener("focus", onFocus);
    void voidPoll();
  });
  onBeforeUnmount(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
    focusTarget().removeEventListener("focus", onFocus);
  });
  return { lastPollAt, polling, failedAttempts, pollMs, refresh };
}
