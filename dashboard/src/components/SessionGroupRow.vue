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

    <div v-for="summary in visible" :key="summary.group" class="session-group-entry">
      <button
        type="button"
        class="session-group-toggle"
        :class="{ selected: expanded.includes(summary.group) }"
        :aria-expanded="expanded.includes(summary.group)"
        :aria-controls="`group-tree-${summary.group}`"
        @click="toggle(summary.group)"
      >
        <span class="session-group-title" :class="{ absent: summary.title === null }">
          {{ summary.title ?? "no ask recorded in this group" }}
        </span>
        <span class="session-group-meta">
          <code>{{ summary.group }}</code>
          <span>{{ summary.counts.applied }} decided</span>
          <span>{{ summary.counts.notTaken }} not taken</span>
          <span>{{ summary.counts.alternatives }} alternatives</span>
          <span v-if="summary.closed">closed</span>
        </span>
      </button>
      <div :id="`group-tree-${summary.group}`" class="session-group-panel" :hidden="!expanded.includes(summary.group)">
        <p v-if="loading.includes(summary.group)" class="absent">Reading the group journal…</p>
        <p v-else-if="errors[summary.group]" class="absent">{{ errors[summary.group] }}</p>
        <GroupDecisionTree v-else-if="trees[summary.group]" :tree="trees[summary.group]!" />
      </div>
    </div>

    <p v-if="unrecorded.length" class="session-group-unrecorded absent">
      No planning journal exists for {{ unrecorded.join(", ") }} — the driving session minted the id and recorded no ask under it.
    </p>
  </section>
</template>
