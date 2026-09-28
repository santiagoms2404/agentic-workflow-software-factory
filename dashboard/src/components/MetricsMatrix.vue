<script setup lang="ts">
import { computed } from "vue";
import { ring } from "../metrics-chart.ts";
import { depthLegend, tileLabel, type Matrix } from "../metrics-matrix.ts";

const props = defineProps<{
  matrix: Matrix;
  showUntested: boolean;
  /** Role name to its configured colour. */
  roleColors: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{
  open: [role: string, routeKey: string];
  "toggle-untested": [];
}>();

const RING_RADIUS = 15;
const legend = depthLegend();
const gridStyle = computed(() => ({ "--matrix-columns": String(props.matrix.columns.length) }));

function roleDot(role: string): string {
  return props.roleColors[role] ?? "var(--faint)";
}
</script>

<template>
  <div class="matrix-view">
    <header class="metrics-view-head">
      <h2 class="metrics-view-title">Route × role</h2>
      <p class="metrics-view-lede">Ring: first-pass yield of settled rows. Red badge: role-rows blocked in this role's phase with a model attribution. Depth: how tight the evidence is.</p>
    </header>

    <div class="matrix-legend-bar">
      <ul class="matrix-legend" aria-label="Depth legend">
        <li v-for="entry in legend" :key="entry.depth">
          <i class="matrix-legend-swatch" :class="`depth-${entry.depth}`" aria-hidden="true" />
          <span>{{ entry.text }}</span>
        </li>
      </ul>
      <button
        type="button"
        class="metrics-pill"
        :aria-pressed="showUntested"
        :disabled="matrix.untestedAvailable === 0 && !showUntested"
        :title="matrix.untestedAvailable === 0 ? 'Every offered route has runs' : 'Routes offered but never run, with their public prior'"
        @click="emit('toggle-untested')"
      >Show untested routes</button>
    </div>

    <p v-if="matrix.rows.length === 0" class="metrics-note">No role-row in the lens ran on a single route.</p>
    <div v-else class="matrix-scroll">
      <div class="matrix-grid" :style="gridStyle" role="table" aria-label="Routes by role">
        <div class="matrix-head" role="row">
          <span class="matrix-corner" role="columnheader"><span class="metrics-sr">Route</span></span>
          <span v-for="role in matrix.columns" :key="role" class="matrix-role" role="columnheader">
            <i class="metrics-dot" :style="{ background: roleDot(role) }" aria-hidden="true" />{{ role === "architecture-reviewer" ? "arch-review" : role }}
          </span>
        </div>
        <div v-for="row in matrix.rows" :key="row.key" class="matrix-row" :class="{ untested: !row.tested }" role="row">
          <div class="matrix-route" role="rowheader">
            <span class="matrix-route-title">
              <svg v-if="row.provider === 'openai'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" /></svg>
              <svg v-else-if="row.provider === 'anthropic'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg>
              {{ row.title }}
            </span>
            <span class="matrix-route-detail">{{ row.detail }}</span>
          </div>
          <template v-for="(tile, index) in row.tiles" :key="`${row.key}:${matrix.columns[index]}`">
            <div v-if="tile === null" class="matrix-tile depth-sunk empty" role="cell">no runs</div>
            <div v-else class="matrix-cell" role="cell">
              <button
                type="button"
                class="matrix-tile"
                :class="`depth-${tile.depth}`"
                :aria-label="tileLabel(row, tile)"
                @click="emit('open', tile.role, tile.key)"
              >
                <span v-if="tile.blockedHere > 0" class="matrix-badge" aria-hidden="true">{{ tile.blockedHere }}</span>
                <svg class="matrix-ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle class="matrix-ring-track" cx="20" cy="20" :r="RING_RADIUS" />
                  <circle
                    class="matrix-ring-arc"
                    cx="20"
                    cy="20"
                    :r="RING_RADIUS"
                    :stroke-dasharray="ring(tile.firstPass, RING_RADIUS).dasharray"
                    transform="rotate(-90 20 20)"
                  />
                  <text x="20" y="20" dominant-baseline="central" text-anchor="middle">{{ ring(tile.firstPass, RING_RADIUS).text }}</text>
                </svg>
                <span class="matrix-tile-count">n {{ tile.n }} · {{ tile.landed }} landed</span>
                <span class="matrix-tile-price">{{ tile.perRow }}</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
    <p v-if="matrix.unkeyed > 0" class="metrics-note">{{ matrix.unkeyed }} role-rows in the lens ran on more than one route and enter no tile.</p>
  </div>
</template>
