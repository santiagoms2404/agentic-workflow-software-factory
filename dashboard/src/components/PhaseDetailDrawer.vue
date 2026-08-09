<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import type { PhaseDetailResponse } from "../../shared/types.ts";
import PhaseInspector from "./PhaseInspector.vue";
import EventLog from "./EventLog.vue";
const props = defineProps<{ detail: PhaseDetailResponse; sessionId: string }>();
const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement | null>(null);
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
function close() { emit("close"); opener?.focus(); }
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const nodes = [...document.querySelectorAll<HTMLElement>(".phase-drawer button, .phase-drawer a, .phase-drawer [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hasAttribute("disabled"));
  const first = nodes[0]; const last = nodes.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(async () => { document.addEventListener("keydown", onKeydown); await nextTick(); closeButton.value?.focus(); });
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>
<template>
  <div class="drawer-backdrop" @click.self="close">
    <aside class="phase-drawer" role="dialog" aria-modal="true" :aria-labelledby="`phase-${detail.phase.phaseId}`">
      <header><div><p class="eyebrow">Phase inspector</p><h2 :id="`phase-${detail.phase.phaseId}`">{{ detail.phase.name }}</h2></div><button ref="closeButton" class="drawer-close" type="button" aria-label="Close phase inspector" @click="close">×</button></header>
      <div class="drawer-columns"><PhaseInspector :detail="detail" /><EventLog :session-id="sessionId" /></div>
    </aside>
  </div>
</template>
