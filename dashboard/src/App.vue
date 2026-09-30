<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AdaptersResponse, GroupsResponse, HealthResponse, SessionDetailResponse, SessionsResponse, SettingsResponse, TicketsResponse } from "../shared/types.ts";
import AppShell from "./components/AppShell.vue";
import SessionsGrid from "./components/SessionsGrid.vue";
import SessionRoute from "./components/SessionRoute.vue";
import SettingsRoute from "./components/SettingsRoute.vue";
import BacklogRoute from "./routes/backlog.vue";
import CanvasScreen from "./routes/canvas.vue";
import GroupsRoute from "./routes/groups.vue";
import MetricsScreen from "./routes/metrics.vue";
import { usePolling, type PollMode } from "./composables/usePolling.ts";
import { useNotifySound } from "./composables/useNotifySound.ts";
import { isCanvasRoute, parseCanvasRoute, type CanvasRoute } from "./canvas-view.ts";
import { loadAllSessions } from "./session-pages.ts";
import { DEFAULT_METRICS_ROUTE, isMetricsRoute, parseMetricsRoute, readRoleColors, type MetricsRouteState } from "./metrics-lens.ts";
import { admitNewFilterValues, LIFECYCLE_STATES } from "./session-filters.ts";
import { groupFilterValues } from "./session-groups.ts";
import { PLAN_KINDS } from "./session-plans.ts";

const health = ref<HealthResponse | null>(null);
const sessions = ref<SessionsResponse>({ sessions: [], plans: [] });
const configuredWorkflows = ref<readonly string[]>([]);
const selectedWorkflows = ref<readonly string[]>([]);
const selectedLifecycleStates = ref<readonly string[]>([]);
const selectedPlanKinds = ref<readonly string[]>([]);
const selectedGroups = ref<readonly string[]>([]);
const groups = ref<GroupsResponse>({ groups: [], unreadable: [] });
const detail = ref<SessionDetailResponse | null>(null);
const selectedId = ref<string | null>(null);
const selectedPhaseId = ref<string | null>(null);
const settings = ref<unknown>({});
const adapters = ref<AdaptersResponse>({ adapters: [] });
const settingsRoute = ref(false);
const backlogRoute = ref(false);
const groupsRoute = ref(false);
const canvasRoute = ref(false);
/** Selection, camera and filters, all of them in the URL so Back restores them. */
const canvasState = ref<CanvasRoute>({ kinds: ["run", "session", "plan"], selected: null, camera: null, opened: null });
const metricsRoute = ref(false);
/** The view, the run and the lens, in the URL for the same reason as the canvas's. */
const metricsState = ref<MetricsRouteState>(DEFAULT_METRICS_ROUTE);
const roleColors = computed(() => readRoleColors(settings.value));
/** The plan a sessions-view card asked the backlog to open with. */
const backlogPlan = ref<string | null>(null);
/** The driving session whose tree the groups screen is showing. */
const selectedGroup = ref<string | null>(null);
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
/**
 * The other three menus draw on a fixed vocabulary, so seeding them once is
 * enough. Driving sessions are not fixed: a group can be recorded while the
 * board is open, and a selection seeded once would silently exclude the runs
 * that name it. So a value nobody has seen before is admitted as selected, and
 * one the reader switched off stays off across every poll.
 */
let knownGroupValues: readonly string[] = [];
watch(
  () => groupFilterValues(sessions.value.sessions, groups.value.groups),
  (values) => {
    selectedGroups.value = admitNewFilterValues(knownGroupValues, values, selectedGroups.value);
    knownGroupValues = values;
  },
  { immediate: true },
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

// The group list is titles and counts, not trees: one read at startup, and the
// tree itself is fetched only when a reader opens one. Polling a 70-stage
// journal every few seconds to render a heading would be an odd trade.
let groupsRequest: Promise<void> | null = null;
function loadGroupsOnce(): Promise<void> {
  groupsRequest ??= (async () => {
    const response = await fetch("/api/v1/groups");
    if (!response.ok) return;
    groups.value = await response.json() as GroupsResponse;
  })().catch(() => {
    // A project with no planning state is the ordinary case, not an error the
    // sessions view should refuse to render over.
  });
  return groupsRequest;
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
  // The decision tree has its own screen: a 72-stage group needs the width, and
  // sharing the sessions view with the runs it produced gave it neither.
  // `#/canvas?kinds=…&sel=…&cam=…`: the canvas keeps its whole state here,
  // because Back has to restore the camera and the selection with it.
  canvasRoute.value = isCanvasRoute(location.hash);
  if (canvasRoute.value) canvasState.value = parseCanvasRoute(location.hash);
  // `#/metrics/run/<sessionId>?x.role=…`: what a run card's metrics control
  // opens, with the lens riding along in the query so Back restores it.
  metricsRoute.value = isMetricsRoute(location.hash);
  if (metricsRoute.value) metricsState.value = parseMetricsRoute(location.hash);
  const groupWithId = /^#\/groups\/([^/]+)$/.exec(location.hash);
  groupsRoute.value = location.hash === "#/groups" || groupWithId !== null;
  selectedGroup.value = groupWithId?.[1] ? decodeURIComponent(groupWithId[1]) : null;
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

/**
 * The read a poll issues. The sessions board, the groups view and the canvas
 * all read every session; one run's page reads that run.
 */
type ReadKind = "metrics" | "settings" | "backlog" | "sessions" | `session:${string}`;

function readKind(): ReadKind {
  if (metricsRoute.value) return "metrics";
  if (settingsRoute.value) return "settings";
  if (canvasRoute.value || groupsRoute.value) return "sessions";
  if (backlogRoute.value) return "backlog";
  return selectedId.value ? `session:${selectedId.value}` : "sessions";
}

async function load(): Promise<void> {
  // A paged read publishes only a complete projection. The kind is taken again
  // after the awaits, and a poll whose view changed while it loaded publishes
  // nothing, so one view's response is never read as another's.
  const kind = readKind();
  // The metrics tab polls its own payload; the shell needs only health here.
  const dataRequest = kind === "metrics" ? Promise.resolve(null)
    : kind === "settings" ? fetch("/api/v1/adapters")
    : kind === "backlog" ? fetch("/api/v1/tickets")
    : kind === "sessions" ? loadAllSessions()
    : fetch(`/api/v1/sessions/${encodeURIComponent(kind.slice("session:".length))}`);
  const [nextHealth, nextData] = await Promise.all([
    fetch("/api/v1/health"),
    dataRequest,
    loadSettingsOnce(),
    loadGroupsOnce(),
  ]);
  if (kind !== readKind()) return;
  if (!nextHealth.ok) throw new Error("Dashboard data unavailable");
  health.value = await nextHealth.json() as HealthResponse;
  if (kind === "metrics") {
    detail.value = null;
  } else if (kind === "settings") {
    const adaptersResponse = nextData as Response;
    if (!adaptersResponse.ok) throw new Error("Settings unavailable");
    adapters.value = await adaptersResponse.json() as AdaptersResponse;
    detail.value = null;
  } else if (kind === "backlog") {
    const response = nextData as Response;
    if (!response.ok) throw new Error("Backlog unavailable");
    backlog.value = await response.json() as TicketsResponse;
    detail.value = null;
  } else if (kind === "sessions") {
    sessions.value = nextData as SessionsResponse;
    detail.value = null;
  } else {
    const response = nextData as Response;
    if (!response.ok) throw new Error("Dashboard data unavailable");
    detail.value = await response.json() as SessionDetailResponse;
  }
}
const { lastPollAt, pollMs } = usePolling(load, () => mode.value);
/**
 * Two sounds, so silence means nothing is wrong.
 *
 * Fed the sessions list, which only changes when a poll returned one — so it
 * announces transitions it actually observed and nothing else. Off until the
 * reader turns it on in Settings, because browsers refuse to make sound before
 * an interaction and because nothing should start making noise on its own.
 */
const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useNotifySound(computed(() => sessions.value.sessions));
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
    :groups="groupsRoute"
    :canvas="canvasRoute"
    :metrics="metricsRoute"
  >
    <SettingsRoute v-if="settingsRoute" :settings="settings" :adapters="adapters.adapters" :health="health"
      :sound-enabled="soundEnabled" @update:sound-enabled="setSoundEnabled" />
    <MetricsScreen v-else-if="metricsRoute" :route="metricsState" :role-colors="roleColors" />
    <CanvasScreen
      v-else-if="canvasRoute"
      :sessions="sessions.sessions"
      :plans="sessions.plans"
      :groups="groups.groups"
      :route="canvasState"
    />
    <GroupsRoute v-else-if="groupsRoute" :groups="groups" :selected="selectedGroup" />
    <BacklogRoute v-else-if="backlogRoute" :backlog="backlog" :plan="backlogPlan" />
    <SessionRoute v-else-if="detail" :session="detail" :selected-phase-id="selectedPhaseId" />
    <SessionsGrid
      v-else
      v-model:selected-workflows="selectedWorkflows"
      v-model:selected-states="selectedLifecycleStates"
      v-model:selected-plan-kinds="selectedPlanKinds"
      v-model:selected-groups="selectedGroups"
      :sessions="sessions.sessions"
      :plans="sessions.plans"
      :groups="groups.groups"
      :workflows="configuredWorkflows"
    />
  </AppShell>
</template>
