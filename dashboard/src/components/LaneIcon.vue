<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ laneKey: string; agent?: string | null | undefined }>();
const kind = computed(() => {
  if (props.laneKey === "engineer") return "engineer";
  if (props.laneKey === "code") return "code";
  if (props.agent === "builder") return "builder";
  if (props.agent === "reviewer") return "reviewer";
  return "agent";
});
</script>

<template>
  <svg class="lane-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="kind === 'engineer'">
      <circle cx="7.5" cy="6.5" r="2.6" />
      <path d="M3.5 17.5v-1.4c0-2.7 1.8-4.6 4-4.6s4 1.9 4 4.6v1.4" />
      <path d="m13.5 16.5 1-3.6 5.1-5.1 2.2 2.2-5.1 5.1-3.2 1.4Z" />
      <path d="m18.3 9.1 2.2 2.2M3 20.5h14" />
    </template>
    <template v-else-if="kind === 'code'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 7.5c1 2.8 3.2 4.5 8 4.5" />
    </template>
    <template v-else-if="kind === 'builder'">
      <path d="m4 6 3-3 4.3 4.3-3 3L4 6Z" />
      <path d="m9.8 8.8 8.7 8.7M15.5 20.5h5v-5" />
      <path d="M3.5 15.5h6v5h-6z" />
    </template>
    <template v-else-if="kind === 'reviewer'">
      <circle cx="10" cy="10" r="6" />
      <path d="m14.4 14.4 5.1 5.1M7.2 10.1l2 2 3.8-4.2" />
    </template>
    <template v-else>
      <path d="m12 3 7 4v9l-7 4-7-4V7l7-4Z" />
      <circle cx="12" cy="9" r="2.2" />
      <path d="M8.5 16c.5-2 1.7-3 3.5-3s3 1 3.5 3" />
    </template>
  </svg>
</template>
