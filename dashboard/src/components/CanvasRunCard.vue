<script setup lang="ts">
import { computed } from "vue";
import type { PhaseSummary, SessionCard as Session } from "../../shared/types.ts";
import { costAuthorityLabel, formatCalls, formatCost, formatDate, formatDuration, formatUsage, shortSessionId, stateLabel, stateTone } from "../display.ts";

const props = defineProps<{ session: Session; middle: boolean }>();

/**
 * The run, drawn as a pipeline rather than as the board's card.
 *
 * Deliberately not `SessionCard.vue`. The wheel is a sequence of runs and the
 * middle one is the one you came to read, so it leads with the phases laid out
 * left to right — the same pipeline idea one zoom level in — instead of the
 * board's lane chart, which answers "when did things happen" rather than "what
 * did this run do".
 */
const phases = computed(() => props.session.phases);
const runtimeEnd = computed(() => props.session.endedAt ?? props.session.updatedAt);

function glyph(phase: PhaseSummary): string {
  if (phase.status === "SUCCEEDED") return "●";
  if (["FAILED", "CANCELLED"].includes(phase.status)) return "×";
  if (["RUNNING", "VALIDATING", "CORRECTING"].includes(phase.status)) return "◐";
  return "○";
}
</script>

<template>
  <article class="wheel-card" :class="{ middle }">
    <header class="wheel-card-head">
      <p class="wheel-card-voice">
        <code>{{ shortSessionId(session.sessionId) }}</code>
        · attempt {{ session.attempt }} · {{ formatDate(session.startedAt) }}
      </p>
      <h3 class="wheel-card-title">{{ session.taskId }}</h3>
      <span class="state-chip" :class="stateTone(session.state)">{{ stateLabel(session.state) }}</span>
    </header>

    <!-- Only the middle card is read; its neighbours are there to say what is
         next and what came before, so they carry a name and a state and stop. -->
    <template v-if="middle">
      <p class="wheel-card-request">{{ session.request }}</p>

      <div class="wheel-card-pipeline" :aria-label="`${phases.length} phases, in order`">
        <p v-if="!phases.length" class="absent">No phase ran in this attempt.</p>
        <span
          v-for="phase in phases"
          :key="phase.phaseId"
          class="wheel-phase"
          :class="phase.status.toLowerCase()"
          :title="`${phase.name} — ${phase.status}`"
        >
          <span class="wheel-phase-glyph" aria-hidden="true">{{ glyph(phase) }}</span>
          <span class="wheel-phase-name">{{ phase.name }}</span>
        </span>
      </div>

      <dl class="wheel-card-metrics">
        <div><dt>cost</dt><dd>{{ formatCost(session.usage.costAuthority, session.usage.estimatedCostUsd) }} <small>{{ costAuthorityLabel(session.usage.costAuthority) }}</small></dd></div>
        <div><dt>runtime</dt><dd>{{ formatDuration(session.startedAt, runtimeEnd) }}</dd></div>
        <div><dt>usage</dt><dd>{{ formatUsage(session.usage) }}</dd></div>
        <div><dt>calls</dt><dd>{{ formatCalls(session.callsSpent, session.callCeiling) }}</dd></div>
      </dl>

      <!-- The one-line plain-language summary belongs here. A separate stream
           writes it; the place it sits says so rather than being filled. -->
      <p class="wheel-card-summary absent">no summary written yet</p>

      <a class="session-filter-control wheel-card-open" :href="`#/sessions/${encodeURIComponent(session.sessionId)}`">
        the full run
      </a>
    </template>
  </article>
</template>
