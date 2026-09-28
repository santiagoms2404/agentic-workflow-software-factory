<script setup lang="ts">
import { computed } from "vue";
import {
  selectAllState,
  toggleAllFilterValues,
  toggleFilterValue,
  type SessionFilterEntry,
} from "../session-filters.ts";

const props = withDefaults(defineProps<{
  filterId: string;
  label: string;
  entries: readonly SessionFilterEntry[];
  selected: readonly string[];
  /** What a count counts; an empty string prints the number alone. */
  countUnit?: string;
  /** The select-all control's text, when it should say something other than the sessions board does. */
  selectAllLabel?: string;
}>(), { countUnit: "runs", selectAllLabel: "select all visible" });
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
        {{ selectAllLabel }}
      </button>
    </div>
    <div class="session-filter-options" role="group" :aria-label="`${label} choices`">
      <button
        v-for="(entry, index) in entries"
        :key="entry.value"
        type="button"
        class="session-filter-option"
        :class="{ selected: selected.includes(entry.value) }"
        :style="{ '--rung': index }"
        :aria-pressed="selected.includes(entry.value)"
        @click="emit('update:selected', toggleFilterValue(selected, entry.value))"
      >
        <span class="session-filter-label"><slot name="marker" :entry="entry" />{{ entry.label ?? entry.value }}</span>
        <span class="session-filter-count">{{ countUnit ? `${entry.count} ${countUnit}` : entry.count }}</span>
      </button>
    </div>
  </section>
</template>
