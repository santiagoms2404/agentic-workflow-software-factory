import { ref, watch, type Ref } from "vue";
import type { SessionCard } from "../../shared/types.ts";
import {
  announcements,
  browserPreferences,
  chooseSignal,
  playSignal,
  readSoundEnabled,
  rememberStates,
  writeSoundEnabled,
  type Announcement,
  type StateMemory,
} from "../notify-sound.ts";

/**
 * Sound the two signals when the board changes underneath the reader.
 *
 * Driven by the sessions list rather than by a timer: the list only updates
 * when a poll actually returned it, so there is no arrangement in which this
 * announces something it has not seen. It follows that the chime reaches the
 * reader while the board, the canvas or the groups screen is open — those are
 * the routes that fetch the list — and not while they are deep in one run's
 * detail. That is the honest limit of a browser tab as a notifier.
 */
export function useNotifySound(sessions: Ref<readonly SessionCard[]>) {
  const store = browserPreferences();
  const enabled = ref(readSoundEnabled(store));
  const last = ref<Announcement | null>(null);
  let memory: StateMemory | null = null;
  let context: AudioContext | null = null;

  function audio(): AudioContext | null {
    if (context !== null) return context;
    // Constructed on first use, not on load: an AudioContext created before
    // any interaction starts life suspended and some browsers log about it.
    const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;
    context = new Ctor();
    return context;
  }

  watch(sessions, (next) => {
    const found = announcements(memory, next);
    // The baseline is taken every poll, including the first, so a run that was
    // already waiting when the page loaded never chimes for having been there.
    memory = rememberStates(next);
    if (found.length === 0) return;
    last.value = found[0] ?? null;
    if (!enabled.value) return;
    const signal = chooseSignal(found);
    const device = signal === null ? null : audio();
    if (signal !== null && device !== null) void playSignal(device, signal);
  }, { immediate: true, deep: false });

  /**
   * Turning it on is the interaction browsers require before any sound, so the
   * control plays the signal back once — which doubles as the only honest way
   * to find out what it sounds like before relying on it.
   */
  async function setEnabled(value: boolean): Promise<void> {
    enabled.value = value;
    writeSoundEnabled(store, value);
    if (!value) return;
    const device = audio();
    if (device !== null) await playSignal(device, "needs-you");
  }

  return { enabled, setEnabled, last };
}
