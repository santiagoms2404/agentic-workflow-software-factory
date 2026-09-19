<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GroupsResponse, GroupTree } from "../../shared/types.ts";
import GroupDecisionTree from "../components/GroupDecisionTree.vue";
import GroupTreeGraph from "../components/GroupTreeGraph.vue";

const props = defineProps<{ groups: GroupsResponse; selected: string | null }>();

const tree = ref<GroupTree | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
/** The drawing answers "what came from what"; the reading answers "what did it say". */
const view = ref<"graph" | "reading">("graph");

const active = computed(() => props.groups.groups.find((summary) => summary.group === props.selected) ?? null);

watch(
  () => props.selected,
  async (group) => {
    tree.value = null;
    error.value = null;
    if (group === null) return;
    loading.value = true;
    try {
      const response = await fetch(`/api/v1/groups?group=${encodeURIComponent(group)}`);
      if (!response.ok) throw new Error(response.status === 404 ? "No planning journal exists for this group." : "Decision tree unavailable");
      const payload = await response.json() as GroupTree;
      if (payload.group !== group) throw new Error("Decision tree did not match the selected group");
      tree.value = payload;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "Decision tree unavailable";
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <main class="groups-route groups-shell">
    <div class="groups-rail">
      <header class="groups-head">
        <p class="eyebrow">read-only planning record</p>
        <h1>Driving sessions</h1>
      </header>
      <nav class="groups-list neu-well" aria-label="Driving sessions">
        <a
          v-for="summary in groups.groups"
          :key="summary.group"
          class="groups-list-item"
          :class="{ selected: summary.group === selected }"
          :aria-current="summary.group === selected ? 'page' : false"
          :href="`#/groups/${encodeURIComponent(summary.group)}`"
        >
          <span class="groups-list-title" :class="{ absent: summary.title === null }">
            {{ summary.title ?? "no ask recorded in this group" }}
          </span>
          <span class="groups-list-meta">
            <code>{{ summary.group }}</code>
            <span>{{ summary.counts.applied }} decided</span>
            <span>{{ summary.counts.notTaken }} not taken</span>
          </span>
        </a>
        <p v-if="!groups.groups.length" class="absent">No driving session has recorded an ask yet.</p>
        <p v-if="groups.unreadable.length" class="absent">
          Unreadable journals: {{ groups.unreadable.join(", ") }}
        </p>
      </nav>
    </div>

    <section class="groups-canvas neu-well" aria-live="polite">
      <div v-if="active" class="groups-canvas-head">
        <div>
          <p class="eyebrow">the original ask</p>
          <h2 :class="{ absent: active.title === null }">{{ active.title ?? "no ask recorded in this group" }}</h2>
        </div>
        <div class="groups-view-toggle" role="group" aria-label="View">
          <button type="button" class="session-filter-control" :class="{ selected: view === 'graph' }" @click="view = 'graph'">tree</button>
          <button type="button" class="session-filter-control" :class="{ selected: view === 'reading' }" @click="view = 'reading'">reading</button>
        </div>
      </div>
      <p v-if="!selected" class="absent">Choose a driving session to see how its ask became these tasks.</p>
      <p v-else-if="loading" class="absent">Reading the group journal…</p>
      <p v-else-if="error" class="absent">{{ error }}</p>
      <template v-else-if="tree">
        <GroupTreeGraph v-show="view === 'graph'" :tree="tree" />
        <GroupDecisionTree v-show="view === 'reading'" :tree="tree" />
      </template>
    </section>
  </main>
</template>
