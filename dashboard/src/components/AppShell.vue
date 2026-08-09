<script setup lang="ts">
import type { HealthResponse } from "../../shared/types.ts";
import DegradedObservabilityBanner from "./DegradedObservabilityBanner.vue";
import LiveIndicator from "./LiveIndicator.vue";
import TopNav from "./TopNav.vue";
defineProps<{ health: HealthResponse | null; lastPollAt: number | null; pollMs: number }>();
</script>
<template><main class="app-shell"><TopNav :project="health?.project ?? 'AWSF'"><LiveIndicator :last-poll-at="lastPollAt" :poll-ms="pollMs" /></TopNav><DegradedObservabilityBanner :degraded-sessions="health?.degradedSessions ?? 0" /><slot /></main></template>
