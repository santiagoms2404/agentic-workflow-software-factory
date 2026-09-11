<script setup lang="ts">
import { computed, ref } from "vue";
import type { GroupTree } from "../../shared/types.ts";
import { layoutTree, type TreeNode } from "../group-layout.ts";

const props = defineProps<{ tree: GroupTree }>();

/** Geometry in one place, shared by the SVG edges and the HTML nodes. */
const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 58;
const NODE_WIDTH = 268;
const NODE_HEIGHT = 42;

const layout = computed(() => layoutTree(props.tree));
const width = computed(() => layout.value.columns * COLUMN_WIDTH);
const height = computed(() => Math.max(ROW_HEIGHT, layout.value.rows * ROW_HEIGHT));
const opened = ref<string | null>(null);

function x(node: TreeNode): number { return node.column * COLUMN_WIDTH; }
function y(node: TreeNode): number { return node.row * ROW_HEIGHT; }

const byId = computed(() => new Map(layout.value.nodes.map((node) => [node.id, node])));

/**
 * An orthogonal connector: out of the parent's right edge, down, and into the
 * child's left edge. Straight segments rather than a curve, because the reader
 * is following which node came from which, not admiring the line.
 */
function path(fromId: string, toId: string): string {
  const from = byId.value.get(fromId);
  const to = byId.value.get(toId);
  if (from === undefined || to === undefined) return "";
  const startX = x(from) + (from.column === to.column ? NODE_WIDTH / 2 : NODE_WIDTH);
  const startY = y(from) + NODE_HEIGHT;
  const endX = from.column === to.column ? x(to) + NODE_WIDTH / 2 : x(to);
  const endY = y(to) + NODE_HEIGHT / 2;
  if (from.column === to.column) return `M ${startX} ${startY} L ${endX} ${endY}`;
  const elbow = Math.max(startX + 14, endX - 18);
  return `M ${startX} ${startY - NODE_HEIGHT / 2} H ${elbow} V ${endY} H ${endX}`;
}

function toggle(id: string): void {
  opened.value = opened.value === id ? null : id;
}
</script>

<template>
  <div class="tree-graph-scroll">
    <div class="tree-graph" :style="{ width: `${width}px`, height: `${height + 12}px` }">
      <svg class="tree-edges" :width="width" :height="height + 12" aria-hidden="true">
        <path
          v-for="edge in layout.edges"
          :key="`${edge.from}->${edge.to}`"
          :class="['tree-edge', `edge-${edge.kind}`]"
          :d="path(edge.from, edge.to)"
        />
      </svg>
      <button
        v-for="node in layout.nodes"
        :key="node.id"
        type="button"
        class="tree-node"
        :class="[`node-${node.kind}`, { opened: opened === node.id, detailed: node.detail.length > 0 }]"
        :style="{ left: `${x(node)}px`, top: `${y(node)}px`, width: `${NODE_WIDTH}px` }"
        :aria-expanded="opened === node.id"
        @click="toggle(node.id)"
      >
        <span class="tree-node-label">{{ node.label }}</span>
        <span class="tree-node-kind">{{ node.kind }}<template v-if="node.at"> · {{ node.at.slice(0, 10) }}</template></span>
      </button>
      <div
        v-if="opened && byId.get(opened)"
        class="tree-node-detail"
        :style="{ left: `${x(byId.get(opened)!)}px`, top: `${y(byId.get(opened)!) + NODE_HEIGHT + 6}px`, width: `${NODE_WIDTH}px` }"
      >
        <!-- Every node opens, including one whose field was never written:
             "not recorded" is the honest answer and a node that refused to
             open would look like a bug rather than an absence. -->
        <p v-if="byId.get(opened)!.detail" class="tree-detail-text">{{ byId.get(opened)!.detail }}</p>
        <p v-else class="absent">not recorded</p>
      </div>
    </div>
  </div>
</template>
