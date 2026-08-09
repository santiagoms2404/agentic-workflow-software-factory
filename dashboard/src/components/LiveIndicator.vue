<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ lastPollAt: number | null; pollMs: number }>();
const live = computed(() => props.lastPollAt !== null && Date.now() - props.lastPollAt < 2 * props.pollMs);
</script>
<template><span class="live-indicator" :class="{ stale: !live }"><i />{{ live ? "live" : "reconnecting" }}</span></template>
