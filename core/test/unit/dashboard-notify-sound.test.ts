import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SessionCard } from "../../../dashboard/shared/types.ts";
import {
  announcements,
  chooseSignal,
  readSoundEnabled,
  rememberStates,
  SIGNALS,
  playSignal,
  SOUND_STORE,
  writeSoundEnabled,
  type PreferenceStore,
  type ToneDevice,
} from "../../../dashboard/src/notify-sound.ts";

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function code(path: string): string {
  return source(path).replace(/<!--[\s\S]*?-->/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

function run(sessionId: string, state: string): SessionCard {
  return { sessionId, state, taskId: `task-${sessionId}` } as unknown as SessionCard;
}

function memoryStore(): PreferenceStore & { readonly seen: Map<string, string> } {
  const seen = new Map<string, string>();
  return { seen, getItem: (key) => seen.get(key) ?? null, setItem: (key, value) => { seen.set(key, value); } };
}

test("the first poll establishes the baseline and says nothing", () => {
  // Three runs on the owner's projection have been waiting ten to seventeen
  // days. If arriving announced them, every reload would chime for a backlog
  // the reader already knows about — and a sound you hear on every reload is a
  // sound you stop hearing, which costs the one signal that matters.
  const board = [run("a", "AWAITING_OWNER"), run("b", "BLOCKED"), run("c", "RUNNING")];
  assert.deepEqual(announcements(null, board), []);
  // And it stays quiet on the next poll too, because nothing changed.
  assert.deepEqual(announcements(rememberStates(board), board), []);
});

test("a transition into waiting or stopping is what makes a sound", () => {
  const before = rememberStates([run("a", "RUNNING"), run("b", "REVIEWING"), run("c", "RUNNING")]);
  const found = announcements(before, [run("a", "AWAITING_OWNER"), run("b", "BLOCKED"), run("c", "LANDED")]);
  assert.deepEqual(found.map((held) => held.signal), ["needs-you", "died"]);
  assert.deepEqual(found.map((held) => held.sessionId), ["a", "b"]);
  // Landing is not announced. It is good news, it needs nothing from the
  // reader, and a sound for it would spend the silence that makes the other
  // two mean something.
  assert.equal(found.some((held) => held.sessionId === "c"), false);
});

test("a run seen for the first time mid-session is not a transition", () => {
  // Otherwise the whole board announces itself the moment a second tab opens,
  // or whenever the list arrives after a route change.
  const before = rememberStates([run("a", "RUNNING")]);
  assert.deepEqual(announcements(before, [run("a", "RUNNING"), run("new", "BLOCKED")]), []);
});

test("three changes at once are one sound, and the one that asks for something wins", () => {
  const before = rememberStates([run("a", "RUNNING"), run("b", "RUNNING"), run("c", "RUNNING")]);
  const found = announcements(before, [run("a", "BLOCKED"), run("b", "AWAITING_OWNER"), run("c", "BLOCKED")]);
  assert.equal(found.length, 3);
  // Three chimes on top of each other is a noise, not three notifications.
  assert.equal(chooseSignal(found), "needs-you");
  assert.equal(chooseSignal(found.filter((held) => held.signal === "died")), "died");
  assert.equal(chooseSignal([]), null);
  assert.deepEqual([...SIGNALS], ["needs-you", "died"]);
});

test("sound is off until the reader turns it on, and the preference stays in this browser", () => {
  const store = memoryStore();
  assert.equal(readSoundEnabled(store), false, "nothing starts making noise on its own");
  writeSoundEnabled(store, true);
  assert.equal(store.seen.get(SOUND_STORE), "on");
  assert.equal(readSoundEnabled(store), true);
  writeSoundEnabled(store, false);
  assert.equal(readSoundEnabled(store), false);
  // A private window or blocked site data costs the preference, not the page.
  assert.equal(readSoundEnabled(null), false);
  assert.doesNotThrow(() => writeSoundEnabled(null, true));
  assert.equal(readSoundEnabled({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }), false);
  assert.doesNotThrow(() => writeSoundEnabled({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, true));
});

test("each signal is a different shape, and a suspended device is not an error", async () => {
  // What the ToneDevice interface bought: the synthesis runs with no browser.
  const started: { hertz: number; at: number }[] = [];
  function device(state: string): ToneDevice & { resumed: boolean } {
    const held = {
      state, resumed: false, currentTime: 10, destination: {},
      resume: async () => { held.resumed = true; held.state = state === "suspended" ? "running" : state; },
      createGain: () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => held.createGain() }),
      createOscillator: () => {
        const osc = {
          type: "", frequency: { setValueAtTime: (hertz: number, at: number) => { started.push({ hertz, at }); }, exponentialRampToValueAtTime: () => {} },
          start: () => {}, stop: () => {}, connect: () => osc,
        };
        return osc;
      },
    };
    return held as unknown as ToneDevice & { resumed: boolean };
  }

  started.length = 0;
  assert.equal(await playSignal(device("running"), "needs-you"), true);
  // Two strikes, each a fundamental and a partial two octaves up: four tones.
  assert.equal(started.length, 4);
  assert.deepEqual(started.map((held) => held.hertz), [523.25, 523.25 * 4, 783.99, 783.99 * 4]);
  // Rising, and the second lands after the first: one or two strikes with a
  // very slight pause, which is the owner's own description of the sound.
  assert.ok(started[2]!.at > started[0]!.at);

  started.length = 0;
  assert.equal(await playSignal(device("running"), "died"), true);
  assert.equal(started.length, 2, "one strike reports; two ask");
  assert.ok(started[0]!.hertz < 523.25, "and it is lower than the one that asks");

  // Suspended is the normal state before the reader has clicked anything.
  const asleep = device("suspended");
  assert.equal(await playSignal(asleep, "died"), true);
  assert.equal(asleep.resumed, true);
  // A device that will not run, or that throws, costs the sound and nothing else.
  assert.equal(await playSignal(device("closed"), "died"), false);
  assert.equal(await playSignal({ ...device("running"), createGain: () => { throw new Error("gone"); } } as unknown as ToneDevice, "died"), false);
});

test("two signals, synthesised, and the switch is the gesture the browser demands", () => {
  const sound = source("dashboard/src/notify-sound.ts");
  const settings = source("dashboard/src/components/SettingsRoute.vue");
  // Synthesised, so it ships without assets: a struck bar is a fundamental and
  // a partial two octaves up, decaying fast. Samples can replace `strike`
  // without touching anything above it.
  // Typechecked twice — once with the DOM, once by the core project, which is
  // lib ES2023 with node types and has no AudioContext at all. So the four
  // calls it uses are declared here rather than imported, which also lets
  // `playSignal` be driven by a fake device with no browser in sight.
  assert.match(sound, /function strike\(context: ToneDevice/u);
  assert.match(sound, /export interface ToneDevice \{/u);
  assert.doesNotMatch(code("dashboard/src/notify-sound.ts"), /AudioContext/u);
  assert.match(sound, /\[\[1, 1\], \[4, 0\.32\]\] as const/u);
  assert.doesNotMatch(code("dashboard/src/notify-sound.ts"), /\.mp3|\.wav|new Audio\(/u);
  // Held at two. A third has to earn its place by demanding a different
  // response from these two.
  assert.equal(SIGNALS.length, 2);
  // Browsers refuse to make sound before an interaction, so the control is it.
  assert.match(settings, /@click="emit\('update:soundEnabled', !soundEnabled\)"/u);
  assert.match(source("dashboard/src/composables/useNotifySound.ts"), /await playSignal\(device, "needs-you"\);/u);
  // Driven by the list, so it can only announce what a poll actually returned.
  assert.match(source("dashboard/src/App.vue"), /useNotifySound\(computed\(\(\) => sessions\.value\.sessions\)\)/u);
});
