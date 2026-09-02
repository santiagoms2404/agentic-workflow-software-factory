<script setup lang="ts">
import { computed } from "vue";
import type { BacklogPlan } from "../../shared/types.ts";
import {
  selectAllState,
  toggleAllPlans,
  togglePlan,
  visiblePlans,
  type PlanFilter,
} from "../backlog-selection.ts";

const props = defineProps<{
  plans: readonly BacklogPlan[];
  selected: readonly string[];
  filter: PlanFilter;
}>();
const emit = defineEmits<{
  "update:selected": [selected: readonly string[]];
  "update:filter": [filter: PlanFilter];
}>();

const filters: readonly { value: PlanFilter; label: string }[] = [
  { value: "both", label: "all" },
  { value: "spine", label: "spine" },
  { value: "deep", label: "deep" },
];
const cards = computed(() => visiblePlans(props.plans, props.filter));
const allState = computed(() => selectAllState(props.plans, props.selected, props.filter));

function setFilter(filter: PlanFilter): void {
  emit("update:filter", filter);
}
</script>

<template>
  <section class="plan-picker" aria-label="Backlog plans">
    <div class="plan-controls">
      <label class="select-all-control">
        <input
          type="checkbox"
          :checked="allState === 'all'"
          :indeterminate="allState === 'some'"
          @change="emit('update:selected', toggleAllPlans(plans, selected, filter))"
        >
        select all visible
      </label>
      <fieldset>
        <legend>plan type</legend>
        <label v-for="option in filters" :key="option.value">
          <input
            type="radio"
            name="backlog-plan-filter"
            :value="option.value"
            :checked="filter === option.value"
            @change="setFilter(option.value)"
          >
          {{ option.label }}
        </label>
      </fieldset>
    </div>
    <div class="plan-card-row">
      <button
        v-for="plan in cards"
        :key="plan.id"
        type="button"
        class="plan-card"
        :class="{ selected: selected.includes(plan.id) }"
        :aria-pressed="selected.includes(plan.id)"
        @click="emit('update:selected', togglePlan(selected, plan.id))"
      >
        <span class="plan-card-heading">
          <strong>{{ plan.name }}</strong>
          <span class="plan-label">{{ plan.kind }}</span>
        </span>
        <span v-if="plan.kind === 'deep'" class="parent-spine-label">parent: {{ plan.parentSpineName ?? plan.parentSpine }}</span>
        <span class="plan-state-metrics" aria-label="Ticket state counts">
          <span><b>{{ plan.counts.done }}</b> done</span>
          <span><b>{{ plan.counts.wip }}</b> wip</span>
          <span><b>{{ plan.counts.failed }}</b> failed</span>
          <span><b>{{ plan.counts.todo }}</b> todo</span>
        </span>
      </button>
    </div>
  </section>
</template>
