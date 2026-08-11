<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ lastPollAt: number | null; pollMs: number }>();
const live = computed(() => props.lastPollAt !== null && Date.now() - props.lastPollAt < 2 * props.pollMs);
</script>
<template><span class="live-indicator" :class="{ stale: !live }" role="status"><i aria-hidden="true" />{{ live ? "live" : "stale · reconnecting" }}</span></template>
