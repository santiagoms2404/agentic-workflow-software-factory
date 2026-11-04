<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
const props = defineProps<{ lastPollAt: number | null; pollMs: number }>();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});
const live = computed(() => props.lastPollAt !== null && now.value - props.lastPollAt < 2 * props.pollMs);
</script>
<template><span class="live-indicator" :class="{ stale: !live }" role="status"><i aria-hidden="true" />{{ live ? "live" : "stale · reconnecting" }}</span></template>
