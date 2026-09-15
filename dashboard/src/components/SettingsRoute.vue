<script setup lang="ts">
import type { AdapterHealth, HealthResponse } from "../../shared/types.ts";
import { SIGNAL_LABEL, SIGNALS } from "../notify-sound.ts";

defineProps<{
  settings: unknown;
  adapters: AdapterHealth[];
  health: HealthResponse | null;
  soundEnabled: boolean;
}>();
const emit = defineEmits<{ "update:soundEnabled": [enabled: boolean] }>();

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
</script>

<template>
  <main class="settings-route">
    <a class="back-link" href="#/sessions">← All sessions</a>

    <!-- A browser preference, not a recorded setting: audio is per device, and
         this one lives in this browser the way the canvas layout does. Browsers
         refuse to make any sound before an interaction, so the switch IS that
         interaction — and turning it on plays the signal back, which is also
         the only honest way to hear it before relying on it. -->
    <section class="settings-sound">
      <p class="eyebrow">This browser</p>
      <h2>Sound</h2>
      <p class="settings-sound-note">
        Two sounds and no more, so that silence means nothing is wrong. They fire on a change
        the dashboard actually saw while it was open — runs already waiting when you arrive
        stay quiet, and are shown on the board instead.
      </p>
      <button
        type="button"
        class="session-filter-option settings-sound-toggle"
        :class="{ selected: soundEnabled }"
        :aria-pressed="soundEnabled"
        @click="emit('update:soundEnabled', !soundEnabled)"
      >{{ soundEnabled ? "sound is on" : "sound is off" }}</button>
      <ul class="settings-sound-signals">
        <li v-for="signal in SIGNALS" :key="signal">
          <code>{{ signal }}</code><span>{{ SIGNAL_LABEL[signal] }}</span>
        </li>
      </ul>
    </section>

    <section>
      <p class="eyebrow">Read-only configuration</p>
      <h1>Settings</h1>
      <h2>Effective config</h2>
      <pre>{{ json(settings) }}</pre>
    </section>
    <section>
      <h2>Adapter health</h2>
      <ul class="adapter-list">
        <li v-for="adapter in adapters" :key="adapter.id">
          <strong>{{ adapter.id }}</strong>
          <span>{{ adapter.kind }} · {{ adapter.provider ?? "no provider" }}</span>
          <b :class="adapter.status">{{ adapter.status }}</b>
          <small v-if="adapter.code">{{ adapter.code }}</small>
        </li>
      </ul>
    </section>
    <section>
      <h2>Database health</h2>
      <dl>
        <dt>Journal mode</dt><dd>{{ health?.journalMode ?? "unavailable" }}</dd>
        <dt>Schema version</dt><dd>{{ health?.schemaVersion ?? "unavailable" }}</dd>
        <dt>Projector lag</dt><dd>{{ health?.projectorLag ?? "unavailable" }}</dd>
        <dt>Degraded sessions</dt><dd>{{ health?.degradedSessions ?? "unavailable" }}</dd>
      </dl>
    </section>
  </main>
</template>
