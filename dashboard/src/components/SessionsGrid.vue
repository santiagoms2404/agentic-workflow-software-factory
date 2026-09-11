<script setup lang="ts">
import { computed } from "vue";
import type { GroupSummary, SessionCard as Session, SessionPlan } from "../../shared/types.ts";
import {
  filterSessions,
  planKindFilterEntries,
  stateFilterEntries,
  workflowFilterEntries,
} from "../session-filters.ts";
import { planKindLabel, withPlanKind } from "../session-plans.ts";
import { groupSessionStacks } from "../session-stacks.ts";
import SessionFilterRow from "./SessionFilterRow.vue";
import SessionGroupRow from "./SessionGroupRow.vue";
import SessionPlanRow from "./SessionPlanRow.vue";
import SessionStack from "./SessionStack.vue";

const props = defineProps<{
  sessions: readonly Session[];
  plans: readonly SessionPlan[];
  groups: readonly GroupSummary[];
  workflows: readonly string[];
  selectedWorkflows: readonly string[];
  selectedStates: readonly string[];
  selectedPlanKinds: readonly string[];
}>();
const emit = defineEmits<{
  "update:selectedWorkflows": [selected: readonly string[]];
  "update:selectedStates": [selected: readonly string[]];
  "update:selectedPlanKinds": [selected: readonly string[]];
}>();

// Bucketed once, here, so the plan cards, the plan-type counts and the rows on
// the board can never disagree about which plan a run belongs to.
const plannedSessions = computed(() => withPlanKind(props.sessions, props.plans));
const visibleSessions = computed(() => filterSessions(
  plannedSessions.value,
  props.selectedWorkflows,
  props.selectedStates,
  props.selectedPlanKinds,
));
const visibleStacks = computed(() => groupSessionStacks(visibleSessions.value));
const workflowEntries = computed(() => workflowFilterEntries(
  props.workflows,
  plannedSessions.value,
  props.selectedStates,
  props.selectedPlanKinds,
));
const stateEntries = computed(() => stateFilterEntries(
  plannedSessions.value,
  props.selectedWorkflows,
  props.selectedPlanKinds,
));
const planKindEntries = computed(() => planKindFilterEntries(
  plannedSessions.value,
  props.selectedWorkflows,
  props.selectedStates,
).map((entry) => ({ ...entry, label: planKindLabel(entry.value as "spine" | "deep" | "unlinked") })));
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
    <SessionGroupRow :summaries="groups" :run-group-ids="visibleSessions.map((session) => session.groupId)" />
    <SessionPlanRow
      :sessions="visibleSessions"
      :plans="plans"
      :entries="planKindEntries"
      :selected="selectedPlanKinds"
      @update:selected="emit('update:selectedPlanKinds', $event)"
    />
    <div v-if="visibleSessions.length" class="sessions-grid">
      <SessionStack v-for="stack in visibleStacks" :key="stack.key" :sessions="stack.sessions" />
    </div>
    <p v-else-if="sessions.length" class="empty-note">No runs match the current filters.</p>
    <p v-else class="empty-note">No sessions yet. Start an AWSF attempt in the terminal to see it here.</p>
  </section>
</template>
