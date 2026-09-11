<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { GroupSummary, GroupTree } from "../../shared/types.ts";
import { groupsForRuns, unrecordedGroupIds } from "../group-tree.ts";
import GroupDecisionTree from "./GroupDecisionTree.vue";

const props = defineProps<{
  summaries: readonly GroupSummary[];
  /** The group ids of the runs currently on the board, nulls included. */
  runGroupIds: readonly (string | null)[];
}>();

const expanded = ref<readonly string[]>([]);
const trees = ref<Readonly<Record<string, GroupTree>>>({});
const loading = ref<readonly string[]>([]);
const errors = ref<Readonly<Record<string, string>>>({});

const visible = computed(() => groupsForRuns(props.summaries, props.runGroupIds));
const unrecorded = computed(() => unrecordedGroupIds(props.summaries, props.runGroupIds));

/**
 * Expanding must not move the reader or the board.
 *
 * The panel opens BELOW its own toggle, so nothing above the viewport changes
 * height and the page does not jump; collapsing can shorten the document under
 * a scrolled viewport, so the offset is restored explicitly. The button keeps
 * focus either way, and the run workspace below is a sibling that is never
 * unmounted by this toggle.
 */
async function toggle(group: string): Promise<void> {
  const offset = window.scrollY;
  expanded.value = expanded.value.includes(group)
    ? expanded.value.filter((id) => id !== group)
    : [...expanded.value, group];
  await nextTick();
  window.scrollTo({ top: offset, behavior: "auto" });
  if (!expanded.value.includes(group)) return;
  if (trees.value[group] !== undefined || loading.value.includes(group)) return;
  loading.value = [...loading.value, group];
  const { [group]: _priorError, ...remaining } = errors.value;
  errors.value = remaining;
  try {
    const response = await fetch(`/api/v1/groups?group=${encodeURIComponent(group)}`);
    if (!response.ok) throw new Error("Decision tree unavailable");
    const payload = await response.json() as GroupTree;
    if (payload.group !== group) throw new Error("Decision tree did not match the selected group");
    trees.value = { ...trees.value, [group]: payload };
  } catch (error) {
    errors.value = { ...errors.value, [group]: error instanceof Error ? error.message : "Decision tree unavailable" };
  } finally {
    loading.value = loading.value.filter((id) => id !== group);
  }
}
</script>

<template>
  <section v-if="visible.length || unrecorded.length" class="session-group-picker" aria-labelledby="session-groups-title">
    <div class="session-filter-heading">
      <h2 id="session-groups-title">Driving sessions</h2>
      <span class="session-group-note">the ask these runs came out of</span>
    </div>

    <div v-for="heading in visible" :key="heading.summary.group" class="session-group-entry">
      <button
        type="button"
        class="session-group-toggle"
        :class="{ selected: expanded.includes(heading.summary.group) }"
        :aria-expanded="expanded.includes(heading.summary.group)"
        :aria-controls="`group-tree-${heading.summary.group}`"
        @click="toggle(heading.summary.group)"
      >
        <span class="session-group-title" :class="{ absent: heading.summary.title === null }">
          {{ heading.summary.title ?? "no ask recorded in this group" }}
        </span>
        <span class="session-group-meta">
          <code>{{ heading.summary.group }}</code>
          <!-- Said plainly rather than omitted: a group whose runs predate
               `--group` has none on this board and never will, and a heading
               that hid that would read as a session that produced nothing. -->
          <span :class="{ absent: heading.runs === 0 }">
            {{ heading.runs === 0 ? "no runs on this board" : `${heading.runs} run(s) here` }}
          </span>
          <span>{{ heading.summary.counts.applied }} decided</span>
          <span>{{ heading.summary.counts.notTaken }} not taken</span>
          <span>{{ heading.summary.counts.alternatives }} alternatives</span>
          <span v-if="heading.summary.closed">closed</span>
        </span>
      </button>
      <div :id="`group-tree-${heading.summary.group}`" class="session-group-panel" :hidden="!expanded.includes(heading.summary.group)">
        <p v-if="loading.includes(heading.summary.group)" class="absent">Reading the group journal…</p>
        <p v-else-if="errors[heading.summary.group]" class="absent">{{ errors[heading.summary.group] }}</p>
        <GroupDecisionTree v-else-if="trees[heading.summary.group]" :tree="trees[heading.summary.group]!" />
      </div>
    </div>

    <p v-if="unrecorded.length" class="session-group-unrecorded absent">
      No planning journal exists for {{ unrecorded.join(", ") }} — the driving session minted the id and recorded no ask under it.
    </p>
  </section>
</template>
