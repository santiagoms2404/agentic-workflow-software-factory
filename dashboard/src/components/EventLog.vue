<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { EventItem, EventsResponse } from "../../shared/types.ts";
import { formatDuration } from "../display.ts";
const props = defineProps<{ sessionId: string }>();
const events = ref<EventItem[]>([]); const cursor = ref(0); const hasMore = ref(false); const loading = ref(false); const error = ref<string | null>(null);
function command(item: EventItem): string {
  if (!item.payload || typeof item.payload !== "object") return item.name;
  const value = item.payload as Record<string, unknown>;
  for (const key of ["command", "path", "tool", "file"]) if (typeof value[key] === "string") return value[key] as string;
  return item.name;
}
async function load() { loading.value = true; error.value = null; try { const response = await fetch(`/api/v1/sessions/${encodeURIComponent(props.sessionId)}/events?after=${cursor.value}`); if (!response.ok) throw new Error("Event log unavailable"); const page = await response.json() as EventsResponse; events.value.push(...page.events); cursor.value = page.cursor; hasMore.value = page.hasMore; } catch (reason) { error.value = reason instanceof Error ? reason.message : "Event log unavailable"; } finally { loading.value = false; } }
onMounted(() => void load());
</script>
<template><section class="event-log" aria-label="Event log"><header><h3>Events ({{ events.length }})</h3><button v-if="hasMore" type="button" :disabled="loading" @click="load">{{ loading ? "Loading…" : "Load earlier events" }}</button></header><p v-if="error" role="alert" class="empty-note">{{ error }}</p><ol><li v-for="event in events" :key="event.id" :class="`event-${event.type}`"><time>{{ new Date(event.startedAt).toLocaleTimeString() }}</time><strong>{{ event.type }}</strong><span>{{ command(event) }}</span><em>{{ formatDuration(event.startedAt, event.endedAt) }}</em></li></ol><p v-if="!events.length && !loading" class="empty-note">No events recorded.</p></section></template>
