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

function moveFilter(event: KeyboardEvent, filter: PlanFilter): void {
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp"
    ? -1
    : event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : 0;
  if (direction === 0) return;
  event.preventDefault();
  const current = filters.findIndex((option) => option.value === filter);
  const next = (current + direction + filters.length) % filters.length;
  const nextFilter = filters[next];
  if (nextFilter === undefined) return;
  setFilter(nextFilter.value);
  const controls = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
  controls?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}
</script>

<template>
  <section class="plan-picker" aria-label="Backlog plans">
    <div class="plan-controls">
      <button
        type="button"
        class="plan-control-button select-all-control"
        :class="{ selected: allState === 'all', partial: allState === 'some' }"
        :aria-pressed="allState === 'some' ? 'mixed' : allState === 'all'"
        @click="emit('update:selected', toggleAllPlans(plans, selected, filter))"
      >
        select all visible
      </button>
      <div class="plan-type-controls" role="radiogroup" aria-label="Plan type">
        <span class="plan-control-label" aria-hidden="true">plan type</span>
        <button
          v-for="option in filters"
          :key="option.value"
          type="button"
          class="plan-control-button"
          :class="{ selected: filter === option.value }"
          role="radio"
          :aria-checked="filter === option.value"
          :tabindex="filter === option.value ? 0 : -1"
          @click="setFilter(option.value)"
          @keydown="moveFilter($event, option.value)"
        >
          {{ option.label }}
        </button>
      </div>
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
