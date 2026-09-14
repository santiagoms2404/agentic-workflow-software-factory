<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GroupSummary, SessionCard, SessionPlan } from "../../shared/types.ts";
import { buildCanvasGraph, type CanvasNodeKind } from "../canvas-graph.ts";
import type { Point } from "../canvas-layout.ts";
import {
  CANVAS_KINDS,
  canvasRouteHash,
  filterGraph,
  kindCounts,
  KIND_LABEL,
  openHref,
  type Camera,
  type CanvasRoute,
} from "../canvas-view.ts";
import CanvasMap from "../components/CanvasMap.vue";

const props = defineProps<{
  sessions: readonly SessionCard[];
  plans: readonly SessionPlan[];
  groups: readonly GroupSummary[];
  route: CanvasRoute;
}>();

const map = ref<InstanceType<typeof CanvasMap> | null>(null);
const graph = computed(() => buildCanvasGraph(props.sessions, props.groups, props.plans));
const shown = computed(() => filterGraph(graph.value, props.route.kinds));
const counts = computed(() => kindCounts(graph.value));

/**
 * Where the reader has dragged a dot.
 *
 * A preference, so it lives in this browser and never in the projection: a
 * position is not evidence of anything and has no business in a record other
 * people read. Keyed by project so two projects do not fight over one layout.
 */
const STORE = "awsf.canvas-layout";
const pinned = ref<ReadonlyMap<string, Point>>(readPins());

function readPins(): ReadonlyMap<string, Point> {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw === null) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Map();
    return new Map(Object.entries(parsed as Record<string, Point>));
  } catch {
    // A blocked or cleared store is an ordinary state, not an error the canvas
    // should refuse to draw over.
    return new Map();
  }
}

function writePins(next: ReadonlyMap<string, Point>): void {
  pinned.value = next;
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(next)));
  } catch { /* the arrangement is a convenience; losing it costs nothing real */ }
}

function go(next: Partial<CanvasRoute>): void {
  location.hash = canvasRouteHash({ ...props.route, ...next });
}

function toggleKind(kind: CanvasNodeKind): void {
  const has = props.route.kinds.includes(kind);
  const next = has ? props.route.kinds.filter((candidate) => candidate !== kind) : [...props.route.kinds, kind];
  // Every kind off is every kind on: a map showing nothing reads as broken
  // rather than as filtered, and there would be no control left to undo it.
  go({ kinds: next.length === 0 ? CANVAS_KINDS : CANVAS_KINDS.filter((candidate) => next.includes(candidate)) });
}

const selectedNode = computed(() =>
  shown.value.nodes.find((node) => node.id === props.route.selected)
  ?? graph.value.unplaced.find((node) => node.id === props.route.selected)
  ?? null);

/**
 * Clear a selection the FILTER has hidden, and only that.
 *
 * A highlight nobody can see, with no control on screen to bring it back, is
 * worth clearing. A node that is in neither the map nor the parked list is a
 * different thing entirely: usually the page has simply not loaded yet. The
 * first cut cleared on absence alone, and because the group list resolves
 * before the session list, it fired once against an empty graph and threw away
 * the selection every reader arrived with in their URL.
 */
watch(shown, (next) => {
  const selected = props.route.selected;
  if (selected === null) return;
  const recorded = (nodes: readonly { readonly id: string }[]): boolean => nodes.some((node) => node.id === selected);
  // On the map and hidden — nothing else. A node in the parked rail was never
  // on the map, so a selection naming one is not something the filter hid; and
  // during the load, before any run has arrived, EVERY recorded session is
  // parked, which is how the first two versions of this guard came to throw
  // away the selection the reader arrived with.
  if (recorded(graph.value.nodes) && !recorded(next.nodes)) go({ selected: null });
});
</script>

<template>
  <main class="canvas-route canvas-shell">
    <div class="canvas-rail">
      <header class="canvas-head neu-well">
        <p class="eyebrow">read-only execution map</p>
        <h1>Canvas</h1>
        <p class="canvas-head-note">
          {{ shown.nodes.length }} on the map · {{ shown.edges.length }} connection(s)
        </p>
      </header>

      <section class="canvas-filter neu-well" aria-labelledby="canvas-filter-title">
        <div class="session-filter-heading">
          <h2 id="canvas-filter-title">Show</h2>
          <button type="button" class="session-filter-control" @click="map?.fit()">fit the map</button>
        </div>
        <!-- A filter REMOVES a kind and takes its lines with it. Selecting a dot
             does not: it dims the others and removes nothing. Two controls that
             both dimmed would leave neither legible. -->
        <div class="canvas-filter-options" role="group" aria-label="Node kinds">
          <button
            v-for="kind in CANVAS_KINDS"
            :key="kind"
            type="button"
            class="session-filter-option canvas-kind"
            :class="[`canvas-kind-${kind}`, { selected: route.kinds.includes(kind) }]"
            :aria-pressed="route.kinds.includes(kind)"
            @click="toggleKind(kind)"
          >
            <span class="canvas-kind-dot" aria-hidden="true" />
            <span>{{ KIND_LABEL[kind] }}</span>
            <span class="session-filter-count">{{ counts.get(kind) ?? 0 }}</span>
          </button>
        </div>
      </section>

      <section v-if="selectedNode" class="canvas-selected neu-well" aria-live="polite">
        <p class="eyebrow">selected</p>
        <h2 class="canvas-selected-title">{{ selectedNode.label }}</h2>
        <p class="canvas-selected-meta">
          <code>{{ selectedNode.kind }}</code>
          <span>{{ selectedNode.weight }} run(s) behind it</span>
        </p>
        <!-- The one-line plain-language summary belongs here. A separate stream
             writes it; until then the place it sits says so rather than being
             filled with a sentence nothing generated. -->
        <p class="canvas-selected-summary absent">no summary written yet</p>
        <a v-if="openHref(selectedNode)" class="session-filter-control canvas-open" :href="openHref(selectedNode) ?? '#'">
          open this
        </a>
      </section>

      <!-- Recorded, but nothing puts it on the map: a session whose runs are
           all elsewhere, or a plan no run has named. On the real projection
           that is fourteen of forty-seven. Dropping them would make a recorded
           session unreachable; leaving them adrift in the drawing would make a
           third of the map look broken. -->
      <section v-if="shown.unplaced.length" class="canvas-parked neu-well" aria-labelledby="canvas-parked-title">
        <div class="session-filter-heading">
          <h2 id="canvas-parked-title">Not on the map</h2>
          <span class="canvas-parked-note">no run points at these yet</span>
        </div>
        <div class="canvas-parked-list">
          <a
            v-for="node in shown.unplaced"
            :key="node.id"
            class="canvas-parked-item session-filter-option"
            :class="`canvas-kind-${node.kind}`"
            :href="openHref(node) ?? '#'"
          >
            <span class="canvas-kind-dot" aria-hidden="true" />
            <span class="canvas-parked-label">{{ node.label }}</span>
          </a>
        </div>
      </section>
    </div>

    <CanvasMap
      ref="map"
      class="canvas-board"
      :graph="shown"
      :camera="route.camera"
      :selected="route.selected"
      :pinned="pinned"
      @update:camera="go({ camera: $event })"
      @update:selected="go({ selected: $event })"
      @update:pinned="writePins($event)"
    />

    <!-- Pan and zoom over thirty-odd dots on a phone is a second set of
         gestures to design and keep, for a screen that fits four of them. -->
    <p class="canvas-too-narrow neu-well">
      The map needs a wider screen. <a href="#/sessions">The sessions board</a> shows the same runs here.
    </p>
  </main>
</template>
