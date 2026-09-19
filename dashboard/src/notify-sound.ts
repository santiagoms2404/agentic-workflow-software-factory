import type { LifecycleState, SessionCard } from "../shared/types.ts";

/**
 * Two sounds, so that silence means nothing is wrong.
 *
 * Three runs on the owner's projection have been sitting in AWAITING_OWNER for
 * ten to seventeen days, waiting on a person who had no way to know. That is
 * the whole problem: the factory stops for you and says nothing, and you find
 * out by remembering to look.
 *
 * Deliberately two and not seven. The value of a notification is its rarity —
 * if every event gets a sound, none of them carry information and the reader
 * mutes the lot. A third sound has to earn its place by naming something that
 * demands a different response from these two.
 *
 * The decision of WHAT to announce is a pure function of two polls, so it can
 * be tested without a browser; only the playing needs an audio device.
 */

export const SIGNALS = ["needs-you", "died"] as const;
export type Signal = (typeof SIGNALS)[number];

export const SIGNAL_LABEL: Readonly<Record<Signal, string>> = {
  "needs-you": "a run is waiting on you",
  died: "a run stopped",
};

/** The run states each signal fires on. */
const WAITING: LifecycleState = "AWAITING_OWNER";
const STOPPED: LifecycleState = "BLOCKED";

export interface Announcement {
  readonly signal: Signal;
  readonly sessionId: string;
  readonly taskId: string;
}

/** What the last poll saw, so the next one can tell a change from a repeat. */
export type StateMemory = ReadonlyMap<string, LifecycleState>;

export function rememberStates(sessions: readonly SessionCard[]): StateMemory {
  return new Map(sessions.map((session) => [session.sessionId, session.state]));
}

/**
 * What changed since the last poll, and is worth a sound.
 *
 * A TRANSITION, never a state. A run that is already waiting when the page
 * loads does not announce itself: the first poll only establishes the
 * baseline, because otherwise every reload would chime for a backlog the
 * reader already knows about, and a sound you hear on every reload is a sound
 * you stop hearing. The backlog is shown, not played.
 *
 * `previous` being null IS that first poll.
 */
export function announcements(previous: StateMemory | null, next: readonly SessionCard[]): readonly Announcement[] {
  if (previous === null) return [];
  const found: Announcement[] = [];
  for (const session of next) {
    const before = previous.get(session.sessionId);
    // A run this poll has never seen before is not a transition either. A run
    // created and blocked between two polls is the one case this misses, and
    // announcing every newly-seen run instead would fire for the whole board
    // the first time a second tab opens.
    if (before === undefined || before === session.state) continue;
    if (session.state === WAITING) found.push({ signal: "needs-you", sessionId: session.sessionId, taskId: session.taskId });
    else if (session.state === STOPPED) found.push({ signal: "died", sessionId: session.sessionId, taskId: session.taskId });
  }
  return found;
}

/**
 * One sound per poll, even when three runs change at once.
 *
 * Three chimes on top of each other is a noise, not three notifications, and
 * the reader is going to look at the board either way. "Needs you" wins,
 * because it is the one that asks for something.
 */
export function chooseSignal(found: readonly Announcement[]): Signal | null {
  if (found.some((held) => held.signal === "needs-you")) return "needs-you";
  return found.length > 0 ? "died" : null;
}

/* --- The sound itself ----------------------------------------------------- */

/**
 * A struck bar, synthesised rather than sampled.
 *
 * A marimba bar is tuned so its first overtone sits two octaves above the
 * fundamental, which is what makes it read as wood rather than as a sine beep,
 * and it decays fast with no sustain. Two oscillators and an exponential
 * envelope get close enough to tell one signal from the other across a room,
 * which is all this has to do. Real samples would sound better and can replace
 * `strike` without touching anything above it — but if the timing or the
 * meaning are wrong, a better sample does not save them.
 */
/**
 * The slice of Web Audio this needs, declared rather than imported.
 *
 * These modules are typechecked twice: once by vue-tsc with the DOM, and once
 * by the core project, which is `lib: ["ES2023"]` with node types and has no
 * `AudioContext` at all. (`localStorage` survives that only because node
 * declares one of its own.) Naming the four calls used here keeps the module
 * honest in both, and it means `playSignal` can be driven by a fake device in
 * a test with no browser anywhere near it. A real `AudioContext` satisfies it.
 */
interface ToneParam {
  setValueAtTime(value: number, at: number): void;
  exponentialRampToValueAtTime(value: number, at: number): void;
}
interface ToneNode { connect(target: unknown): ToneNode }
interface ToneGain extends ToneNode { readonly gain: ToneParam }
interface ToneOscillator extends ToneNode {
  type: string;
  readonly frequency: ToneParam;
  start(at: number): void;
  stop(at: number): void;
}
export interface ToneDevice {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  createGain(): ToneGain;
  createOscillator(): ToneOscillator;
}

function strike(context: ToneDevice, hertz: number, at: number, seconds: number, gain: number): void {
  const envelope = context.createGain();
  envelope.connect(context.destination);
  // Struck, not blown: full amplitude immediately, then away. `setValueAtTime`
  // at 0 would click, so it rises over four milliseconds instead.
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  for (const [multiple, level] of [[1, 1], [4, 0.32]] as const) {
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(hertz * multiple, at);
    const partial = context.createGain();
    partial.gain.setValueAtTime(level, at);
    tone.connect(partial).connect(envelope);
    tone.start(at);
    tone.stop(at + seconds + 0.02);
  }
}

/**
 * The two sequences, in the owner's own grammar: one or two strikes with a
 * very slight pause between them.
 *
 * Rising and doubled asks for something; one low note reports something. They
 * have to be told apart from another room, so they differ in count, direction
 * and register rather than in volume.
 */
const SEQUENCES: Readonly<Record<Signal, readonly { readonly hertz: number; readonly after: number; readonly seconds: number; readonly gain: number }[]>> = {
  "needs-you": [
    { hertz: 523.25, after: 0, seconds: 0.9, gain: 0.22 },
    { hertz: 783.99, after: 0.1, seconds: 1.2, gain: 0.22 },
  ],
  died: [
    { hertz: 174.61, after: 0, seconds: 1.6, gain: 0.18 },
  ],
};

/**
 * Play one signal. Returns false when there is no audio to play it on.
 *
 * Browsers refuse to make sound until the reader has interacted with the page,
 * so this can be called on a context that is still suspended and must not
 * throw when it is — the caller resumes it from a real click.
 */
export async function playSignal(context: ToneDevice, signal: Signal): Promise<boolean> {
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;
    const start = context.currentTime + 0.02;
    for (const note of SEQUENCES[signal]) strike(context, note.hertz, start + note.after, note.seconds, note.gain);
    return true;
  } catch {
    // A device that disappeared mid-session is not an error worth a dialog.
    return false;
  }
}

/* --- Whether the reader wants it ------------------------------------------ */

/**
 * The preference, in this browser and nowhere else.
 *
 * Audio is per-device — the same person wants sound on the desktop that has
 * the dashboard open in a background window and not on the laptop they are
 * presenting from — so this is a browser preference like the canvas layout,
 * never a recorded setting other people would inherit.
 */
export const SOUND_STORE = "awsf.notify-sound";

export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserPreferences(): PreferenceStore | null {
  try {
    return localStorage;
  } catch {
    // Private windows throw on the property itself, not only on the call.
    return null;
  }
}

/** Off unless the reader has turned it on: nothing should start making noise. */
export function readSoundEnabled(store: PreferenceStore | null, key: string = SOUND_STORE): boolean {
  if (store === null) return false;
  try {
    return store.getItem(key) === "on";
  } catch {
    return false;
  }
}

export function writeSoundEnabled(store: PreferenceStore | null, enabled: boolean, key: string = SOUND_STORE): void {
  if (store === null) return;
  try {
    store.setItem(key, enabled ? "on" : "off");
  } catch {
    // A blocked store costs the preference, not the session.
  }
}
