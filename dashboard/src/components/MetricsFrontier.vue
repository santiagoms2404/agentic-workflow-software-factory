<script setup lang="ts">
import { computed, ref } from "vue";
import type { MetricsRoleRow, RateCardRow } from "../../shared/types.ts";
import { listPrice } from "../../shared/rate-card.ts";
import { frontier, verdicts, type FrontierX, type FrontierY } from "../../shared/route-metrics.ts";
import {
  X_PILLS,
  Y_PILLS,
  frontierPlot,
  frontierRole,
  frontierRoles,
  routeNames,
  unplacedText,
  verdictCards,
  type FrontierMark,
} from "../metrics-frontier.ts";
import type { FrontierState } from "../metrics-lens.ts";

const props = defineProps<{
  /** The rows in the lens. */
  rows: readonly MetricsRoleRow[];
  rateCard: readonly RateCardRow[];
  priorLabels: Readonly<Record<string, string>>;
  state: FrontierState;
  roleColors: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{ change: [change: Partial<FrontierState>] }>();

const roles = computed(() => frontierRoles(props.rows));
const role = computed(() => frontierRole(props.state.role, props.rows));
const names = computed(() => routeNames(props.rows, props.rateCard, props.priorLabels));
const front = computed(() => (role.value === null ? null : frontier(props.rows, role.value, props.state.y, props.state.x, listPrice)));
const plot = computed(() => (front.value === null || front.value.points.length === 0 ? null : frontierPlot(front.value, names.value)));
const cards = computed(() => (front.value === null ? [] : verdictCards(front.value, verdicts(front.value), names.value)));
const unplaced = computed(() => (front.value?.unplaced ?? []).map((entry) => ({
  key: entry.key,
  text: `${names.value.get(entry.key)?.title ?? entry.key}: ${unplacedText(entry.reason)}`,
})));

/** The mark whose tooltip shows: the hovered one, else the focused one. */
const hovered = ref<string | null>(null);
const focused = ref<string | null>(null);
const active = computed<FrontierMark | null>(() => {
  const key = hovered.value ?? focused.value;
  return plot.value?.marks.find((mark) => mark.key === key) ?? null;
});
const tooltipStyle = computed(() => {
  if (active.value === null || plot.value === null) return {};
  const left = (active.value.cx / plot.value.width) * 100;
  return {
    left: `${left}%`,
    top: `${(active.value.cy / plot.value.height) * 100}%`,
    transform: left > 60 ? "translate(calc(-100% - 14px), -50%)" : "translate(14px, -50%)",
  };
});

function roleDot(name: string): string {
  return props.roleColors[name] ?? "var(--faint)";
}
function pickRole(name: string): void {
  emit("change", { role: name });
}
function pickY(y: FrontierY): void {
  emit("change", { y });
}
function pickX(x: FrontierX): void {
  emit("change", { x });
}
function diamond(mark: FrontierMark): string {
  const r = 10;
  return `M${mark.cx} ${mark.cy - r} L${mark.cx + r} ${mark.cy} L${mark.cx} ${mark.cy + r} L${mark.cx - r} ${mark.cy}Z`;
}
</script>

<template>
  <div class="frontier-view">
    <header class="metrics-view-head">
      <h2 class="metrics-view-title">Cost against success, per role</h2>
      <p class="metrics-view-lede">Each mark is a route. Whiskers are 95% Wilson intervals. The line joins routes no other route beats on both axes. Hollow marks have fewer than 5 settled rows and do not shape the line. Performance, cost and speed are read together, one axis pair at a time. Circle: Anthropic. Diamond: OpenAI.</p>
    </header>

    <p v-if="roles.length === 0" class="metrics-note">No role-row in the lens ran on a single route.</p>
    <template v-else>
      <div class="frontier-controls">
        <div class="frontier-pills" role="group" aria-label="Role">
          <button
            v-for="name in roles"
            :key="name"
            type="button"
            class="metrics-pill frontier-role"
            :aria-pressed="role === name"
            @click="pickRole(name)"
          ><i class="metrics-dot" :style="{ background: roleDot(name) }" aria-hidden="true" />{{ name }}</button>
        </div>
        <div class="frontier-pills" role="group" aria-label="Success measure">
          <button
            v-for="pill in Y_PILLS"
            :key="pill.id"
            type="button"
            class="metrics-pill"
            :aria-pressed="state.y === pill.id"
            @click="pickY(pill.id)"
          >{{ pill.label }}</button>
        </div>
      </div>
      <div class="frontier-pills frontier-x" role="group" aria-label="x axis">
        <span class="frontier-axis-label" aria-hidden="true">x axis</span>
        <button
          v-for="pill in X_PILLS"
          :key="pill.id"
          type="button"
          class="metrics-pill"
          :aria-pressed="state.x === pill.id"
          @click="pickX(pill.id)"
        >{{ pill.label }}</button>
      </div>

      <p v-if="plot === null" class="metrics-note">
        {{ state.x === "list-per-row" ? "No priced, settled rows" : "No settled rows with minutes" }} for {{ role }} in the lens.
      </p>
      <div v-else class="frontier-plot">
        <svg :viewBox="`0 0 ${plot.width} ${plot.height}`" role="group" :aria-label="`${plot.yTitle} against ${plot.xTitle} for ${role}`">
          <g class="frontier-grid" aria-hidden="true">
            <line v-for="tick in plot.yTicks" :key="`y${tick.text}`" :x1="plot.plot.x" :x2="plot.plot.x + plot.plot.width" :y1="tick.y" :y2="tick.y" />
            <line v-for="tick in plot.xTicks" :key="`x${tick.text}`" :x1="tick.x" :x2="tick.x" :y1="plot.plot.y" :y2="plot.plot.y + plot.plot.height" />
          </g>
          <g class="frontier-ticks" aria-hidden="true">
            <text v-for="tick in plot.yTicks" :key="`yt${tick.text}`" :x="plot.plot.x - 14" :y="tick.y" text-anchor="end" dominant-baseline="central">{{ tick.text }}</text>
            <text v-for="tick in plot.xTicks" :key="`xt${tick.text}`" :x="tick.x" :y="plot.plot.y + plot.plot.height + 24" text-anchor="middle">{{ tick.text }}</text>
            <text class="frontier-axis-title" :x="plot.plot.x + plot.plot.width / 2" :y="plot.height - 8" text-anchor="middle">{{ plot.xTitle }} →</text>
            <text class="frontier-axis-title" :transform="`translate(18 ${plot.plot.y + plot.plot.height / 2}) rotate(-90)`" text-anchor="middle">{{ plot.yTitle }} →</text>
          </g>
          <g class="frontier-zones" aria-hidden="true">
            <text v-for="zone in plot.zones" :key="zone.text" :x="zone.x" :y="zone.y" :text-anchor="zone.anchor">{{ zone.text }}</text>
          </g>
          <g class="frontier-whiskers" aria-hidden="true">
            <g v-for="mark in plot.marks" :key="`w${mark.key}`">
              <line :x1="mark.cx" :x2="mark.cx" :y1="mark.whiskerTop" :y2="mark.whiskerBottom" />
              <line :x1="mark.cx - 5" :x2="mark.cx + 5" :y1="mark.whiskerTop" :y2="mark.whiskerTop" />
              <line :x1="mark.cx - 5" :x2="mark.cx + 5" :y1="mark.whiskerBottom" :y2="mark.whiskerBottom" />
            </g>
          </g>
          <polyline v-if="plot.line" class="frontier-line" :points="plot.line" aria-hidden="true" />
          <g class="frontier-labels" aria-hidden="true">
            <text
              v-for="mark in plot.marks.filter((candidate) => candidate.label !== null)"
              :key="`l${mark.key}`"
              :x="mark.label!.x"
              :y="mark.label!.y"
              :text-anchor="mark.label!.anchor"
            >{{ mark.labelText }}</text>
          </g>
          <g
            v-for="mark in plot.marks"
            :key="mark.key"
            class="frontier-mark"
            :class="{ hollow: mark.hollow, active: active?.key === mark.key }"
            tabindex="0"
            role="img"
            :aria-label="mark.ariaLabel"
            @mouseenter="hovered = mark.key"
            @mouseleave="hovered = null"
            @focus="focused = mark.key"
            @blur="focused = null"
          >
            <path v-if="mark.provider === 'openai'" :d="diamond(mark)" />
            <circle v-else-if="mark.provider === 'anthropic'" :cx="mark.cx" :cy="mark.cy" r="9" />
            <rect v-else :x="mark.cx - 8" :y="mark.cy - 8" width="16" height="16" rx="2" />
          </g>
        </svg>
        <div v-if="active" class="frontier-tooltip" :style="tooltipStyle" role="tooltip">
          <strong>{{ active.tooltip[0] }}</strong>
          <span v-for="line in active.tooltip.slice(1)" :key="line">{{ line }}</span>
        </div>
      </div>

      <p v-if="unplaced.length > 0" class="metrics-note">Not placed: {{ unplaced.map((entry) => entry.text).join(" · ") }}.</p>
      <p v-if="front && front.excluded > 0" class="metrics-note">{{ front.excluded }} role-rows kept out of the ranking: route-attributed identity, partial usage or degraded observability.</p>

      <ul v-if="cards.length > 0" class="frontier-cards" aria-label="Verdicts">
        <li v-for="card in cards" :key="card.key" class="frontier-card">
          <span class="frontier-card-head">
            <svg v-if="card.provider === 'openai'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" /></svg>
            <svg v-else-if="card.provider === 'anthropic'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg>
            <strong>{{ card.title }}</strong>
            <span v-if="card.tagText" class="frontier-tag" :class="`tag-${card.tag}`">{{ card.tagText }}</span>
          </span>
          <span class="frontier-card-text">{{ card.text }}</span>
          <span class="frontier-card-value">{{ card.value }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>
