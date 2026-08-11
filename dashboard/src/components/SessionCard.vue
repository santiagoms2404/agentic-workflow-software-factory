<script setup lang="ts">
import { computed } from "vue";
import type { ActivityPoint, AgentSummary, PhaseSummary, SessionCard as Session } from "../../shared/types.ts";
import { axisTicks, costAuthorityLabel, formatCost, formatDate, formatDuration, formatUsage, stateLabel, stateTone } from "../display.ts";

const props = defineProps<{ session: Session }>();
const start = computed(() => Date.parse(props.session.startedAt));
const end = computed(() => Date.parse(props.session.endedAt ?? new Date().toISOString()));
const span = computed(() => Math.max(1_000, end.value - start.value));
const ticks = computed(() => axisTicks(span.value, 4));
const phaseById = computed(() => new Map(props.session.phases.map((phase) => [phase.phaseId, phase])));
const palette = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--amber)", "var(--violet)"];

interface CardLane { key: string; label: string; color: string; points: ActivityPoint[] }

const lanes = computed<CardLane[]>(() => {
  const ordered: string[] = [];
  const labels = new Map<string, string>();
  for (const phase of props.session.phases) {
    const key = phase.kind === "agent" ? `agent:${phase.owner}` : phase.kind;
    if (!ordered.includes(key)) ordered.push(key);
    labels.set(key, phase.kind === "code" ? "code / git" : phase.kind === "engineer" ? "engineer" : phase.owner);
  }
  return ordered.map((key, index) => {
    const owner = key.startsWith("agent:") ? key.slice(6) : null;
    const agent = owner === null ? undefined : props.session.agents.find((item) => item.agent === owner);
    const color = key === "code" ? "var(--green)" : key === "engineer" ? "var(--amber)" : agent?.color ?? palette[index % palette.length]!;
    const points = props.session.activity.filter((point) => {
      const phase = point.phaseId === null ? undefined : phaseById.value.get(point.phaseId);
      if (!phase) return false;
      return (phase.kind === "agent" ? `agent:${phase.owner}` : phase.kind) === key;
    });
    return { key, label: labels.get(key) ?? key, color, points };
  });
});
const overflowing = computed(() => lanes.value.length > 4);
const visibleLanes = computed(() => overflowing.value ? lanes.value.slice(0, 3) : lanes.value.slice(0, 4));
const hiddenCount = computed(() => Math.max(0, lanes.value.length - visibleLanes.value.length));

function pointLeft(point: ActivityPoint): string {
  const at = Date.parse(point.startedAt);
  return `${Math.max(0, Math.min(100, ((at - start.value) / span.value) * 100))}%`;
}
function pointColor(point: ActivityPoint, lane: CardLane): string {
  if (point.status === "FAILED" || point.status === "error" || point.type === "run.failed") return "var(--red)";
  if (point.type === "tool_call") return "var(--cyan)";
  if (point.type === "phase_end" || point.type === "run.completed") return "var(--green)";
  return lane.color;
}
function phaseGlyph(phase: PhaseSummary): string {
  if (phase.status === "SUCCEEDED") return "●";
  if (["FAILED", "CANCELLED"].includes(phase.status)) return "×";
  if (["RUNNING", "VALIDATING", "CORRECTING"].includes(phase.status)) return "◐";
  return "○";
}
</script>

<template>
  <a class="session-card" :class="stateTone(session.state)" :href="`#/sessions/${session.sessionId}`">
    <span class="card-id">{{ session.sessionId.slice(0, 8) }}</span>
    <span class="card-workflow" :title="session.workflowId">{{ session.workflowId }}</span>
    <span class="card-request" :title="session.request">{{ session.request }}</span>

    <div v-if="lanes.length" class="mini-timeline" aria-label="Bounded real activity timeline">
      <div class="mini-axis">
        <span class="mini-gutter" />
        <span class="mini-track">
          <span v-for="tick in ticks" :key="tick.percent" class="mini-tick" :style="{ left: `${tick.percent}%` }">{{ tick.label }}</span>
        </span>
      </div>
      <div v-for="lane in visibleLanes" :key="lane.key" class="mini-row">
        <span class="mini-agent" :style="{ color: lane.color }" :title="lane.label">{{ lane.label }}</span>
        <span class="mini-track">
          <i
            v-for="point in lane.points"
            :key="point.id"
            class="activity-dot"
            :style="{ left: pointLeft(point), background: pointColor(point, lane) }"
            :title="`${point.type} · ${point.status ?? 'status not recorded'} · ${point.startedAt}`"
          />
        </span>
      </div>
      <div v-if="hiddenCount" class="mini-more">+{{ hiddenCount }} more agents</div>
    </div>
    <div v-else class="mini-timeline mini-empty">No recorded activity yet</div>

    <div class="card-foot">
      <span class="state-chip" :class="stateTone(session.state)">{{ stateLabel(session.state) }}</span>
      <span class="phase-dots">
        <span
          v-for="phase in session.phases"
          :key="phase.phaseId"
          class="phase-dot"
          :class="phase.status.toLowerCase()"
          :title="`${phase.name} — ${phase.status}`"
          :aria-label="`${phase.name}: ${phase.status}`"
        ><span aria-hidden="true">{{ phaseGlyph(phase) }}</span></span>
      </span>
      <span class="started-date">{{ formatDate(session.startedAt) }}</span>
    </div>
    <div class="card-stats">
      <span title="Cost and authority">{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} <small>{{ costAuthorityLabel(session.usage.costAuthority) }}</small></span>
      <span title="Wall-clock runtime">{{ formatDuration(session.startedAt, session.endedAt) }}</span>
      <span title="Provider-reported token total">{{ formatUsage(session.usage) }} <small>{{ session.usage.usageAuthority }}</small></span>
      <span title="Calls spent against the host ceiling">calls {{ session.callsSpent }}/{{ session.callCeiling }}</span>
      <em v-if="session.usage.costPartial">partial total</em>
    </div>
  </a>
</template>
