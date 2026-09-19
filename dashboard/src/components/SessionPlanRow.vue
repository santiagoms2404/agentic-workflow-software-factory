<script setup lang="ts">
import { computed } from "vue";
import type { SessionCard as Session, SessionPlan } from "../../shared/types.ts";
import {
  selectAllState,
  toggleAllFilterValues,
  toggleFilterValue,
  type SessionFilterEntry,
} from "../session-filters.ts";
import { sessionPlanCards, type PlanRunCost } from "../session-plans.ts";

const props = defineProps<{
  /** Already filtered: a card's run count is a count of the rows on the board. */
  sessions: readonly Session[];
  plans: readonly SessionPlan[];
  entries: readonly SessionFilterEntry[];
  selected: readonly string[];
}>();
const emit = defineEmits<{
  "update:selected": [selected: readonly string[]];
}>();

const entryValues = computed(() => props.entries.map((entry) => entry.value));
const allState = computed(() => selectAllState(entryValues.value, props.selected));
const cards = computed(() => sessionPlanCards(props.sessions, props.plans));

/**
 * A total is shown only when every run behind it reported a cost from one
 * authority. Anything else reads "unknown" rather than summing the rows that
 * happened to have a number into a confident wrong one.
 */
function costLabel(cost: PlanRunCost): string {
  return cost.usd === null || cost.partial ? "unknown" : `$${cost.usd.toFixed(2)}`;
}
</script>

<template>
  <section class="session-plan-picker" aria-labelledby="session-plan-filter-title">
    <div class="session-filter-heading">
      <h2 id="session-plan-filter-title">Plan</h2>
      <button
        type="button"
        class="session-filter-control session-filter-select-all"
        :class="{ selected: allState === 'all', partial: allState === 'some' }"
        :aria-pressed="allState === 'some' ? 'mixed' : allState === 'all'"
        @click="emit('update:selected', toggleAllFilterValues(entryValues, selected))"
      >
        select all visible
      </button>
    </div>
    <div class="session-filter-options" role="group" aria-label="Plan type choices">
      <button
        v-for="entry in entries"
        :key="entry.value"
        type="button"
        class="session-filter-option"
        :class="{ selected: selected.includes(entry.value) }"
        :aria-pressed="selected.includes(entry.value)"
        @click="emit('update:selected', toggleFilterValue(selected, entry.value))"
      >
        <span>{{ entry.label ?? entry.value }}</span>
        <span class="session-filter-count">{{ entry.count }} runs</span>
      </button>
    </div>
    <div v-if="cards.length" class="plan-card-row">
      <a
        v-for="card in cards"
        :key="card.plan.id"
        class="plan-card session-plan-card"
        :href="`#/backlog/${encodeURIComponent(card.plan.id)}`"
      >
        <span class="plan-card-heading">
          <strong>{{ card.plan.name }}</strong>
          <span class="plan-label">{{ card.plan.kind }}</span>
        </span>
        <span v-if="card.plan.parentSpine" class="parent-spine-label">parent: {{ card.plan.parentSpineName ?? card.plan.parentSpine }}</span>
        <span class="plan-state-metrics session-plan-metrics" aria-label="Run count and recorded cost">
          <span><b>{{ card.runs }}</b> runs</span>
          <span><b>{{ costLabel(card.cost) }}</b> cost</span>
        </span>
        <span class="session-plan-open">open backlog</span>
      </a>
    </div>
    <p v-else class="session-plan-empty">No visible run names a registered plan.</p>
  </section>
</template>
