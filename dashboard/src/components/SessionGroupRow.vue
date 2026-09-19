<script setup lang="ts">
import { computed } from "vue";
import { selectAllState, toggleAllFilterValues, toggleFilterValue } from "../session-filters.ts";
import { groupFilterLabel, NO_DRIVING_SESSION, type GroupFilterEntry } from "../session-groups.ts";

const props = defineProps<{
  entries: readonly GroupFilterEntry[];
  selected: readonly string[];
  /** Group ids a run names that no planning journal recorded. */
  unrecorded: readonly string[];
}>();
const emit = defineEmits<{ "update:selected": [selected: readonly string[]] }>();

const entryValues = computed(() => props.entries.map((entry) => entry.value));
const allState = computed(() => selectAllState(entryValues.value, props.selected));
</script>

<template>
  <section class="session-group-picker" aria-labelledby="session-groups-title">
    <div class="session-filter-heading">
      <h2 id="session-groups-title">Driving sessions</h2>
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

    <!-- Selecting a session and opening its tree are two acts, so they are two
         controls. The pill filters the board; the link beside it leaves for the
         tree's own screen, because a 72-stage group needs the width and
         rendering it here made it share a viewport with the runs it produced.
         Nothing on this strip expands, so the run workspace below is never
         displaced.

         The list scrolls past two rather than growing: this half shares one
         card with the plan menu, and a session that adds a group should not
         push the board further down the page every time. -->
    <div class="session-group-entries" role="group" aria-label="Driving session choices">
      <div v-for="entry in entries" :key="entry.value" class="session-group-entry">
        <button
          type="button"
          class="session-group-toggle"
          :class="{ selected: selected.includes(entry.value) }"
          :aria-pressed="selected.includes(entry.value)"
          @click="emit('update:selected', toggleFilterValue(selected, entry.value))"
        >
          <span
            class="session-group-title"
            :class="{ absent: entry.summary === null || entry.summary.title === null }"
          >{{ groupFilterLabel(entry) }}</span>
          <span class="session-group-meta">
            <code v-if="entry.value !== NO_DRIVING_SESSION">{{ entry.value }}</code>
            <span :class="{ absent: entry.count === 0 }">
              {{ entry.count === 0 ? "no runs on this board" : `${entry.count} run(s) here` }}
            </span>
            <template v-if="entry.summary">
              <span>{{ entry.summary.counts.applied }} decided</span>
              <span>{{ entry.summary.counts.notTaken }} not taken</span>
              <span v-if="entry.summary.closed">closed</span>
            </template>
          </span>
        </button>
        <!-- Inside the pill, over its own top-right corner. Beside it, the row
             was wider than the strip and reaching the control meant scrolling
             the list sideways. A button cannot nest a link, so the two stay
             siblings and the link is placed over the corner it belongs to. -->
        <a
          v-if="entry.summary"
          class="session-group-open"
          :href="`#/groups/${encodeURIComponent(entry.summary.group)}`"
          :aria-label="`Open the decision tree for ${entry.summary.group}`"
          title="Open the decision tree"
        ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.7 10.3 10.3 5.7M6.3 5.7h4v4" /></svg></a>
      </div>
    </div>

    <p v-if="unrecorded.length" class="session-group-unrecorded absent">
      No planning journal exists for {{ unrecorded.join(", ") }} — the driving session minted the id and recorded no ask under it.
    </p>
  </section>
</template>
