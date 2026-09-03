<script setup lang="ts">
import { computed } from "vue";
import {
  selectAllState,
  toggleAllFilterValues,
  toggleFilterValue,
  type SessionFilterEntry,
} from "../session-filters.ts";

const props = defineProps<{
  filterId: string;
  label: string;
  entries: readonly SessionFilterEntry[];
  selected: readonly string[];
}>();
const emit = defineEmits<{
  "update:selected": [selected: readonly string[]];
}>();

const entryValues = computed(() => props.entries.map((entry) => entry.value));
const allState = computed(() => selectAllState(entryValues.value, props.selected));
</script>

<template>
  <section class="session-filter-row" :aria-labelledby="`${filterId}-title`">
    <div class="session-filter-heading">
      <h2 :id="`${filterId}-title`">{{ label }}</h2>
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
    <div class="session-filter-options" role="group" :aria-label="`${label} choices`">
      <button
        v-for="entry in entries"
        :key="entry.value"
        type="button"
        class="session-filter-option"
        :class="{ selected: selected.includes(entry.value) }"
        :aria-pressed="selected.includes(entry.value)"
        @click="emit('update:selected', toggleFilterValue(selected, entry.value))"
      >
        <span>{{ entry.value }}</span>
        <span class="session-filter-count">{{ entry.count }} runs</span>
      </button>
    </div>
  </section>
</template>
