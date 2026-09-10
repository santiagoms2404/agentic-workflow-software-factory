<script setup lang="ts">
import { computed } from "vue";
import type { SessionCard as Session } from "../../shared/types.ts";
import {
  filterSessions,
  stateFilterEntries,
  workflowFilterEntries,
} from "../session-filters.ts";
import { groupSessionStacks } from "../session-stacks.ts";
import SessionFilterRow from "./SessionFilterRow.vue";
import SessionStack from "./SessionStack.vue";

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
const visibleStacks = computed(() => groupSessionStacks(visibleSessions.value));
const workflowEntries = computed(() => workflowFilterEntries(
  props.workflows,
  props.sessions,
  props.selectedStates,
));
const stateEntries = computed(() => stateFilterEntries(props.sessions, props.selectedWorkflows));
</script>

<template>
  <section class="sessions-shell" aria-labelledby="sessions-title">
    <div class="run-count-tile">
      <p class="eyebrow">runs</p>
      <h1 id="sessions-title" class="run-count-headline">
        <strong>{{ visibleSessions.length }}</strong>
      </h1>
      <span>of {{ sessions.length }} total</span>
    </div>
    <SessionFilterRow
      class="session-filter-row workflow-rail"
      filter-id="workflow-filter"
      label="Workflow"
      :entries="workflowEntries"
      :selected="selectedWorkflows"
      @update:selected="emit('update:selectedWorkflows', $event)"
    />
    <SessionFilterRow
      class="session-filter-row lifecycle-ladder"
      filter-id="state-filter"
      label="Lifecycle state"
      :entries="stateEntries"
      :selected="selectedStates"
      @update:selected="emit('update:selectedStates', $event)"
    />
    <div v-if="visibleSessions.length" class="sessions-grid">
      <SessionStack v-for="stack in visibleStacks" :key="stack.key" :sessions="stack.sessions" />
    </div>
    <p v-else-if="sessions.length" class="empty-note">No runs match the current filters.</p>
    <p v-else class="empty-note">No sessions yet. Start an AWSF attempt in the terminal to see it here.</p>
  </section>
</template>
