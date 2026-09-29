<script setup lang="ts">
import { computed, ref } from "vue";
import type { MetricsResponse } from "../../shared/types.ts";
import { listPrice } from "../../shared/rate-card.ts";
import { EVIDENCE_SOURCES } from "../../shared/route-metrics.ts";
import MetricsFrontier from "../components/MetricsFrontier.vue";
import MetricsLedger from "../components/MetricsLedger.vue";
import MetricsMatrix from "../components/MetricsMatrix.vue";
import MetricsRun from "../components/MetricsRun.vue";
import SessionFilterRow from "../components/SessionFilterRow.vue";
import { usePolling } from "../composables/usePolling.ts";
import { shortSessionId } from "../display.ts";
import {
  METRICS_VIEWS,
  RAIL_FACETS,
  VIEW_LABEL,
  countTile,
  facetOptions,
  focusTile,
  metricsRouteHash,
  resetLens,
  routeFocusNote,
  rowsInLens,
  selectedValues,
  summaryStats,
  withFamily,
  withFrontier,
  withGroup,
  withRun,
  withSelection,
  withSort,
  withView,
  type ColumnFamily,
  type FacetId,
  type FrontierState,
  type LedgerGroup,
  type MetricsRouteState,
  type MetricsView,
  type RailFacet,
  type RailOption,
} from "../metrics-lens.ts";
import { buildLedger } from "../metrics-ledger.ts";
import { buildMatrix } from "../metrics-matrix.ts";
import { attributionPanel, phaseStrip, roleLines, runFacts, runPicker } from "../metrics-run.ts";
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
/** Both sources are always listed. The proving ground is off by default and joins the statistics only when selected (DD8). */
const sourcePills = computed(() => {
  const options = facetOptions(rows.value, props.route, "source", context.value);
  const selected = selectedValues(props.route, "source", [...EVIDENCE_SOURCES]);
  return EVIDENCE_SOURCES.map((value) => ({
    value,
    label: value === "production" ? "production" : "proving ground",
    count: options.find((entry) => entry.value === value)?.count ?? 0,
    title: value === "production" ? "Evidence from the factory's own runs" : "Controlled replays of the frozen corpus, from awsf prove",
    selected: selected.includes(value),
  }));
});
const ladders = computed(() => RAIL_FACETS.map((id) => {
  const options = facetOptions(rows.value, props.route, id, context.value);
  const values = options.map((option) => option.value);
  const selected = selectedValues(props.route, id, values);
  return { id, title: RAIL_TITLE[id], options, values, selected, all: selectAllState(values, selected) };
}));
const matrix = computed(() => (payload.value === null ? null : buildMatrix(lensRows.value, payload.value, listPrice, props.route.untested)));
const ledgerContext = computed(() => ({ ...context.value, priorLabels: payload.value?.priors.modelLabels ?? {} }));
const ledger = computed(() => buildLedger(lensRows.value, props.route, listPrice, ledgerContext.value));
const picker = computed(() => (payload.value === null ? null : runPicker(payload.value, props.route)));
/** The shown run's own role-rows, every one of them: the lens chooses the run, not its rows. */
const runRows = computed(() => rows.value.filter((row) => row.sessionId === picker.value?.selected?.sessionId));
const runView = computed(() => {
  const run = picker.value?.selected ?? null;
  if (run === null) return null;
  return {
    run,
    facts: runFacts(run, runRows.value, listPrice),
    strip: phaseStrip(run.phases),
    lines: roleLines(runRows.value, listPrice, { ...ledgerContext.value, allRows: rows.value }),
    panel: attributionPanel(run),
  };
});

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
function openTile(role: string, routeKey: string): void {
  const roles = ladders.value.find((ladder) => ladder.id === "role")?.values ?? [role];
  go(focusTile(props.route, role, routeKey, roles));
}
function changeFrontier(change: Partial<FrontierState>): void {
  go(withFrontier(props.route, change));
}
function openRun(sessionId: string): void {
  go(withRun(props.route, sessionId));
}
function runHref(sessionId: string): string {
  return metricsRouteHash(withRun(props.route, sessionId));
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

      <!-- Two values toggled one at a time: production is on by default, and the proving ground joins only when selected. -->
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
          <MetricsRun
            v-if="picker && runView"
            :runs="picker.runs"
            :run="runView.run"
            :facts="runView.facts"
            :strip="runView.strip"
            :lines="runView.lines"
            :panel="runView.panel"
            @pick="openRun"
          />
          <template v-else>
            <h2 class="metrics-view-title">One run</h2>
            <p v-if="picker?.missing" class="metrics-note">Run {{ shortSessionId(picker.missing) }} is not in the projection.</p>
            <p v-else class="metrics-note">No run has a role-row in this lens.</p>
          </template>
        </template>
        <MetricsMatrix
          v-else-if="route.view === 'matrix' && matrix"
          :matrix="matrix"
          :show-untested="route.untested"
          :role-colors="roleColors"
          @open="openTile"
          @toggle-untested="go({ ...route, untested: !route.untested })"
        />
        <MetricsFrontier
          v-else-if="route.view === 'frontier'"
          :rows="lensRows"
          :rate-card="rateCard"
          :prior-labels="payload.priors.modelLabels"
          :state="route.frontier"
          :role-colors="roleColors"
          @change="changeFrontier"
        />
        <MetricsLedger
          v-else-if="route.view === 'ledger'"
          :ledger="ledger"
          :families="route.families"
          :run-href="runHref"
          @group="(group: LedgerGroup) => go(withGroup(route, group))"
          @family="(family: ColumnFamily) => go(withFamily(route, family))"
          @sort="(column: string) => go(withSort(route, column))"
          @open="openRun"
        />
      </section>
    </div>
  </main>
</template>
