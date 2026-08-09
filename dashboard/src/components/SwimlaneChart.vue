<script setup lang="ts">
import { computed } from "vue";
import type { AgentSummary, PhaseSummary, SessionDetailResponse } from "../../shared/types.ts";
const props = defineProps<{ session: SessionDetailResponse }>();
const start = computed(() => Date.parse(props.session.startedAt));
const end = computed(() => Date.parse(props.session.endedAt ?? new Date().toISOString()));
const duration = computed(() => Math.max(1, end.value - start.value));
const lanes = computed(() => [...props.session.agents.map((agent) => ({ key: agent.agent, label: agent.agent, color: agent.color ?? "var(--agent-planner)", agent })), { key: "code", label: "code / git", color: "var(--agent-code)", agent: null }, { key: "engineer", label: "engineer", color: "var(--agent-engineer)", agent: null }]);
function laneFor(phase: PhaseSummary) { return phase.kind === "code" || phase.kind === "engineer" ? phase.kind : phase.owner; }
function phasesFor(key: string) { return props.session.phases.filter((phase) => laneFor(phase) === key); }
function offset(phase: PhaseSummary) { return `${Math.max(0, ((Date.parse(phase.startedAt ?? phase.createdAt) - start.value) / duration.value) * 100)}%`; }
function width(phase: PhaseSummary) { const begun = Date.parse(phase.startedAt ?? phase.createdAt); const finished = Date.parse(phase.endedAt ?? new Date().toISOString()); return `${Math.max(4, Math.min(100, ((finished - begun) / duration.value) * 100))}%`; }
function calls(agent: AgentSummary | null) { return Math.min(8, agent?.callCount ?? 0); }
</script>
<template><section class="swimlane-chart"><div class="chart-title"><h2>Execution timeline</h2><span>0s → {{ Math.round(duration / 1000) }}s</span></div><div v-for="lane in lanes" :key="lane.key" class="swimlane"><div class="lane-label"><i :style="{ background: lane.color }" />{{ lane.label }}<span v-if="lane.agent" class="tool-sparkline" :aria-label="`${calls(lane.agent)} tool calls`"><b v-for="n in calls(lane.agent)" :key="n" :style="{ height: `${4 + (n % 4) * 3}px` }" /></span></div><div class="lane-track"><article v-for="phase in phasesFor(lane.key)" :key="phase.phaseId" class="phase-block" :style="{ left: offset(phase), width: width(phase), background: lane.color }" :title="`${phase.name}: ${phase.description}`"><strong>{{ phase.description }}</strong><small>{{ phase.status }}</small></article><span v-if="lane.key === 'code' && session.candidateSha" class="commit-pill" title="Exact candidate SHA">commit {{ session.candidateSha }}</span><div v-if="lane.key === 'engineer' && session.gates.length" class="gate-cluster" aria-label="Gate results"><span v-for="gate in session.gates" :key="gate.id" :class="gate.passed ? 'pass' : 'fail'">{{ gate.passed ? 'PASS' : 'FAIL' }} {{ gate.gateId }}</span></div></div></div></section></template>
