<script setup lang="ts">
import { computed } from "vue";
import type { GroupSummary } from "../../shared/types.ts";
import { groupsForRuns, unrecordedGroupIds } from "../group-tree.ts";

const props = defineProps<{
  summaries: readonly GroupSummary[];
  /** The group ids of the runs currently on the board, nulls included. */
  runGroupIds: readonly (string | null)[];
}>();

const visible = computed(() => groupsForRuns(props.summaries, props.runGroupIds));
const unrecorded = computed(() => unrecordedGroupIds(props.summaries, props.runGroupIds));
</script>

<template>
  <section v-if="visible.length || unrecorded.length" class="session-group-picker" aria-labelledby="session-groups-title">
    <div class="session-filter-heading">
      <h2 id="session-groups-title">Driving sessions</h2>
      <span class="session-group-note">the ask these runs came out of</span>
    </div>

    <!-- A title and a way in, not the tree itself. The tree has its own screen:
         a 72-stage group needs the width, and rendering it here made it share a
         viewport with the runs it produced. The run workspace below is never
         displaced, because nothing on this strip expands.

         The list scrolls past two rather than growing: this half shares one
         card with the plan menu, and a session that adds a group should not
         push the board further down the page every time. -->
    <div class="session-group-entries">
    <a
      v-for="heading in visible"
      :key="heading.summary.group"
      class="session-group-toggle"
      :href="`#/groups/${encodeURIComponent(heading.summary.group)}`"
    >
      <span class="session-group-title" :class="{ absent: heading.summary.title === null }">
        {{ heading.summary.title ?? "no ask recorded in this group" }}
      </span>
      <span class="session-group-meta">
        <code>{{ heading.summary.group }}</code>
        <span :class="{ absent: heading.runs === 0 }">
          {{ heading.runs === 0 ? "no runs on this board" : `${heading.runs} run(s) here` }}
        </span>
        <span>{{ heading.summary.counts.applied }} decided</span>
        <span>{{ heading.summary.counts.notTaken }} not taken</span>
        <span v-if="heading.summary.closed">closed</span>
        <span class="session-group-open">open the tree</span>
      </span>
    </a>
    </div>

    <p v-if="unrecorded.length" class="session-group-unrecorded absent">
      No planning journal exists for {{ unrecorded.join(", ") }} — the driving session minted the id and recorded no ask under it.
    </p>
  </section>
</template>
