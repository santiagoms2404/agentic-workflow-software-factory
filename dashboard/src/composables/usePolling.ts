import { onBeforeUnmount, onMounted, ref } from "vue";

export type PollMode = "live" | "grid" | "idle";
const cadence: Record<PollMode, number> = { live: 500, grid: 2_000, idle: 5_000 };

/** Owns polling cadence, bounded exponential retry, and focus catch-up. */
export function usePolling(poll: () => Promise<void>, mode: () => PollMode) {
  const lastPollAt = ref<number | null>(null);
  const polling = ref(false);
  const failedAttempts = ref(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const pollMs = () => cadence[mode()];
  const schedule = () => {
    if (stopped) return;
    const backoff = Math.min(pollMs() * 2 ** failedAttempts.value, 30_000);
    timer = setTimeout(voidPoll, backoff);
  };
  const voidPoll = async () => {
    if (polling.value || stopped) return;
    polling.value = true;
    try {
      await poll();
      lastPollAt.value = Date.now();
      failedAttempts.value = 0;
    } catch {
      failedAttempts.value += 1;
    } finally {
      polling.value = false;
      schedule();
    }
  };
  const onFocus = () => { void voidPoll(); };

  onMounted(() => {
    window.addEventListener("focus", onFocus);
    void voidPoll();
  });
  onBeforeUnmount(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
  });
  return { lastPollAt, polling, failedAttempts, pollMs, refresh: voidPoll };
}
