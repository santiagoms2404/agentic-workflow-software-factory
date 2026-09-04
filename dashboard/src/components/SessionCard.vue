<script setup lang="ts">
import { computed, ref } from "vue";
import type { ActivityPoint, AgentSummary, PhaseSummary, SessionCard as Session } from "../../shared/types.ts";
import { axisTicks, costAuthorityLabel, formatCalls, formatCost, formatDate, formatDuration, formatTokens, formatUsage, shortSessionId, stateLabel, stateTone } from "../display.ts";
import LaneIcon from "./LaneIcon.vue";

const props = defineProps<{ session: Session; toneClass?: string }>();
const emit = defineEmits<{ archived: [sessionId: string] }>();
const archived = ref(false);
const archiving = ref(false);
const archiveError = ref<string | null>(null);
const start = computed(() => Date.parse(props.session.startedAt));
const end = computed(() => {
  const observed = Math.max(
    Date.parse(props.session.updatedAt),
    ...props.session.activity.map((point) => Date.parse(point.endedAt ?? point.startedAt)),
  );
  const live = ["RUNNING", "GATING", "REVIEWING", "LANDING"].includes(props.session.state);
  return Math.max(start.value + 1_000, props.session.endedAt ? Date.parse(props.session.endedAt) : live ? Date.now() : observed);
});
const span = computed(() => Math.max(1_000, end.value - start.value));
const runtimeEnd = computed(() => new Date(end.value).toISOString());
const ticks = computed(() => axisTicks(span.value, 4));
const phaseById = computed(() => new Map(props.session.phases.map((phase) => [phase.phaseId, phase])));
const palette = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--amber)", "var(--violet)"];

interface CardLane { key: string; label: string; color: string; agent: string | null; points: ActivityPoint[] }

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
    return { key, label: labels.get(key) ?? key, color, agent: owner, points };
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

async function archiveSession(): Promise<void> {
  if (archiving.value) return;
  archiving.value = true;
  archiveError.value = null;
  try {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(props.session.sessionId)}/archive`, { method: "POST" });
    if (!response.ok) throw new Error("Archive action unavailable");
    archived.value = true;
    emit("archived", props.session.sessionId);
  } catch (reason) {
    archiveError.value = reason instanceof Error ? reason.message : "Archive action unavailable";
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <div v-if="!archived" class="card-wrap" :class="toneClass">
  <a class="session-card" :class="stateTone(session.state)" :href="`#/sessions/${session.sessionId}`">
    <span class="card-id">{{ shortSessionId(session.sessionId) }}</span>
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
        <span class="mini-agent" :style="{ color: lane.color }" :title="lane.label"><LaneIcon :lane-key="lane.key" :agent="lane.agent" /><span>{{ lane.label }}</span></span>
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
    <dl class="card-metrics-grid">
      <div title="Cost and authority"><dt>cost</dt><dd>{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} <small>{{ costAuthorityLabel(session.usage.costAuthority) }}</small></dd></div>
      <div title="Wall-clock runtime"><dt>runtime</dt><dd>{{ formatDuration(session.startedAt, runtimeEnd) }}</dd></div>
      <div title="Provider-reported token total"><dt>usage</dt><dd>{{ formatUsage(session.usage) }} <small>{{ session.usage.usageAuthority }}<template v-if="session.usage.cacheReadTokens !== null"> · cache {{ formatTokens(session.usage.cacheReadTokens) }}</template></small></dd></div>
      <div title="Calls spent against the host ceiling"><dt>calls</dt><dd>{{ formatCalls(session.callsSpent, session.callCeiling) }}</dd></div>
      <div v-if="session.usage.costPartial" class="partial-metric"><dt>authority</dt><dd>partial total</dd></div>
    </dl>
  </a>
  <button
    type="button"
    class="archive-control"
    :disabled="archiving"
    :aria-label="`Archive session ${shortSessionId(session.sessionId)} from this review list`"
    title="Archive from dashboard list; lifecycle, Git, and configuration are unchanged"
    @click="archiveSession"
  >{{ archiving ? "…" : "archive" }}</button>
  <p v-if="archiveError" class="card-action-error" role="alert">{{ archiveError }}</p>
  </div>
</template>
