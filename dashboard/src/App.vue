<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { AdaptersResponse, HealthResponse, SessionDetailResponse, SessionsResponse, SettingsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import SessionRoute from "./components/SessionRoute.vue";
import SettingsRoute from "./components/SettingsRoute.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";
const health = ref<HealthResponse | null>(null); const sessions = ref<SessionsResponse>({ sessions: [] });
const detail = ref<SessionDetailResponse | null>(null); const selectedId = ref<string | null>(null);
const settings = ref<unknown>({}); const adapters = ref<AdaptersResponse>({ adapters: [] }); const settingsRoute = ref(false);
function readRoute() { settingsRoute.value = location.hash === "#/settings"; const match = location.hash.match(/^#\/sessions\/([^/]+)$/); selectedId.value = match?.[1] ?? null; }
function onHashChange() { readRoute(); void load(); }
onMounted(() => { readRoute(); addEventListener("hashchange", onHashChange); }); onUnmounted(() => removeEventListener("hashchange", onHashChange));
const mode = computed<PollMode>(() => health.value?.activeSessions ? "live" : sessions.value.sessions.length ? "grid" : "idle");
async function load() {
  const dataRequest = settingsRoute.value ? Promise.all([fetch("/api/v1/settings"), fetch("/api/v1/adapters")]) : selectedId.value ? fetch(`/api/v1/sessions/${encodeURIComponent(selectedId.value)}`) : fetch("/api/v1/sessions");
  const [nextHealth, nextData] = await Promise.all([fetch("/api/v1/health"), dataRequest]);
  if (!nextHealth.ok) throw new Error("Dashboard data unavailable"); health.value = await nextHealth.json() as HealthResponse;
  if (settingsRoute.value) { const [settingsResponse, adaptersResponse] = nextData as [Response, Response]; if (!settingsResponse.ok || !adaptersResponse.ok) throw new Error("Settings unavailable"); settings.value = (await settingsResponse.json() as SettingsResponse).settings; adapters.value = await adaptersResponse.json() as AdaptersResponse; detail.value = null; }
  else { const response = nextData as Response; if (!response.ok) throw new Error("Dashboard data unavailable"); if (selectedId.value) detail.value = await response.json() as SessionDetailResponse; else { sessions.value = await response.json() as SessionsResponse; detail.value = null; } }
}
const { lastPollAt, pollMs } = usePolling(load, () => mode.value);
</script>
<template><AppShell :health="health" :last-poll-at="lastPollAt" :poll-ms="pollMs()"><SettingsRoute v-if="settingsRoute" :settings="settings" :adapters="adapters.adapters" :health="health" /><SessionRoute v-else-if="detail" :session="detail" /><SessionsGrid v-else :sessions="sessions.sessions" /></AppShell></template>
