<script setup lang="ts">
import { computed } from "vue";
import type { GroupSummary, SessionCard as Session, SessionPlan } from "../../shared/types.ts";
import { unrecordedGroupIds } from "../group-tree.ts";
import { boardSections } from "../session-clusters.ts";
import {
  filterSessions,
  planKindFilterEntries,
  stateFilterEntries,
  workflowFilterEntries,
} from "../session-filters.ts";
import { groupFilterEntries, withGroupKey } from "../session-groups.ts";
import { planKindLabel, withPlanKind } from "../session-plans.ts";
import SessionBoardSection from "./SessionBoardSection.vue";
import SessionFilterRow from "./SessionFilterRow.vue";
import SessionGroupRow from "./SessionGroupRow.vue";
import SessionPlanRow from "./SessionPlanRow.vue";
import RunFailures from "./RunFailures.vue";

const props = defineProps<{
  sessions: readonly Session[];
  plans: readonly SessionPlan[];
  groups: readonly GroupSummary[];
  workflows: readonly string[];
  selectedWorkflows: readonly string[];
  selectedStates: readonly string[];
  selectedPlanKinds: readonly string[];
  selectedGroups: readonly string[];
}>();
const emit = defineEmits<{
  "update:selectedWorkflows": [selected: readonly string[]];
  "update:selectedStates": [selected: readonly string[]];
  "update:selectedPlanKinds": [selected: readonly string[]];
  "update:selectedGroups": [selected: readonly string[]];
}>();

// Bucketed once, here, so the plan cards, the plan-type counts and the rows on
// the board can never disagree about which plan a run belongs to. The driving
// session is annotated in the same pass and for the same reason.
const annotatedSessions = computed(() => withGroupKey(withPlanKind(props.sessions, props.plans)));
const visibleSessions = computed(() => filterSessions(
  annotatedSessions.value,
  props.selectedWorkflows,
  props.selectedStates,
  props.selectedPlanKinds,
  props.selectedGroups,
));
/**
 * Clusters are derived from every run the board holds, never from the filtered
 * set. A filtered-out run that was the only bridge between two sessions would
 * otherwise split the cluster silently; instead the section stays whole and
 * reports how many of its connecting runs are hidden.
 */
const sections = computed(() => boardSections(annotatedSessions.value, visibleSessions.value));
const summariesById = computed(() => new Map(props.groups.map((summary) => [summary.group, summary])));
const unrecorded = computed(() => unrecordedGroupIds(props.groups, props.sessions.map((session) => session.groupId)));

const workflowEntries = computed(() => workflowFilterEntries(
  props.workflows,
  annotatedSessions.value,
  props.selectedStates,
  props.selectedPlanKinds,
  props.selectedGroups,
));
const stateEntries = computed(() => stateFilterEntries(
  annotatedSessions.value,
  props.selectedWorkflows,
  props.selectedPlanKinds,
  props.selectedGroups,
));
const planKindEntries = computed(() => planKindFilterEntries(
  annotatedSessions.value,
  props.selectedWorkflows,
  props.selectedStates,
  props.selectedGroups,
).map((entry) => ({ ...entry, label: planKindLabel(entry.value as "spine" | "deep" | "unlinked") })));
const groupEntries = computed(() => groupFilterEntries(
  annotatedSessions.value,
  props.groups,
  props.selectedWorkflows,
  props.selectedStates,
  props.selectedPlanKinds,
));
</script>

<template>
  <section class="sessions-shell" aria-labelledby="sessions-title">
    <!-- The left rail: how many runs the board is showing, and the ladder that
         decides which. They travel together and they stay put, so the count
         always describes what is on screen at the moment you read it. -->
    <div class="session-rail">
      <div class="run-count-tile">
        <p class="eyebrow">runs</p>
        <h1 id="sessions-title" class="run-count-headline">
          <strong>{{ visibleSessions.length }}</strong>
        </h1>
        <span>of {{ sessions.length }} total</span>
      </div>
      <SessionFilterRow
        class="session-filter-row filter-ladder lifecycle-ladder"
        filter-id="state-filter"
        label="Lifecycle state"
        :entries="stateEntries"
        :selected="selectedStates"
        @update:selected="emit('update:selectedStates', $event)"
      />
    </div>
    <!-- The right rail, the same ladder at the other edge. Both filters come
         before the menus that describe the board, so a reader walking this
         screen with a keyboard meets everything that narrows it down first and
         then the board itself, rather than crossing back for one stray menu. -->
    <SessionFilterRow
      class="session-filter-row filter-ladder workflow-rail"
      filter-id="workflow-filter"
      label="Workflow"
      :entries="workflowEntries"
      :selected="selectedWorkflows"
      @update:selected="emit('update:selectedWorkflows', $event)"
    />
    <!-- One card, split in half: the ask these runs came out of on the left,
         the plan they belong to on the right. Two menus that each answered
         "which of these runs" cost two full-width wells and pushed the board
         off the first screen. The driving-session menu is the fourth filter
         and joins that card rather than taking a fifth well of its own. -->
    <section class="session-context">
      <SessionGroupRow
        :entries="groupEntries"
        :selected="selectedGroups"
        :unrecorded="unrecorded"
        @update:selected="emit('update:selectedGroups', $event)"
      />
      <SessionPlanRow
        :sessions="visibleSessions"
        :plans="plans"
        :entries="planKindEntries"
        :selected="selectedPlanKinds"
        @update:selected="emit('update:selectedPlanKinds', $event)"
      />
    </section>
    <!-- Above the board and below the menus, because it is about the runs on
         the board rather than a way of narrowing them. Closed until asked for:
         most visits here are not about failures. Fed from `sessions`, not from
         the filtered set — a failure hidden by a filter is still a failure,
         and this is the one place that says the factory fell over. -->
    <RunFailures class="run-failures-area" :sessions="sessions" />
    <div v-if="visibleSessions.length" class="sessions-grid">
      <SessionBoardSection
        v-for="section in sections"
        :key="section.key"
        :section="section"
        :summaries="summariesById"
      />
    </div>
    <p v-else-if="sessions.length" class="empty-note">No runs match the current filters.</p>
    <p v-else class="empty-note">No sessions yet. Start an AWSF attempt in the terminal to see it here.</p>
  </section>
</template>
