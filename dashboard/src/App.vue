<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { HealthResponse, SessionDetailResponse, SessionsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import SessionRoute from "./components/SessionRoute.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";
const health = ref<HealthResponse | null>(null);
const sessions = ref<SessionsResponse>({ sessions: [] });
const detail = ref<SessionDetailResponse | null>(null);
const selectedId = ref<string | null>(null);
function readRoute() { const match = location.hash.match(/^#\/sessions\/([^/]+)$/); selectedId.value = match?.[1] ?? null; }
function onHashChange() { readRoute(); void load(); }
onMounted(() => { readRoute(); addEventListener("hashchange", onHashChange); });
onUnmounted(() => removeEventListener("hashchange", onHashChange));
const mode = computed<PollMode>(() => health.value?.activeSessions ? "live" : sessions.value.sessions.length ? "grid" : "idle");
async function load() {
  const dataRequest = selectedId.value ? fetch(`/api/v1/sessions/${encodeURIComponent(selectedId.value)}`) : fetch("/api/v1/sessions");
  const [nextHealth, nextData] = await Promise.all([fetch("/api/v1/health"), dataRequest]);
  if (!nextHealth.ok || !nextData.ok) throw new Error("Dashboard data unavailable");
  health.value = await nextHealth.json() as HealthResponse;
  if (selectedId.value) detail.value = await nextData.json() as SessionDetailResponse;
  else { sessions.value = await nextData.json() as SessionsResponse; detail.value = null; }
}
const { lastPollAt, pollMs } = usePolling(load, () => mode.value);
</script>
<template><AppShell :health="health" :last-poll-at="lastPollAt" :poll-ms="pollMs()"><SessionRoute v-if="detail" :session="detail" /><SessionsGrid v-else :sessions="sessions.sessions" /></AppShell></template>
