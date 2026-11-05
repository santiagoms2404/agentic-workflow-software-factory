<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { EventItem, EventsResponse, PhaseStatus } from "../../shared/types.ts";
import { formatDuration } from "../display.ts";
import { foldTextDeltaRuns, type DisplayRow, type FoldedTextDeltaRow } from "../delta-fold.ts";
import { summarizeEvent } from "../event-summary.ts";
import { usePolling } from "../composables/usePolling.ts";

const props = defineProps<{ sessionId: string; phaseId: string; phaseStatus: PhaseStatus }>();
const events = ref<EventItem[]>([]);
const cursor = ref(0);
const hasMore = ref(false);
const loading = ref(false);
/** True once an attempt for the current session has finished, so the empty note does not blink on every poll. */
const settled = ref(false);
const error = ref<string | null>(null);
const expanded = reactive(new Set<string>());
const rawRows = reactive(new Set<string>());
let requestVersion = 0;

const phaseEvents = computed(() => events.value.filter((event) => event.phaseId === props.phaseId));
const foldedRows = computed(() => foldTextDeltaRuns(phaseEvents.value));
function isFoldedTextDeltaRow(event: DisplayRow): event is FoldedTextDeltaRow {
  return event.type === "text.delta.fold" && "reassembledText" in event;
}
function rowSummary(event: DisplayRow): string {
  return isFoldedTextDeltaRow(event)
    ? `streamed response · ${event.chunkCount} chunks · ${event.endedAt ? formatDuration(event.startedAt, event.endedAt) : "point event"}`
    : summarizeEvent(event);
}
function toggle(id: string): void { expanded.has(id) ? expanded.delete(id) : expanded.add(id); }
function json(value: unknown): string { return JSON.stringify(value, null, 2); }
async function load(): Promise<void> {
  if (loading.value) return;
  const version = requestVersion;
  const sessionId = props.sessionId;
  loading.value = true;
  try {
    let more = false;
    do {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/events?after=${cursor.value}&limit=200`);
      if (!response.ok) throw new Error("Event log unavailable");
      const page = await response.json() as EventsResponse;
      if (version !== requestVersion || sessionId !== props.sessionId) return;
      const known = new Set(events.value.map((event) => event.id));
      events.value.push(...page.events.filter((event) => !known.has(event.id)));
      cursor.value = page.cursor;
      more = page.hasMore;
      hasMore.value = page.hasMore;
    } while (more);
    error.value = null;
  } catch (reason) {
    if (version !== requestVersion || sessionId !== props.sessionId) return;
    error.value = reason instanceof Error ? reason.message : "Event log unavailable";
    throw reason;
  } finally {
    loading.value = false;
    if (version === requestVersion) settled.value = true;
  }
}
const terminalStatuses: ReadonlySet<PhaseStatus> = new Set(["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"]);
const { refresh } = usePolling(load, () => "grid", () => !terminalStatuses.has(props.phaseStatus));

watch(
  () => props.sessionId,
  () => {
    requestVersion++;
    cursor.value = 0;
    events.value = [];
    hasMore.value = false;
    settled.value = false;
    error.value = null;
    void refresh();
  },
);
watch(() => props.phaseId, () => void refresh());
</script>

<template>
  <section class="event-log" aria-label="Chronological phase events">
    <header><h3>Events ({{ phaseEvents.length }})</h3><span>chronological · canonical timestamps</span></header>
    <p v-if="error" role="alert" class="empty-note">{{ error }}</p>
    <div v-if="!phaseEvents.length && settled" class="empty-note">No events recorded for this phase.</div>
    <article v-for="row in foldedRows" :key="row.id" class="event-row" :class="`event-${row.type}`">
      <button type="button" :aria-expanded="expanded.has(row.id)" @click="toggle(row.id)">
        <time>{{ new Date(row.startedAt).toLocaleTimeString([], { hour12: false }) }}</time>
        <strong>{{ row.type }}</strong>
        <span :title="rowSummary(row)">{{ rowSummary(row) }}</span>
        <em>{{ isFoldedTextDeltaRow(row) ? "recorded" : row.status ?? "recorded" }}</em>
        <small>{{ row.endedAt ? formatDuration(row.startedAt, row.endedAt) : "point event" }}</small>
      </button>
      <template v-if="expanded.has(row.id)">
        <div class="view-toggle" aria-label="Event display mode">
          <button type="button" :class="{ active: !rawRows.has(row.id) }" @click="rawRows.delete(row.id)">rendered</button>
          <button type="button" :class="{ active: rawRows.has(row.id) }" @click="rawRows.add(row.id)">raw</button>
        </div>
        <pre v-if="rawRows.has(row.id)">{{ isFoldedTextDeltaRow(row) ? json(row.chunkPayloads) : json(row.payload) }}</pre>
        <pre v-else>{{ isFoldedTextDeltaRow(row) ? row.reassembledText : summarizeEvent(row) }}</pre>
      </template>
    </article>
  </section>
</template>
