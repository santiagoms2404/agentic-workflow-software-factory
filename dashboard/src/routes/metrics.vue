<script setup lang="ts">
import { computed, ref } from "vue";
import type { MetricsResponse } from "../../shared/types.ts";
import { listPrice } from "../../shared/rate-card.ts";
import { EVIDENCE_SOURCES } from "../../shared/route-metrics.ts";
import SessionFilterRow from "../components/SessionFilterRow.vue";
import { usePolling } from "../composables/usePolling.ts";
import { shortSessionId } from "../display.ts";
import {
  METRICS_VIEWS,
  RAIL_FACETS,
  VIEW_LABEL,
  countTile,
  facetOptions,
  metricsRouteHash,
  resetLens,
  routeFocusNote,
  rowsInLens,
  selectedValues,
  summaryStats,
  withSelection,
  withView,
  type FacetId,
  type MetricsRouteState,
  type MetricsView,
  type RailFacet,
  type RailOption,
} from "../metrics-lens.ts";
import { selectAllState, toggleFilterValue, type SessionFilterEntry } from "../session-filters.ts";

const props = defineProps<{
  route: MetricsRouteState;
  /** Role name to its configured colour, from the settings the shell already read. */
  roleColors: Readonly<Record<string, string>>;
}>();

const payload = ref<MetricsResponse | null>(null);
const failed = ref(false);

// Read-only: one GET, polled at the idle cadence. The payload is a whole
// projection read, and these numbers move when a run settles, not per second.
async function load(): Promise<void> {
  try {
    const response = await fetch("/api/v1/metrics");
    if (!response.ok) throw new Error("Metrics unavailable");
    payload.value = await response.json() as MetricsResponse;
    failed.value = false;
  } catch (reason) {
    failed.value = true;
    throw reason;
  }
}
usePolling(load, () => "idle");

const RAIL_TITLE: Readonly<Record<RailFacet, string>> = {
  role: "Role",
  model: "Model",
  effort: "Effort",
  state: "Terminal state",
  workflow: "Workflow",
  project: "Project",
};

const rows = computed(() => payload.value?.roleRows ?? []);
const rateCard = computed(() => payload.value?.rateCard.rows ?? []);
const context = computed(() => ({ rateCard: rateCard.value, roleColors: props.roleColors }));
const lensRows = computed(() => rowsInLens(rows.value, props.route));
const tile = computed(() => countTile(payload.value?.runs ?? [], rows.value, props.route));
const summary = computed(() => summaryStats(lensRows.value, listPrice));
const focusNote = computed(() => routeFocusNote(props.route, rows.value, rateCard.value));
/** Both sources are always listed; the proving ground stays disabled until M4 records replays. */
const sourcePills = computed(() => {
  const options = facetOptions(rows.value, props.route, "source", context.value);
  const selected = selectedValues(props.route, "source", [...EVIDENCE_SOURCES]);
  return EVIDENCE_SOURCES.map((value) => ({
    value,
    label: value === "production" ? "production" : "proving ground",
    count: options.find((entry) => entry.value === value)?.count ?? 0,
    live: value === "production",
    title: value === "production" ? "Evidence from the factory's own runs" : "M4 adds controlled replays",
    selected: value === "production" && selected.includes(value),
  }));
});
const ladders = computed(() => RAIL_FACETS.map((id) => {
  const options = facetOptions(rows.value, props.route, id, context.value);
  const values = options.map((option) => option.value);
  const selected = selectedValues(props.route, id, values);
  return { id, title: RAIL_TITLE[id], options, values, selected, all: selectAllState(values, selected) };
}));
const selectedRun = computed(() => payload.value?.runs.find((run) => run.sessionId === props.route.run) ?? null);

function go(next: MetricsRouteState): void {
  location.hash = metricsRouteHash(next);
}
function select(id: FacetId, values: readonly string[], selected: readonly string[]): void {
  go(withSelection(props.route, id, values, selected));
}
function toggleSource(value: string): void {
  const values = [...EVIDENCE_SOURCES];
  select("source", values, toggleFilterValue(selectedValues(props.route, "source", values), value));
}
function showView(view: MetricsView): void {
  go(withView(props.route, view));
}
/** The slot hands back the ladder's own entry; these are the rail's, with their dot or glyph. */
function option(entry: SessionFilterEntry): RailOption {
  return entry as RailOption;
}
</script>

<template>
  <main class="metrics-shell" aria-labelledby="metrics-title">
    <aside class="metrics-rail" aria-label="Lens">
      <div class="run-count-tile metrics-count-tile">
        <h1 id="metrics-title" class="metrics-count-headline"><strong>{{ tile.inLens }}</strong></h1>
        <span>runs in lens · {{ tile.recorded }} recorded</span>
        <span>{{ tile.neverReachedAgent }} never reached an agent</span>
        <span>option counts are role-rows</span>
      </div>

      <!-- One live value until M4, so no select-all: it could only empty the lens. -->
      <section class="session-filter-row filter-ladder metrics-ladder" aria-labelledby="metrics-source-title">
        <div class="session-filter-heading">
          <h2 id="metrics-source-title">Evidence source</h2>
        </div>
        <div class="session-filter-options" role="group" aria-label="Evidence source choices">
          <button
            v-for="pill in sourcePills"
            :key="pill.value"
            type="button"
            class="session-filter-option"
            :class="{ selected: pill.selected }"
            :disabled="!pill.live"
            :aria-pressed="pill.selected"
            :title="pill.title"
            @click="toggleSource(pill.value)"
          >
            <span class="session-filter-label">{{ pill.label }}</span>
            <span class="session-filter-count">{{ pill.count }}</span>
          </button>
        </div>
      </section>

      <SessionFilterRow
        v-for="ladder in ladders"
        :key="ladder.id"
        class="session-filter-row filter-ladder metrics-ladder"
        :filter-id="`metrics-${ladder.id}`"
        :label="ladder.title"
        :entries="ladder.options"
        :selected="ladder.selected"
        count-unit=""
        :select-all-label="ladder.all === 'all' ? 'only…' : 'select all'"
        @update:selected="(selected) => select(ladder.id, ladder.values, selected)"
      >
        <template #marker="{ entry }">
          <i v-if="option(entry).dot" class="metrics-dot" :style="{ background: option(entry).dot }" aria-hidden="true" />
          <svg v-else-if="option(entry).provider === 'anthropic'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg>
          <svg v-else-if="option(entry).provider === 'openai'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" /></svg>
        </template>
      </SessionFilterRow>
    </aside>

    <div class="metrics-board">
      <nav class="metrics-view-bar" aria-label="Metrics views">
        <button
          v-for="view in METRICS_VIEWS"
          :key="view"
          type="button"
          class="metrics-pill"
          :aria-pressed="route.view === view"
          @click="showView(view)"
        >{{ VIEW_LABEL[view] }}</button>
        <span class="metrics-bar-spacer" />
        <span v-if="focusNote" class="metrics-focus-note">{{ focusNote }}</span>
        <button type="button" class="metrics-pill" @click="go(resetLens(route))">Reset lens</button>
      </nav>

      <section class="metrics-summary" aria-label="Lens summary">
        <div v-for="stat in summary" :key="stat.id" class="metrics-stat">
          <span class="metrics-stat-label">{{ stat.label }}</span>
          <strong class="metrics-stat-value">{{ stat.value }}</strong>
          <span class="metrics-stat-caption">{{ stat.caption }}</span>
          <span v-if="stat.id === 'list-per-landed' && payload" class="metrics-stat-caption">rate card checked {{ payload.rateCard.checkedAt }}</span>
        </div>
      </section>

      <section class="neu-well metrics-view" :aria-label="`${VIEW_LABEL[route.view]} view`">
        <p v-if="!payload && failed" class="metrics-note" role="alert">Metrics unavailable. The tab retries on its own.</p>
        <p v-else-if="!payload" class="metrics-note">Reading the projection…</p>
        <template v-else-if="route.view === 'run'">
          <h2 class="metrics-view-title">One run</h2>
          <p v-if="route.run && selectedRun" class="metrics-note">Run {{ shortSessionId(selectedRun.sessionId) }} · {{ selectedRun.taskId }} · attempt {{ selectedRun.attempt }} · {{ selectedRun.workflow }}</p>
          <p v-else-if="route.run" class="metrics-note">Run {{ shortSessionId(route.run) }} is not in the projection.</p>
          <p class="metrics-note">The run card, fact grid, phase strip and per-role table arrive with task 9.</p>
        </template>
        <template v-else>
          <h2 class="metrics-view-title">{{ route.view === "matrix" ? "Route × role" : VIEW_LABEL[route.view] }}</h2>
          <p class="metrics-note">{{ lensRows.length }} role-rows in the lens. This view arrives with task {{ route.view === "ledger" ? 9 : 8 }}.</p>
        </template>
      </section>
    </div>
  </main>
</template>
