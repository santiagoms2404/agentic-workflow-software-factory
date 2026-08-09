<script setup lang="ts">
import type { SessionDetailResponse } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost, formatUsage } from "../display.ts";
defineProps<{ session: SessionDetailResponse }>();
</script>
<template>
  <header class="session-header">
    <div><p class="eyebrow">{{ session.workflowId }} · attempt {{ session.attempt }}</p><h1>{{ session.request }}</h1><code>{{ session.sessionId }}</code></div>
    <dl class="session-totals"><div><dt>State</dt><dd><span class="state-word">{{ session.state }}</span></dd></div><div><dt>Usage</dt><dd>{{ formatUsage(session.usage) }}</dd></div><div><dt>Cost</dt><dd>{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} <small>{{ costAuthorityLabel(session.usage.costAuthority) }}</small></dd></div></dl>
    <p v-if="session.usage.costPartial" class="partial-note">Total is partial: one or more phase costs are unavailable.</p>
  </header>
</template>
