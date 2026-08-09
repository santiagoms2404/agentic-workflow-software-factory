<script setup lang="ts">
import { computed } from "vue";
import type { AgentSummary, SessionCard as Session } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost, formatDuration, formatUsage, stateTone } from "../display.ts";
const props = defineProps<{ session: Session }>();
const visibleAgents = computed(() => props.session.agents.slice(0, 4));
const hiddenAgents = computed(() => Math.max(0, props.session.agents.length - visibleAgents.value.length));
const duration = computed(() => Math.max(1, (Date.parse(props.session.endedAt ?? new Date().toISOString()) - Date.parse(props.session.startedAt)) / 1000));
function agentColor(agent: AgentSummary, index: number) { return agent.color ?? ["var(--agent-planner)", "var(--agent-builder)", "var(--agent-reviewer)", "var(--agent-code)"][index % 4]!; }
function agentOffset(agent: AgentSummary) { return `${Math.min(90, Math.max(0, ((Date.parse(agent.createdAt) - Date.parse(props.session.startedAt)) / 1000 / duration.value) * 100))}%`; }
function agentWidth(agent: AgentSummary) { return `${Math.max(3, Math.min(90, ((Date.parse(agent.lastUsedAt) - Date.parse(agent.createdAt)) / 1000 / duration.value) * 100))}%`; }
</script>
<template>
  <article class="session-card">
    <div class="card-heading"><code>{{ session.sessionId.slice(0, 8) }}</code><span class="workflow">{{ session.workflowId }}</span></div>
    <p class="request">{{ session.request }}</p>
    <div class="time-ruler"><span>0s</span><span>{{ Math.round(duration / 3) }}s</span><span>{{ Math.round(duration * 2 / 3) }}s</span><span>{{ Math.round(duration) }}s</span></div>
    <div class="mini-timeline" aria-label="Agent timeline">
      <div v-for="(agent, index) in visibleAgents" :key="agent.agent" class="agent-lane"><span>{{ agent.agent }}</span><b :style="{ backgroundColor: agentColor(agent, index), left: agentOffset(agent), width: agentWidth(agent) }" /></div>
      <div v-if="hiddenAgents" class="more-agents">+{{ hiddenAgents }} more agents</div>
    </div>
    <div class="card-status"><span class="state-chip" :class="stateTone(session.state)">{{ session.state === "LANDED" ? "✓ success" : session.state }}</span><span class="phase-dots" :aria-label="`${session.phases.length} phases`"><i v-for="phase in session.phases" :key="phase.phaseId" :class="phase.status.toLowerCase()" /></span><span class="call-budget">calls {{ session.callsSpent }}/{{ session.callCeiling }}</span></div>
    <div class="metrics-row"><span>{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} <small>· {{ costAuthorityLabel(session.usage.costAuthority) }}</small></span><span>{{ formatDuration(session.startedAt, session.endedAt) }}</span><span>{{ formatUsage(session.usage) }}</span><em v-if="session.usage.costPartial">total: partial</em></div>
  </article>
</template>
