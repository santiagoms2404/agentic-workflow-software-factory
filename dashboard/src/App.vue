<script setup lang="ts">
import { computed, ref } from "vue";
import type { HealthResponse, SessionsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";
const health = ref<HealthResponse | null>(null);
const sessions = ref<SessionsResponse>({ sessions: [] });
const mode = computed<PollMode>(() => health.value?.activeSessions ? "live" : sessions.value.sessions.length ? "grid" : "idle");
async function load() {
  const [nextHealth, nextSessions] = await Promise.all([fetch("/api/v1/health"), fetch("/api/v1/sessions")]);
  if (!nextHealth.ok || !nextSessions.ok) throw new Error("Dashboard data unavailable");
  health.value = await nextHealth.json() as HealthResponse;
  sessions.value = await nextSessions.json() as SessionsResponse;
}
const { lastPollAt, pollMs } = usePolling(load, () => mode.value);
</script>
<template><AppShell :health="health" :last-poll-at="lastPollAt" :poll-ms="pollMs()"><SessionsGrid :sessions="sessions.sessions" /></AppShell></template>
