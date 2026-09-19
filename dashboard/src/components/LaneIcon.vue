<script setup lang="ts">
import { computed } from "vue";

/**
 * One drawing language for every lane: circles for nodes, strokes for the paths
 * between them. code/git already read that way, so the rest are built to match
 * it rather than as literal objects (a hammer, a magnifier) at 22px.
 */
const AGENT_KINDS = new Set([
  "builder",
  "reviewer",
  "planner",
  "architect",
  "architecture-reviewer",
  "documenter",
  "scout",
  "designer",
  "intake",
]);

const props = defineProps<{ laneKey: string; agent?: string | null | undefined }>();
const kind = computed(() => {
  if (props.laneKey === "engineer") return "engineer";
  if (props.laneKey === "code") return "code";
  const agent = props.agent ?? "";
  if (AGENT_KINDS.has(agent)) return agent;
  return "agent";
});
</script>

<template>
  <svg class="lane-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <!-- engineer: the origin node, emitting down onto the baseline. -->
    <template v-if="kind === 'engineer'">
      <circle cx="12" cy="5.6" r="2.8" />
      <path d="M12 8.4v7.1" />
      <path d="m8.8 12.4 3.2 3.2 3.2-3.2" />
      <path d="M4.5 19.6h15" />
    </template>

    <!-- code / git: unchanged. -->
    <template v-else-if="kind === 'code'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 7.5c1 2.8 3.2 4.5 8 4.5" />
    </template>

    <!-- builder: two nodes converging into one. -->
    <template v-else-if="kind === 'builder'">
      <circle cx="5.4" cy="6.2" r="2.2" />
      <circle cx="5.4" cy="17.8" r="2.2" />
      <circle cx="17.6" cy="12" r="3" />
      <path d="m7.5 7.4 7.1 3.4M7.5 16.6l7.1-3.4" />
    </template>

    <!-- reviewer: a node on the path, with the verdict struck beneath it. -->
    <template v-else-if="kind === 'reviewer'">
      <circle cx="12" cy="6.8" r="2.8" />
      <path d="M3.8 6.8h5.4M14.8 6.8h5.4" />
      <path d="m7.4 15.4 3 3.2 6.2-7" />
    </template>

    <!-- planner: one node decomposing into an ordered three. -->
    <template v-else-if="kind === 'planner'">
      <circle cx="5" cy="12" r="2.4" />
      <circle cx="18.6" cy="5.6" r="1.9" />
      <circle cx="18.6" cy="12" r="1.9" />
      <circle cx="18.6" cy="18.4" r="1.9" />
      <path d="m7.3 11 9.3-4.6M7.4 12h9.3m-9.3 1 9.3 4.6" />
    </template>

    <!-- architect: a braced lattice standing on its base. -->
    <template v-else-if="kind === 'architect'">
      <circle cx="12" cy="5.4" r="2.1" />
      <circle cx="5.6" cy="14.4" r="2.1" />
      <circle cx="18.4" cy="14.4" r="2.1" />
      <path d="m10.6 7.2-3.4 5m6.2-5 3.4 5M7.7 14.4h8.6" />
      <path d="M3.5 19.6h17" />
    </template>

    <!-- architecture-reviewer: that structure, judged. -->
    <template v-else-if="kind === 'architecture-reviewer'">
      <circle cx="9.4" cy="4.9" r="1.9" />
      <circle cx="4.6" cy="12.6" r="1.9" />
      <circle cx="14.2" cy="12.6" r="1.9" />
      <path d="M8.4 6.5 5.6 11m4.8-4.5 2.8 4.5M6.5 12.6h5.8" />
      <path d="m13.4 17.2 2.2 2.4 4.9-5.6" />
    </template>

    <!-- documenter: a node feeding a spine that emits the record. -->
    <template v-else-if="kind === 'documenter'">
      <circle cx="4.9" cy="12" r="2.4" />
      <path d="M7.3 12h2.2" />
      <path d="M9.5 7.3v9.4" />
      <path d="M9.5 7.3h10M9.5 12h10M9.5 16.7h6.4" />
    </template>

    <!-- scout: a node probing outward. -->
    <template v-else-if="kind === 'scout'">
      <circle cx="6.4" cy="17.6" r="2.6" />
      <path d="M6.4 12.6a5 5 0 0 1 5 5" stroke-dasharray="2.4 2.4" />
      <path d="M6.4 7.6a10 10 0 0 1 10 10" stroke-dasharray="2.4 2.4" />
    </template>

    <!-- designer: a curve and the nodes that shape it. -->
    <template v-else-if="kind === 'designer'">
      <path d="M4.6 17.6C4.6 9.4 19.4 15.6 19.4 6.6" />
      <circle cx="4.6" cy="17.6" r="1.9" />
      <circle cx="19.4" cy="6.6" r="1.9" />
      <circle cx="10.4" cy="10.2" r="1.3" />
      <circle cx="13.6" cy="14" r="1.3" />
    </template>

    <!-- intake: entry into the queue. -->
    <template v-else-if="kind === 'intake'">
      <path d="M14.6 4.6h4.8v14.8h-4.8" />
      <path d="M3.6 12h10.6" />
      <path d="m10.6 8.4 3.6 3.6-3.6 3.6" />
    </template>

    <!-- unnamed agent. -->
    <template v-else>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.6" stroke-dasharray="2.6 2.6" />
    </template>
  </svg>
</template>
