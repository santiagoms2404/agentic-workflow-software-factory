<script setup lang="ts">
import { computed } from "vue";
import type { SessionCard as Session } from "../../shared/types.ts";
import {
  filterSessions,
  stateFilterEntries,
  workflowFilterEntries,
} from "../session-filters.ts";
import SessionCard from "./SessionCard.vue";
import SessionFilterRow from "./SessionFilterRow.vue";

const props = defineProps<{
  sessions: readonly Session[];
  workflows: readonly string[];
  selectedWorkflows: readonly string[];
  selectedStates: readonly string[];
}>();
const emit = defineEmits<{
  "update:selectedWorkflows": [selected: readonly string[]];
  "update:selectedStates": [selected: readonly string[]];
}>();

const visibleSessions = computed(() => filterSessions(
  props.sessions,
  props.selectedWorkflows,
  props.selectedStates,
));
const workflowEntries = computed(() => workflowFilterEntries(
  props.workflows,
  props.sessions,
  props.selectedStates,
));
const stateEntries = computed(() => stateFilterEntries(props.sessions, props.selectedWorkflows));
</script>

<template>
  <section aria-labelledby="sessions-title">
    <h1 id="sessions-title" class="run-count">{{ visibleSessions.length }} of {{ sessions.length }} runs</h1>
    <div class="session-filters" aria-label="Session filters">
      <SessionFilterRow
        filter-id="workflow-filter"
        label="Workflow"
        :entries="workflowEntries"
        :selected="selectedWorkflows"
        @update:selected="emit('update:selectedWorkflows', $event)"
      />
      <SessionFilterRow
        filter-id="state-filter"
        label="Lifecycle state"
        :entries="stateEntries"
        :selected="selectedStates"
        @update:selected="emit('update:selectedStates', $event)"
      />
    </div>
    <div v-if="visibleSessions.length" class="sessions-grid">
      <SessionCard v-for="session in visibleSessions" :key="session.sessionId" :session="session" />
    </div>
    <p v-else-if="sessions.length" class="empty-note run-count">No runs match the current filters.</p>
    <p v-else class="empty-note run-count">No sessions yet. Start an AWSF attempt in the terminal to see it here.</p>
  </section>
</template>
