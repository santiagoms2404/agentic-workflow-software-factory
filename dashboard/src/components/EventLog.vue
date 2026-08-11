<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { EventItem, EventsResponse } from "../../shared/types.ts";
import { formatDuration } from "../display.ts";

const props = defineProps<{ sessionId: string; phaseId: string }>();
const events = ref<EventItem[]>([]);
const cursor = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const expanded = reactive(new Set<string>());
let timer: ReturnType<typeof setInterval> | undefined;

const phaseEvents = computed(() => events.value.filter((event) => event.phaseId === props.phaseId));
function toggle(id: string): void { expanded.has(id) ? expanded.delete(id) : expanded.add(id); }
function summary(item: EventItem): string {
  if (!item.payload || typeof item.payload !== "object") return item.name || "—";
  const value = item.payload as Record<string, unknown>;
  for (const key of ["inputSummary", "message", "detail", "reason", "resolvedModel"]) {
    if (typeof value[key] === "string" && value[key]) return String(value[key]);
  }
  return item.name || item.type;
}
function json(value: unknown): string { return JSON.stringify(value, null, 2); }
async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    let more = false;
    do {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(props.sessionId)}/events?after=${cursor.value}&limit=200`);
      if (!response.ok) throw new Error("Event log unavailable");
      const page = await response.json() as EventsResponse;
      const known = new Set(events.value.map((event) => event.id));
      events.value.push(...page.events.filter((event) => !known.has(event.id)));
      cursor.value = page.cursor;
      more = page.hasMore;
      hasMore.value = page.hasMore;
    } while (more);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "Event log unavailable";
  } finally { loading.value = false; }
}
onMounted(() => { void load(); timer = setInterval(() => void load(), 1_000); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <section class="event-log" aria-label="Chronological phase events">
    <header><h3>Events ({{ phaseEvents.length }})</h3><span>chronological · canonical timestamps</span></header>
    <p v-if="error" role="alert" class="empty-note">{{ error }}</p>
    <div v-if="!phaseEvents.length && !loading" class="empty-note">No events recorded for this phase.</div>
    <article v-for="event in phaseEvents" :key="event.id" class="event-row" :class="`event-${event.type}`">
      <button type="button" :aria-expanded="expanded.has(event.id)" @click="toggle(event.id)">
        <time>{{ new Date(event.startedAt).toLocaleTimeString([], { hour12: false }) }}</time>
        <strong>{{ event.type }}</strong>
        <span :title="summary(event)">{{ summary(event) }}</span>
        <em>{{ event.status ?? "recorded" }}</em>
        <small>{{ formatDuration(event.startedAt, event.endedAt) }}</small>
      </button>
      <pre v-if="expanded.has(event.id)">{{ json(event.payload) }}</pre>
    </article>
  </section>
</template>
