<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { AdaptersResponse, HealthResponse, SessionDetailResponse, SessionsResponse, SettingsResponse, TicketsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import SessionRoute from "./components/SessionRoute.vue";
import SettingsRoute from "./components/SettingsRoute.vue";
import BacklogRoute from "./routes/backlog.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";

const health = ref<HealthResponse | null>(null);
const sessions = ref<SessionsResponse>({ sessions: [] });
const detail = ref<SessionDetailResponse | null>(null);
const selectedId = ref<string | null>(null);
const selectedPhaseId = ref<string | null>(null);
const settings = ref<unknown>({});
const adapters = ref<AdaptersResponse>({ adapters: [] });
const settingsRoute = ref(false);
const backlogRoute = ref(false);
const backlog = ref<TicketsResponse>({ plans: [], tickets: [], ready: [], counts: { state: { todo: 0, wip: 0, done: 0, failed: 0 }, milestone: {}, tier: { T0: 0, T1: 0, T2: 0 } }, projectedCost: { usd: null, authority: "unavailable", partial: true } });

function readRoute(): void {
  settingsRoute.value = location.hash === "#/settings";
  backlogRoute.value = location.hash === "#/backlog";
  const phase = location.hash.match(/^#\/sessions\/([^/]+)\/phases\/([^/]+)$/);
  const session = location.hash.match(/^#\/sessions\/([^/]+)$/);
  selectedId.value = decodeURIComponent(phase?.[1] ?? session?.[1] ?? "") || null;
  selectedPhaseId.value = phase?.[2] ? decodeURIComponent(phase[2]) : null;
}
function onHashChange(): void { readRoute(); void load(); }
onMounted(() => { readRoute(); addEventListener("hashchange", onHashChange); });
onUnmounted(() => removeEventListener("hashchange", onHashChange));

const phaseName = computed(() => detail.value?.phases.find((phase) => phase.phaseId === selectedPhaseId.value || phase.key === selectedPhaseId.value)?.name ?? null);
const mode = computed<PollMode>(() => health.value?.activeSessions ? "live" : sessions.value.sessions.length ? "grid" : "idle");

async function load(): Promise<void> {
  const dataRequest = settingsRoute.value
    ? Promise.all([fetch("/api/v1/settings"), fetch("/api/v1/adapters")])
    : backlogRoute.value ? fetch("/api/v1/tickets")
    : selectedId.value
      ? fetch(`/api/v1/sessions/${encodeURIComponent(selectedId.value)}`)
      : fetch("/api/v1/sessions");
  const [nextHealth, nextData] = await Promise.all([fetch("/api/v1/health"), dataRequest]);
  if (!nextHealth.ok) throw new Error("Dashboard data unavailable");
  health.value = await nextHealth.json() as HealthResponse;
  if (settingsRoute.value) {
    const [settingsResponse, adaptersResponse] = nextData as [Response, Response];
    if (!settingsResponse.ok || !adaptersResponse.ok) throw new Error("Settings unavailable");
    settings.value = (await settingsResponse.json() as SettingsResponse).settings;
    adapters.value = await adaptersResponse.json() as AdaptersResponse;
    detail.value = null;
  } else if (backlogRoute.value) {
    const response = nextData as Response;
    if (!response.ok) throw new Error("Backlog unavailable");
    backlog.value = await response.json() as TicketsResponse;
    detail.value = null;
  } else {
    const response = nextData as Response;
    if (!response.ok) throw new Error("Dashboard data unavailable");
    if (selectedId.value) detail.value = await response.json() as SessionDetailResponse;
    else {
      sessions.value = await response.json() as SessionsResponse;
      detail.value = null;
    }
  }
}
const { lastPollAt, pollMs } = usePolling(load, () => mode.value);
</script>

<template>
  <AppShell
    :health="health"
    :last-poll-at="lastPollAt"
    :poll-ms="pollMs()"
    :session-id="selectedId"
    :phase-name="phaseName"
    :settings="settingsRoute"
    :backlog="backlogRoute"
  >
    <SettingsRoute v-if="settingsRoute" :settings="settings" :adapters="adapters.adapters" :health="health" />
    <BacklogRoute v-else-if="backlogRoute" :backlog="backlog" />
    <SessionRoute v-else-if="detail" :session="detail" :selected-phase-id="selectedPhaseId" />
    <SessionsGrid v-else :sessions="sessions.sessions" />
  </AppShell>
</template>
