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
import { memoizeUntilRejected } from "./memo-loader.ts";
import { planBanner, sessionsPlanBanner, type PlanBanner } from "./plan-banner.ts";
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
const emptyBacklog = (): TicketsResponse => ({ plans: [], tickets: [], ready: [], counts: { state: { todo: 0, wip: 0, done: 0, failed: 0 }, milestone: {}, tier: { T0: 0, T1: 0, T2: 0 } }, projectedCost: { usd: null, authority: "unavailable", partial: true } });
const backlog = ref<TicketsResponse>(emptyBacklog());
/** Said over the board when its catalog does not resolve: refused, or stale (O4). */
const backlogBanner = ref<PlanBanner | null>(null);
/** The same, over the views that draw runs against the sessions route's plan list. */
const sessionsBanner = computed(() => sessionsPlanBanner(sessions.value));

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

// The group list is titles and counts, not trees: one successful read, and the
// tree itself is fetched only when a reader opens one. Polling a 70-stage
// journal every few seconds to render a heading would be an odd trade. A failed
// read is not memoized: it rejects inside the memo, so the next poll reads
// again, instead of one startup blip leaving the list empty for the page's life.
let lastGroupsFetch = 0;
const readGroups = memoizeUntilRejected(async () => {
  const response = await fetch("/api/v1/groups");
  if (!response.ok) throw new Error("Groups unavailable");
  groups.value = await response.json() as GroupsResponse;
  lastGroupsFetch = Date.now();
});
async function loadGroups(): Promise<void> {
  const known = new Set(groups.value.groups.map((g) => g.group));
  const hasUnseen = sessions.value.sessions.some((s) => s.groupId && !known.has(s.groupId));
  if (hasUnseen && Date.now() - lastGroupsFetch > 1000) {
    try {
      const response = await fetch("/api/v1/groups");
      if (response.ok) {
        groups.value = await response.json() as GroupsResponse;
        lastGroupsFetch = Date.now();
      }
    } catch {
      // An empty or failing group list is not an error the sessions view should refuse
    }
    return;
  }
  return readGroups().catch(() => {
    // An empty group list is not an error the sessions view should refuse to
    // render over; the failure is swallowed here, outside the memo, so it is
    // retried on the next poll rather than kept.
  });
}

// Settings are read once too, and a failed read likewise retries on the next
// poll. Memoizing the rejection made every later poll reject until a reload.
const loadSettingsOnce = memoizeUntilRejected(async () => {
  const response = await fetch("/api/v1/settings");
  if (!response.ok) throw new Error("Settings unavailable");
  const payload: SettingsResponse = await response.json();
  settings.value = payload.settings;
  configuredWorkflows.value = readEnabledWorkflows(payload.settings);
});

// A malformed percent sequence (e.g. `#/sessions/%` or `#/groups/%E0`) must not
// throw URIError: throwing inside onMounted aborts before the hashchange
// listener is registered, permanently breaking navigation. Fall back to the raw
// string on malformed input, and keep literal `+` untouched (B13-09, B13-10,
// B13-28, B14-03).
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readRoute(): void {
  settingsRoute.value = location.hash === "#/settings";
  // `#/backlog/<plan>` is how a sessions-view plan card hands the backlog its
  // plan context: the same identity both views already group by, in the URL, so
  // the context survives a reload and a back button rather than only a click.
  const backlogWithPlan = /^#\/backlog\/([^/]+)$/.exec(location.hash);
  backlogRoute.value = location.hash === "#/backlog" || backlogWithPlan !== null;
  backlogPlan.value = backlogWithPlan?.[1] ? safeDecode(backlogWithPlan[1]) : null;
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
  selectedGroup.value = groupWithId?.[1] ? safeDecode(groupWithId[1]) : null;
  const phase = location.hash.match(/^#\/sessions\/([^/]+)\/phases\/([^/]+)$/);
  const session = location.hash.match(/^#\/sessions\/([^/]+)$/);
  selectedId.value = safeDecode(phase?.[1] ?? session?.[1] ?? "") || null;
  selectedPhaseId.value = phase?.[2] ? safeDecode(phase[2]) : null;
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
    loadGroups(),
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
    if (!response.ok) {
      // A plan catalog that does not resolve is a named refusal, shown as a
      // banner over an empty board rather than an empty board alone. Any other
      // failure still fails the poll as before.
      const refused = planBanner({ ok: false, body: await response.json().catch(() => null) });
      if (refused === null) throw new Error("Backlog unavailable");
      backlogBanner.value = refused;
      backlog.value = emptyBacklog();
    } else {
      backlog.value = await response.json() as TicketsResponse;
      backlogBanner.value = planBanner({ ok: true, body: backlog.value });
    }
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
    <template v-else-if="canvasRoute">
      <p v-if="sessionsBanner" class="error-bar" role="alert">
        <strong>{{ sessionsBanner.heading }}</strong> {{ sessionsBanner.detail }}
      </p>
      <CanvasScreen
        :sessions="sessions.sessions"
        :plans="sessions.plans"
        :groups="groups.groups"
        :route="canvasState"
      />
    </template>
    <GroupsRoute v-else-if="groupsRoute" :groups="groups" :selected="selectedGroup" />
    <template v-else-if="backlogRoute">
      <p v-if="backlogBanner" class="error-bar" role="alert">
        <strong>{{ backlogBanner.heading }}</strong> {{ backlogBanner.detail }}
      </p>
      <BacklogRoute :backlog="backlog" :plan="backlogPlan" />
    </template>
    <SessionRoute v-else-if="detail" :session="detail" :selected-phase-id="selectedPhaseId" />
    <template v-else>
      <p v-if="sessionsBanner" class="error-bar" role="alert">
        <strong>{{ sessionsBanner.heading }}</strong> {{ sessionsBanner.detail }}
      </p>
      <SessionsGrid
        v-model:selected-workflows="selectedWorkflows"
        v-model:selected-states="selectedLifecycleStates"
        v-model:selected-plan-kinds="selectedPlanKinds"
        v-model:selected-groups="selectedGroups"
        :sessions="sessions.sessions"
        :plans="sessions.plans"
        :groups="groups.groups"
        :workflows="configuredWorkflows"
      />
    </template>
  </AppShell>
</template>
