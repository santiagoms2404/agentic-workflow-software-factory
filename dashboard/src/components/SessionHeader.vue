<script setup lang="ts">
import { computed } from "vue";
import type { SessionDetailResponse } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost, formatDate, formatDuration, formatTokens, formatUsage, stateLabel, stateTone } from "../display.ts";
import StateRibbon from "./StateRibbon.vue";
const props = defineProps<{ session: SessionDetailResponse }>();
const runtimeEnd = computed(() => {
  if (props.session.endedAt) return props.session.endedAt;
  return ["RUNNING", "GATING", "REVIEWING", "LANDING"].includes(props.session.state)
    ? null
    : props.session.updatedAt;
});
</script>

<template>
  <header class="run-strip">
    <span class="run-request" :title="session.request">{{ session.request }}</span>
    <span class="state-chip" :class="stateTone(session.state)">{{ stateLabel(session.state) }}</span>
    <span class="run-start">started {{ formatDate(session.startedAt) }}</span>
    <span class="run-workflow">{{ session.workflowId }}</span>
    <span class="stat-chip" title="Cost and authority">{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} · {{ costAuthorityLabel(session.usage.costAuthority) }}</span>
    <span class="stat-chip" title="Wall-clock runtime">{{ formatDuration(session.startedAt, runtimeEnd) }}</span>
    <span class="stat-chip" title="Provider-reported total tokens">{{ formatUsage(session.usage) }} · {{ session.usage.usageAuthority }}</span>
    <span class="stat-chip" title="Cache-read tokens">cache {{ formatTokens(session.usage.cacheReadTokens) }}</span>
    <span class="stat-chip" title="Calls spent against host ceiling">calls {{ session.callsSpent }}/{{ session.callCeiling }}</span>
    <span v-if="session.usage.costPartial" class="partial-note">partial total</span>
    <span class="sha-line" :title="session.candidateSha ?? session.baseSha ?? 'No candidate SHA recorded'">
      candidate <code>{{ session.candidateSha ?? "not yet recorded" }}</code>
    </span>
    <details class="lifecycle-disclosure">
      <summary>Lifecycle audit · {{ stateLabel(session.state) }} · {{ session.transitions.length }} recorded transitions</summary>
      <StateRibbon :state="session.state" :transitions="session.transitions" />
    </details>
  </header>
</template>
