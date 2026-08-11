<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import type { PhaseDetailResponse } from "../../shared/types.ts";
import EventLog from "./EventLog.vue";
import PhaseInspector from "./PhaseInspector.vue";

const props = defineProps<{ detail: PhaseDetailResponse; sessionId: string }>();
const emit = defineEmits<{ close: [] }>();
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
function close(): void { emit("close"); requestAnimationFrame(() => opener?.focus()); }
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.preventDefault(); close(); }
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <section class="inline-phase-detail" :aria-labelledby="`phase-${detail.phase.phaseId}`">
    <header class="phase-detail-head">
      <div>
        <span class="eyebrow">Selected phase evidence</span>
        <h2 :id="`phase-${detail.phase.phaseId}`">{{ detail.phase.name }}</h2>
      </div>
      <span class="phase-status" :class="detail.phase.status.toLowerCase()">{{ detail.phase.status }}</span>
      <span class="phase-meta">owner {{ detail.phase.owner }} · kind {{ detail.phase.kind }} · corrections {{ detail.phase.correctionCount }}/{{ detail.phase.maxCorrections }}</span>
      <button class="detail-close" type="button" aria-label="Close selected phase" @click="close">×</button>
    </header>
    <div class="phase-detail-columns">
      <PhaseInspector :detail="props.detail" />
      <EventLog :session-id="sessionId" :phase-id="detail.phase.phaseId" />
    </div>
  </section>
</template>
