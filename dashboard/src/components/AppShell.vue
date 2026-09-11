<script setup lang="ts">
import type { HealthResponse } from "../../shared/types.ts";
import DegradedObservabilityBanner from "./DegradedObservabilityBanner.vue";
import LiveIndicator from "./LiveIndicator.vue";
import TopNav from "./TopNav.vue";
defineProps<{
  health: HealthResponse | null;
  lastPollAt: number | null;
  pollMs: number;
  sessionId: string | null;
  phaseName: string | null;
  settings: boolean;
  backlog: boolean;
  groups: boolean;
}>();
</script>
<template>
  <div class="app-shell">
    <TopNav :project="health?.project ?? 'AWSF'" :session-id="sessionId" :phase-name="phaseName" :settings="settings" :backlog="backlog" :groups="groups">
      <LiveIndicator :last-poll-at="lastPollAt" :poll-ms="pollMs" />
    </TopNav>
    <DegradedObservabilityBanner :degraded-sessions="health?.degradedSessions ?? 0" />
    <slot />
  </div>
</template>
