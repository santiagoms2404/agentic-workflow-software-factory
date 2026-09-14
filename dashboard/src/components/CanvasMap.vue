<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CanvasGraph, CanvasNode } from "../canvas-graph.ts";
import { layoutGraph, retainedPins, settle, type Point } from "../canvas-layout.ts";
import {
  fitCamera,
  graphPoint,
  nodeRadius,
  openHref,
  screenPoint,
  zoomAbout,
  type Camera,
} from "../canvas-view.ts";

const props = defineProps<{
  graph: CanvasGraph;
  camera: Camera | null;
  selected: string | null;
  /** Positions the reader has dragged, kept in their browser and nowhere else. */
  pinned: ReadonlyMap<string, Point>;
}>();
const emit = defineEmits<{
  "update:camera": [camera: Camera];
  "update:selected": [selected: string | null];
  "update:pinned": [pinned: ReadonlyMap<string, Point>];
}>();

const surface = ref<HTMLElement | null>(null);
const viewport = ref({ width: 1100, height: 680 });
const positions = ref<ReadonlyMap<string, Point>>(new Map());
const hovered = ref<string | null>(null);

/**
 * The layout is recomputed when the graph changes, never on every poll of
 * unchanged rows: the node ids are stable and sorted, so this key only moves
 * when something was actually added or removed.
 */
const shape = computed(() => props.graph.nodes.map((node) => node.id).join("|"));
const pins = computed(() => retainedPins(props.graph, props.pinned));

function relayout(): void {
  positions.value = layoutGraph(props.graph, { pinned: pins.value }).positions;
}

watch(shape, relayout, { immediate: true });
watch(() => props.pinned, relayout);

const camera = computed<Camera>(() => props.camera ?? fitCamera(
  { positions: positions.value, bounds: boundsOf() },
  viewport.value,
));

function boundsOf(): { minX: number; minY: number; maxX: number; maxY: number } {
  if (positions.value.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of positions.value.values()) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function at(id: string): Point {
  return screenPoint(positions.value.get(id) ?? { x: 0, y: 0 }, camera.value);
}

/** An orthogonal-free straight line: the reader is following which dot joins which. */
function edgePath(from: string, to: string): string {
  const start = at(from);
  const end = at(to);
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/** A rounded hull around a cluster's dots, drawn behind them. */
function clusterBox(nodeIds: readonly string[]): Record<string, string> {
  const points = nodeIds.map((id) => at(id));
  if (points.length === 0) return { display: "none" };
  const pad = 46 * camera.value.zoom;
  const minX = Math.min(...points.map((point) => point.x)) - pad;
  const minY = Math.min(...points.map((point) => point.y)) - pad;
  const maxX = Math.max(...points.map((point) => point.x)) + pad;
  const maxY = Math.max(...points.map((point) => point.y)) + pad;
  return { left: `${minX}px`, top: `${minY}px`, width: `${maxX - minX}px`, height: `${maxY - minY}px` };
}

function dotStyle(node: CanvasNode): Record<string, string> {
  const point = at(node.id);
  const size = nodeRadius(node.weight) * 2 * camera.value.zoom;
  return {
    left: `${point.x - size / 2}px`,
    top: `${point.y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
  };
}

/** Selection dims; it never filters. Every dot stays exactly where it was. */
function dotClasses(node: CanvasNode): readonly string[] {
  const classes = [`canvas-dot-${node.kind}`];
  if (props.selected === null) return classes;
  if (props.selected === node.id) return [...classes, "selected"];
  const touching = props.graph.edges.some((edge) =>
    (edge.from === props.selected && edge.to === node.id) || (edge.to === props.selected && edge.from === node.id));
  return [...classes, touching ? "adjacent" : "dimmed"];
}

function edgeClasses(from: string, to: string, kind: string): readonly string[] {
  const classes = ["canvas-edge", `edge-${kind}`];
  if (props.selected === null) return classes;
  return [...classes, props.selected === from || props.selected === to ? "lit" : "dimmed"];
}

/* --- Pointer: drag a dot to pin it, drag the ground to pan ---------------- */

interface Drag { readonly id: string | null; readonly from: Point; readonly camera: Camera; moved: boolean }
let drag: Drag | null = null;

function onPointerDown(event: PointerEvent, id: string | null): void {
  if (event.button !== 0) return;
  drag = { id, from: { x: event.clientX, y: event.clientY }, camera: camera.value, moved: false };
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (drag === null) return;
  const dx = event.clientX - drag.from.x;
  const dy = event.clientY - drag.from.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  if (drag.id === null) {
    emit("update:camera", { ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy });
    return;
  }
  // The dragged dot follows the pointer and the rest give way around it, a few
  // steps per frame so the reader sees them move rather than jump to an answer.
  const rect = surface.value?.getBoundingClientRect();
  const held = graphPoint({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }, camera.value);
  const pinned = new Map([...pins.value, [drag.id, held]]);
  positions.value = settle(props.graph, positions.value, { pinned, steps: 3 }).positions;
}

function onPointerUp(event: PointerEvent): void {
  const finished = drag;
  drag = null;
  if (finished === null) return;
  if (finished.id !== null && finished.moved) {
    // Dropped, so it stays: without pinning the simulation re-settles on the
    // next load and silently undoes the arrangement.
    const dropped = positions.value.get(finished.id);
    if (dropped !== undefined) emit("update:pinned", new Map([...pins.value, [finished.id, dropped]]));
    return;
  }
  if (finished.id !== null) {
    emit("update:selected", props.selected === finished.id ? null : finished.id);
    return;
  }
  if (!finished.moved) emit("update:selected", null);
  void event;
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const rect = surface.value?.getBoundingClientRect();
  const at_ = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  emit("update:camera", zoomAbout(camera.value, at_, event.deltaY < 0 ? 1.12 : 1 / 1.12));
}

/* --- Keyboard: every action the mouse can reach ---------------------------- */

function pan(dx: number, dy: number): void {
  emit("update:camera", { ...camera.value, x: camera.value.x + dx, y: camera.value.y + dy });
}

function fit(): void {
  emit("update:camera", fitCamera({ positions: positions.value, bounds: boundsOf() }, viewport.value));
}

function onKeydown(event: KeyboardEvent): void {
  const centre = { x: viewport.value.width / 2, y: viewport.value.height / 2 };
  if (event.key === "Escape") { emit("update:selected", null); return; }
  if (event.key === "ArrowLeft") { pan(60, 0); }
  else if (event.key === "ArrowRight") { pan(-60, 0); }
  else if (event.key === "ArrowUp") { pan(0, 60); }
  else if (event.key === "ArrowDown") { pan(0, -60); }
  else if (event.key === "+" || event.key === "=") { emit("update:camera", zoomAbout(camera.value, centre, 1.15)); }
  else if (event.key === "-" || event.key === "_") { emit("update:camera", zoomAbout(camera.value, centre, 1 / 1.15)); }
  else if (event.key === "0") { fit(); }
  else return;
  event.preventDefault();
}

function measure(): void {
  const rect = surface.value?.getBoundingClientRect();
  if (rect !== undefined && rect.width > 0) viewport.value = { width: rect.width, height: rect.height };
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (surface.value !== null) observer.observe(surface.value);
});
onBeforeUnmount(() => observer?.disconnect());

defineExpose({ fit });
</script>

<template>
  <div
    ref="surface"
    class="canvas-surface neu-well"
    tabindex="0"
    role="application"
    aria-label="Execution map. Arrow keys pan, plus and minus zoom, 0 fits the graph, Escape clears the selection."
    @pointerdown="onPointerDown($event, null)"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
    @keydown="onKeydown"
  >
    <div
      v-for="cluster in graph.clusters"
      :key="cluster.key"
      class="canvas-cluster"
      :style="clusterBox(cluster.nodeIds)"
      aria-hidden="true"
    />

    <svg class="canvas-edges" :width="viewport.width" :height="viewport.height" aria-hidden="true">
      <path
        v-for="edge in graph.edges"
        :key="`${edge.from}->${edge.to}`"
        :class="edgeClasses(edge.from, edge.to, edge.kind)"
        :d="edgePath(edge.from, edge.to)"
      />
    </svg>

    <!-- Every dot is a button, in the graph's sorted order, so Tab walks the
         map in the same order a reader meets it. -->
    <button
      v-for="node in graph.nodes"
      :key="node.id"
      type="button"
      class="canvas-dot"
      :class="dotClasses(node)"
      :style="dotStyle(node)"
      :aria-pressed="selected === node.id"
      :aria-label="`${node.kind}: ${node.label}`"
      @pointerdown.stop="onPointerDown($event, node.id)"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @focus="hovered = node.id"
      @blur="hovered = null"
      @mouseenter="hovered = node.id"
      @mouseleave="hovered = null"
      @keydown.enter.stop.prevent="$emit('update:selected', node.id)"
    />

    <!-- The name appears on hover or focus and never at rest: the map is a
         shape, not a wall of text. -->
    <p
      v-for="node in graph.nodes.filter((candidate) => candidate.id === hovered || candidate.id === selected)"
      :key="`label-${node.id}`"
      class="canvas-label"
      :class="{ held: node.id === selected }"
      :style="{ left: `${at(node.id).x}px`, top: `${at(node.id).y + nodeRadius(node.weight) * camera.zoom + 8}px` }"
    >
      <span class="canvas-label-name">{{ node.label }}</span>
      <span class="canvas-label-meta">{{ node.kind }} · {{ node.weight }} run(s)</span>
      <a v-if="node.id === selected && openHref(node)" class="canvas-label-open" :href="openHref(node) ?? '#'">open ↗</a>
    </p>

    <p v-if="!graph.nodes.length" class="canvas-empty absent">
      No run on this board carries anything to draw yet.
    </p>
  </div>
</template>
