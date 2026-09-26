<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { AgentSummary, PhaseSummary, SessionDetailResponse } from "../../shared/types.ts";
import { axisTicks, contextMeterPercent, formatDuration, formatTokens, providerMark } from "../display.ts";
import { layoutTimeline } from "../timeline.ts";
import LaneIcon from "./LaneIcon.vue";

const props = defineProps<{ session: SessionDetailResponse; selectedPhaseId: string | null }>();
const emit = defineEmits<{ inspect: [phaseId: string] }>();
const palette = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--violet)", "var(--amber)"];

const scroller = ref<HTMLElement | null>(null);
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
const requestPhase = computed(() => props.session.phases.find((phase) => phase.kind === "engineer" && phase.startedAt !== null) ?? null);
const ticks = computed(() => axisTicks(span.value, 7));

// The track is sized in pixels, then laid out in percent of that size. It is
// never narrower than the viewport and grows past it when the started phases
// cannot each keep a readable width, which is what gives the scroller (and so
// the arrows, trackpad and wheel) something to scroll.
const LABEL_PX = 280;
const QUEUE_PX = 210;
const REQUEST_PX = 170;
const PHASE_PX = 190;
const viewportWidth = ref(1080);
let resize: ResizeObserver | undefined;
onMounted(() => {
  if (!scroller.value) return;
  viewportWidth.value = scroller.value.clientWidth;
  resize = new ResizeObserver(([entry]) => { if (entry) viewportWidth.value = entry.contentRect.width; });
  resize.observe(scroller.value);
});
onBeforeUnmount(() => resize?.disconnect());

/** Queued phases wait in a zone left of the timeline, then move right to their start time. */
const hasQueue = computed(() => props.session.phases.some((phase) => phase.startedAt === null));
const startedCount = computed(() => props.session.phases.filter((phase) => phase.startedAt !== null && phase.phaseId !== requestPhase.value?.phaseId).length);
const queuePx = computed(() => hasQueue.value ? QUEUE_PX : 0);
const requestPx = computed(() => requestPhase.value ? REQUEST_PX : 0);
const trackPx = computed(() => {
  const zone = queuePx.value + requestPx.value;
  const needed = Math.max(zone + startedCount.value * PHASE_PX + 8, zone / 0.4);
  return Math.max(viewportWidth.value - LABEL_PX, 800, Math.ceil(needed));
});
const percent = (px: number): number => (px / trackPx.value) * 100;
const queueZone = computed(() => percent(queuePx.value));
const leadingZone = computed(() => queueZone.value + percent(requestPx.value));
/** Axis ticks span the timeline only, not the queue and request zones before it. */
function tickLeft(tickPercent: number): string {
  return `${leadingZone.value + tickPercent * (100 - leadingZone.value - 0.4) / 100}%`;
}

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
      end: phase.endedAt ? Date.parse(phase.endedAt) : end.value,
    })),
  { start: start.value, end: end.value, leadingZonePercent: leadingZone.value, minimumWidthPercent: percent(PHASE_PX - 10) },
));
function geometry(phase: PhaseSummary, lane: Lane): Record<string, string> | null {
  if (phase.startedAt === null) {
    // One queued phase keeps the full block; several stack as compact rows.
    const waiting = queued(lane);
    const index = waiting.indexOf(phase);
    const box = { left: `${percent(8)}%`, width: `${percent(QUEUE_PX - 16)}%` };
    return waiting.length === 1 ? box : { ...box, top: `${14 + index * 44}px`, height: "38px" };
  }
  if (phase.phaseId === requestPhase.value?.phaseId) {
    return { left: `${queueZone.value + 0.4}%`, width: `${leadingZone.value - queueZone.value - 0.8}%` };
  }
  const item = layout.value[phase.phaseId];
  return item ? { left: `${item.left}%`, width: `${item.width}%` } : null;
}
function blockStyle(phase: PhaseSummary, lane: Lane): Record<string, string> | undefined {
  const item = geometry(phase, lane);
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
function scrollTimeline(direction: -1 | 1): void {
  scroller.value?.scrollBy({ left: direction * Math.max(280, scroller.value.clientWidth * 0.7), behavior: "smooth" });
}
/**
 * A trackpad's sideways swipe scrolls the timeline natively. A vertical wheel
 * pans it too, until the timeline reaches that end; from there the page
 * scrolls as usual, so the waterfall never traps the page.
 */
function wheelTimeline(event: WheelEvent): void {
  const element = scroller.value;
  if (!element || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const max = element.scrollWidth - element.clientWidth;
  if (max <= 0) return;
  if ((event.deltaY < 0 && element.scrollLeft <= 0) || (event.deltaY > 0 && element.scrollLeft >= max - 1)) return;
  event.preventDefault();
  element.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
}
</script>

<template>
  <section class="waterfall-section" aria-labelledby="waterfall-title">
    <div class="waterfall-heading">
      <div><span class="eyebrow">Journal-backed execution</span><h2 id="waterfall-title">Waterfall</h2></div>
      <div class="timeline-access">
        <span>{{ ticks[0]?.label }} → {{ ticks.at(-1)?.label }}</span>
        <span class="scroll-cue">↔ scroll timeline</span>
        <button type="button" aria-label="Scroll timeline left" title="Scroll timeline left" @click="scrollTimeline(-1)">←</button>
        <button type="button" aria-label="Scroll timeline right" title="Scroll timeline right" @click="scrollTimeline(1)">→</button>
      </div>
    </div>
    <div ref="scroller" class="waterfall-scroll" tabindex="0" aria-label="Execution timeline; use horizontal scrolling or the arrow controls to reach all evidence" @wheel="wheelTimeline">
      <div class="waterfall" :style="{ width: `${LABEL_PX + trackPx}px` }">
        <div class="waterfall-row axis-row">
          <div class="waterfall-label" />
          <div class="waterfall-track">
            <span v-if="queueZone" class="request-zone-label queue-zone-label" :style="{ width: `${queueZone}%` }">queued</span>
            <span v-if="requestPhase" class="request-zone-label" :style="{ left: `${queueZone}%`, width: `${leadingZone - queueZone}%` }">request</span>
            <span v-for="(tick, index) in ticks" :key="tick.percent" class="axis-label" :class="{ 'edge-start': index === 0 && !leadingZone, 'edge-end': index === ticks.length - 1 }" :style="{ left: tickLeft(tick.percent) }">{{ tick.label }}</span>
          </div>
        </div>
        <div v-for="lane in lanes" :key="lane.key" class="waterfall-row lane-row" :class="{ 'agent-lane': Boolean(lane.agent), 'evidence-lane': lane.key === 'code' && (session.gates.length > 0 || Boolean(session.candidateSha)) }">
          <div class="waterfall-label">
            <strong :style="{ color: lane.color }"><LaneIcon :lane-key="lane.key" :agent="lane.agent?.agent" />{{ lane.label }}</strong>
            <span>{{ lane.role }}</span>
            <template v-if="lane.agent">
              <span class="lane-provider"><b aria-hidden="true">{{ providerMark(lane.agent.provider) }}</b>{{ lane.agent.provider }}</span>
              <span class="lane-model" :title="`${lane.agent.resolvedModel ?? lane.agent.requestedModel} · ${lane.agent.modelProvenance ?? 'unrecorded'}`">{{ lane.agent.resolvedModel ?? lane.agent.requestedModel }}</span>
              <span v-if="context(lane.agent) !== null" class="lane-context" :title="`${formatTokens(lane.agent.contextTokens)} / ${formatTokens(lane.agent.contextWindow)} tokens`">
                <span>Context <b>{{ Math.round(context(lane.agent)!) }}%</b></span>
                <i><b :style="{ width: `${Math.max(context(lane.agent)!, 2)}%`, background: lane.color }" /></i>
              </span>
              <span class="lane-sandbox" :class="lane.agent.sandboxBadge ?? 'legacy'" :title="lane.agent.sandboxMechanism ?? 'mechanism not recorded'">
                <b>sandbox {{ lane.agent.sandboxBadge ?? "not recorded" }}</b>
                <small>{{ lane.agent.sandboxMechanism ?? "unknown mechanism" }}</small>
              </span>
            </template>
          </div>
          <div class="waterfall-track">
            <span v-if="queueZone" class="request-zone-line" :style="{ left: `${queueZone}%` }" />
            <span v-if="requestPhase" class="request-zone-line" :style="{ left: `${leadingZone}%` }" />
            <span v-for="tick in ticks" :key="tick.percent" class="gridline" :style="{ left: tickLeft(tick.percent) }" />
            <!-- One keyed element per phase, queued or started, so a phase that
                 starts slides from the queue to its start time instead of
                 being replaced. -->
            <template v-for="phase in lane.phases" :key="phase.phaseId">
              <button
                v-if="geometry(phase, lane)"
                type="button"
                class="phase-block"
                :class="[phase.status.toLowerCase(), { queued: phase.startedAt === null, compact: phase.startedAt === null && queued(lane).length > 1, selected: selectedPhaseId === phase.phaseId || selectedPhaseId === phase.key }]"
                :style="blockStyle(phase, lane)"
                :aria-label="phase.startedAt === null ? `Inspect queued phase ${phase.name}` : `Inspect ${phase.name}: ${phase.description}; ${phase.status}; ${phaseDuration(phase)}`"
                :title="`${phase.name} — ${phase.status}\n${phase.description}`"
                @click="emit('inspect', phase.key)"
              >
                <template v-if="phase.startedAt === null">
                  <span class="phase-block-top"><b>○</b><strong>{{ phase.name }}</strong></span>
                  <span class="phase-description">queued · {{ phase.description }}</span>
                </template>
                <template v-else>
                  <span class="phase-block-top"><b :class="phase.status.toLowerCase()">{{ statusGlyph(phase.status) }}</b><strong>{{ phase.name }}</strong><small>{{ phaseDuration(phase) }}</small></span>
                  <span class="phase-description">{{ phase.description }}</span>
                  <i v-for="point in eventsFor(phase)" :key="point.id" class="event-tick" :class="{ error: point.error }" :style="{ left: point.left }" :title="point.title" />
                </template>
              </button>
            </template>
            <div v-if="lane.key === 'code'" class="code-evidence" :style="queueZone ? { left: `calc(${queueZone}% + 6px)` } : undefined">
              <span v-if="session.candidateSha" class="commit-pill" :title="session.candidateSha">commit {{ session.candidateSha.slice(0, 10) }}</span>
              <span v-for="gate in session.gates.slice(-6)" :key="gate.id" class="gate-pill" :class="gate.passed ? 'pass' : 'fail'" :title="`${gate.gateId} · ${gate.startedAt}`">{{ gate.passed ? "✓" : "×" }} {{ gate.gateId }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
