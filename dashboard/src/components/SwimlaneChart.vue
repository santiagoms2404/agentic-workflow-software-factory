<script setup lang="ts">
import { computed } from "vue";
import type { AgentSummary, PhaseSummary, SessionDetailResponse } from "../../shared/types.ts";
import { axisTicks, contextMeterPercent, formatDuration, formatTokens, providerMark } from "../display.ts";
import { layoutTimeline } from "../timeline.ts";

const props = defineProps<{ session: SessionDetailResponse; selectedPhaseId: string | null }>();
const emit = defineEmits<{ inspect: [phaseId: string] }>();
const palette = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--violet)", "var(--amber)"];

const start = computed(() => Date.parse(props.session.startedAt));
const end = computed(() => Date.parse(props.session.endedAt ?? new Date().toISOString()));
const span = computed(() => Math.max(1_000, end.value - start.value));
const requestPhase = computed(() => props.session.phases.find((phase) => phase.kind === "engineer" && phase.startedAt !== null) ?? null);
const leadingZone = computed(() => requestPhase.value ? 16 : 0);
const ticks = computed(() => axisTicks(span.value, 7));

interface Lane { key: string; label: string; role: string; color: string; agent: AgentSummary | null; phases: PhaseSummary[] }
const lanes = computed<Lane[]>(() => {
  const result: Lane[] = [];
  const engineer = props.session.phases.filter((phase) => phase.kind === "engineer");
  if (engineer.length) result.push({ key: "engineer", label: "engineer", role: "request authority", color: "var(--amber)", agent: null, phases: engineer });
  const code = props.session.phases.filter((phase) => phase.kind === "code");
  if (code.length || props.session.gates.length || props.session.candidateSha) result.push({ key: "code", label: "code / git", role: "host workspace", color: "var(--green)", agent: null, phases: code });
  const owners: string[] = [];
  for (const phase of props.session.phases) if (phase.kind === "agent" && !owners.includes(phase.owner)) owners.push(phase.owner);
  owners.forEach((owner, index) => {
    const agent = props.session.agents.find((item) => item.agent === owner) ?? null;
    result.push({ key: `agent:${owner}`, label: owner, role: "agent", color: agent?.color ?? palette[index % palette.length]!, agent, phases: props.session.phases.filter((phase) => phase.kind === "agent" && phase.owner === owner) });
  });
  return result;
});

const layout = computed(() => layoutTimeline(
  props.session.phases
    .filter((phase) => phase.startedAt !== null && phase.phaseId !== requestPhase.value?.phaseId)
    .map((phase) => ({
      id: phase.phaseId,
      start: Date.parse(phase.startedAt!),
      end: Date.parse(phase.endedAt ?? new Date().toISOString()),
    })),
  { start: start.value, end: end.value, leadingZonePercent: leadingZone.value, minimumWidthPercent: 3.5 },
));
function geometry(phase: PhaseSummary): { left: string; width: string } | null {
  if (phase.phaseId === requestPhase.value?.phaseId) return { left: "0.4%", width: `${leadingZone.value - 0.8}%` };
  const item = layout.value[phase.phaseId];
  return item ? { left: `${item.left}%`, width: `${item.width}%` } : null;
}
function blockStyle(phase: PhaseSummary, lane: Lane): Record<string, string> | undefined {
  const item = geometry(phase);
  if (!item) return undefined;
  return { ...item, "--lane-color": lane.color };
}
function statusGlyph(status: string): string {
  if (status === "SUCCEEDED") return "✓";
  if (["FAILED", "CANCELLED"].includes(status)) return "×";
  if (["RUNNING", "VALIDATING", "CORRECTING"].includes(status)) return "●";
  return "○";
}
function phaseDuration(phase: PhaseSummary): string {
  return formatDuration(phase.startedAt ?? phase.createdAt, phase.endedAt);
}
function eventsFor(phase: PhaseSummary): Array<{ id: string; left: string; title: string; error: boolean }> {
  const phaseStart = Date.parse(phase.startedAt ?? phase.createdAt);
  const phaseEnd = Date.parse(phase.endedAt ?? new Date().toISOString());
  const duration = Math.max(1, phaseEnd - phaseStart);
  return props.session.activity
    .filter((point) => point.source === "event" && point.phaseId === phase.phaseId)
    .map((point) => ({
      id: point.id,
      left: `${Math.max(1, Math.min(99, ((Date.parse(point.startedAt) - phaseStart) / duration) * 100))}%`,
      title: `${point.type} · ${point.status ?? "recorded"} · ${point.startedAt}`,
      error: point.status === "error" || point.type === "run.failed",
    }));
}
function context(agent: AgentSummary | null): number | null {
  return agent ? contextMeterPercent(agent.contextTokens, agent.contextWindow) : null;
}
function queued(lane: Lane): PhaseSummary[] { return lane.phases.filter((phase) => phase.startedAt === null); }
</script>

<template>
  <section class="waterfall-section" aria-labelledby="waterfall-title">
    <div class="waterfall-heading">
      <div><span class="eyebrow">Journal-backed execution</span><h2 id="waterfall-title">Waterfall</h2></div>
      <span>{{ ticks[0]?.label }} → {{ ticks.at(-1)?.label }}</span>
    </div>
    <div class="waterfall-scroll" tabindex="0" aria-label="Execution timeline; horizontally scrollable on narrow screens">
      <div class="waterfall">
        <div class="waterfall-row axis-row">
          <div class="waterfall-label" />
          <div class="waterfall-track">
            <span v-if="leadingZone" class="request-zone-label" :style="{ width: `${leadingZone}%` }">request</span>
            <span v-for="tick in ticks" :key="tick.percent" class="axis-label" :style="{ left: `${tick.percent}%` }">{{ tick.label }}</span>
          </div>
        </div>
        <div v-for="lane in lanes" :key="lane.key" class="waterfall-row lane-row">
          <div class="waterfall-label">
            <strong :style="{ color: lane.color }"><span aria-hidden="true">{{ lane.agent ? "▣" : lane.key === "code" ? "⌘" : "♙" }}</span>{{ lane.label }}</strong>
            <span>{{ lane.role }}</span>
            <template v-if="lane.agent">
              <span class="lane-provider"><b aria-hidden="true">{{ providerMark(lane.agent.provider) }}</b>{{ lane.agent.provider }}</span>
              <span class="lane-model" :title="`${lane.agent.resolvedModel ?? lane.agent.requestedModel} · ${lane.agent.modelProvenance ?? 'unrecorded'}`">{{ lane.agent.resolvedModel ?? lane.agent.requestedModel }}</span>
              <span v-if="context(lane.agent) !== null" class="lane-context" :title="`${lane.agent.contextTokens} / ${lane.agent.contextWindow} tokens`">
                <span>Context <b>{{ Math.round(context(lane.agent)!) }}%</b></span>
                <i><b :style="{ width: `${Math.max(context(lane.agent)!, 2)}%`, background: lane.color }" /></i>
              </span>
            </template>
          </div>
          <div class="waterfall-track">
            <span v-if="leadingZone" class="request-zone-line" :style="{ left: `${leadingZone}%` }" />
            <span v-for="tick in ticks" :key="tick.percent" class="gridline" :style="{ left: `${tick.percent}%` }" />
            <template v-for="phase in lane.phases" :key="phase.phaseId">
              <button
                v-if="geometry(phase)"
                type="button"
                class="phase-block"
                :class="[phase.status.toLowerCase(), { selected: selectedPhaseId === phase.phaseId }]"
                :style="blockStyle(phase, lane)"
                :aria-label="`Inspect ${phase.name}: ${phase.description}; ${phase.status}; ${phaseDuration(phase)}`"
                :title="`${phase.name} — ${phase.status}\n${phase.description}`"
                @click="emit('inspect', phase.phaseId)"
              >
                <span class="phase-block-top"><b :class="phase.status.toLowerCase()">{{ statusGlyph(phase.status) }}</b><strong>{{ phase.name }}</strong><small>{{ phaseDuration(phase) }}</small></span>
                <span class="phase-description">{{ phase.description }}</span>
                <i v-for="point in eventsFor(phase)" :key="point.id" class="event-tick" :class="{ error: point.error }" :style="{ left: point.left }" :title="point.title" />
              </button>
            </template>
            <button
              v-for="(phase, index) in queued(lane)"
              :key="phase.phaseId"
              type="button"
              class="phase-block queued"
              :class="{ selected: selectedPhaseId === phase.phaseId }"
              :style="{ right: `${index * 13 + 1}%`, width: '12%' }"
              :aria-label="`Inspect queued phase ${phase.name}`"
              @click="emit('inspect', phase.phaseId)"
            ><span class="phase-block-top"><b>○</b><strong>{{ phase.name }}</strong></span><span class="phase-description">queued · {{ phase.description }}</span></button>
            <div v-if="lane.key === 'code'" class="code-evidence">
              <span v-if="session.candidateSha" class="commit-pill" :title="session.candidateSha">commit {{ session.candidateSha.slice(0, 10) }}</span>
              <span v-for="gate in session.gates.slice(-6)" :key="gate.id" class="gate-pill" :class="gate.passed ? 'pass' : 'fail'" :title="`${gate.gateId} · ${gate.startedAt}`">{{ gate.passed ? "✓" : "×" }} {{ gate.gateId }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
