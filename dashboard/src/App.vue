<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AdaptersResponse, HealthResponse, SessionDetailResponse, SessionsResponse, SettingsResponse, TicketsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import SessionRoute from "./components/SessionRoute.vue";
import SettingsRoute from "./components/SettingsRoute.vue";
import BacklogRoute from "./routes/backlog.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";
import { LIFECYCLE_STATES } from "./session-filters.ts";
import { PLAN_KINDS } from "./session-plans.ts";

const health = ref<HealthResponse | null>(null);
const sessions = ref<SessionsResponse>({ sessions: [], plans: [] });
const configuredWorkflows = ref<readonly string[]>([]);
const selectedWorkflows = ref<readonly string[]>([]);
const selectedLifecycleStates = ref<readonly string[]>([]);
const selectedPlanKinds = ref<readonly string[]>([]);
const detail = ref<SessionDetailResponse | null>(null);
const selectedId = ref<string | null>(null);
const selectedPhaseId = ref<string | null>(null);
const settings = ref<unknown>({});
const adapters = ref<AdaptersResponse>({ adapters: [] });
const settingsRoute = ref(false);
const backlogRoute = ref(false);
/** The plan a sessions-view card asked the backlog to open with. */
const backlogPlan = ref<string | null>(null);
const backlog = ref<TicketsResponse>({ plans: [], tickets: [], ready: [], counts: { state: { todo: 0, wip: 0, done: 0, failed: 0 }, milestone: {}, tier: { T0: 0, T1: 0, T2: 0 } }, projectedCost: { usd: null, authority: "unavailable", partial: true } });

let hasSeededWorkflowSelection = false;
let hasSeededLifecycleSelection = false;
let hasSeededPlanKindSelection = false;
watch(configuredWorkflows, (workflows) => {
  if (hasSeededWorkflowSelection) return;
  selectedWorkflows.value = [...workflows];
  hasSeededWorkflowSelection = true;
});
watch(
  () => sessions.value.sessions,
  () => {
    if (hasSeededLifecycleSelection) return;
    selectedLifecycleStates.value = [...LIFECYCLE_STATES];
    hasSeededLifecycleSelection = true;
  },
);
watch(
  () => sessions.value.sessions,
  () => {
    if (hasSeededPlanKindSelection) return;
    selectedPlanKinds.value = [...PLAN_KINDS];
    hasSeededPlanKindSelection = true;
  },
);

function readEnabledWorkflows(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || !("workflows" in value)) return [];
  const workflows = value.workflows;
  if (typeof workflows !== "object" || workflows === null || !("enabled" in workflows)) return [];
  const enabled = workflows.enabled;
  if (!Array.isArray(enabled)) return [];
  const workflowIds: string[] = [];
  for (const workflow of enabled) {
    if (typeof workflow !== "string") return [];
    workflowIds.push(workflow);
  }
  return workflowIds;
}

let settingsRequest: Promise<void> | null = null;
function loadSettingsOnce(): Promise<void> {
  settingsRequest ??= (async () => {
    const response = await fetch("/api/v1/settings");
    if (!response.ok) throw new Error("Settings unavailable");
    const payload: SettingsResponse = await response.json();
    settings.value = payload.settings;
    configuredWorkflows.value = readEnabledWorkflows(payload.settings);
  })();
  return settingsRequest;
}

function readRoute(): void {
  settingsRoute.value = location.hash === "#/settings";
  // `#/backlog/<plan>` is how a sessions-view plan card hands the backlog its
  // plan context: the same identity both views already group by, in the URL, so
  // the context survives a reload and a back button rather than only a click.
  const backlogWithPlan = /^#\/backlog\/([^/]+)$/.exec(location.hash);
  backlogRoute.value = location.hash === "#/backlog" || backlogWithPlan !== null;
  backlogPlan.value = backlogWithPlan?.[1] ? decodeURIComponent(backlogWithPlan[1]) : null;
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
    ? fetch("/api/v1/adapters")
    : backlogRoute.value ? fetch("/api/v1/tickets")
    : selectedId.value
      ? fetch(`/api/v1/sessions/${encodeURIComponent(selectedId.value)}`)
      : fetch("/api/v1/sessions");
  const [nextHealth, nextData] = await Promise.all([
    fetch("/api/v1/health"),
    dataRequest,
    loadSettingsOnce(),
  ]);
  if (!nextHealth.ok) throw new Error("Dashboard data unavailable");
  health.value = await nextHealth.json() as HealthResponse;
  if (settingsRoute.value) {
    const adaptersResponse = nextData as Response;
    if (!adaptersResponse.ok) throw new Error("Settings unavailable");
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
    <BacklogRoute v-else-if="backlogRoute" :backlog="backlog" :plan="backlogPlan" />
    <SessionRoute v-else-if="detail" :session="detail" :selected-phase-id="selectedPhaseId" />
    <SessionsGrid
      v-else
      v-model:selected-workflows="selectedWorkflows"
      v-model:selected-states="selectedLifecycleStates"
      v-model:selected-plan-kinds="selectedPlanKinds"
      :sessions="sessions.sessions"
      :plans="sessions.plans"
      :workflows="configuredWorkflows"
    />
  </AppShell>
</template>
