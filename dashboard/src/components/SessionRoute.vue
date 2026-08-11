<script setup lang="ts">
import { ref, watch } from "vue";
import type { PhaseDetailResponse, SessionDetailResponse } from "../../shared/types.ts";
import AgentRoster from "./AgentRoster.vue";
import OwnerGateCard from "./OwnerGateCard.vue";
import PhaseDetailDrawer from "./PhaseDetailDrawer.vue";
import SessionHeader from "./SessionHeader.vue";
import StateRibbon from "./StateRibbon.vue";
import SwimlaneChart from "./SwimlaneChart.vue";

const props = defineProps<{ session: SessionDetailResponse; selectedPhaseId: string | null }>();
const detail = ref<PhaseDetailResponse | null>(null);
const loadingPhase = ref(false);
const phaseError = ref<string | null>(null);

async function loadPhase(): Promise<void> {
  const phaseId = props.selectedPhaseId;
  if (phaseId === null) { detail.value = null; phaseError.value = null; return; }
  loadingPhase.value = true;
  phaseError.value = null;
  try {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(props.session.sessionId)}/phases/${encodeURIComponent(phaseId)}`);
    if (!response.ok) throw new Error("Phase evidence unavailable");
    detail.value = await response.json() as PhaseDetailResponse;
  } catch (reason) {
    phaseError.value = reason instanceof Error ? reason.message : "Phase evidence unavailable";
  } finally { loadingPhase.value = false; }
}
watch([() => props.selectedPhaseId, () => props.session.stateRevision], () => void loadPhase(), { immediate: true });

function inspect(phaseId: string): void {
  location.hash = `#/sessions/${encodeURIComponent(props.session.sessionId)}/phases/${encodeURIComponent(phaseId)}`;
}
function closeDetail(): void {
  location.hash = `#/sessions/${encodeURIComponent(props.session.sessionId)}`;
}
</script>

<template>
  <main class="session-route">
    <SessionHeader :session="session" />
    <StateRibbon :state="session.state" :transitions="session.transitions" />
    <AgentRoster :agents="session.agents" />
    <SwimlaneChart :session="session" :selected-phase-id="selectedPhaseId" @inspect="inspect" />
    <p v-if="phaseError" class="error-bar" role="alert">{{ phaseError }}</p>
    <p v-else-if="loadingPhase && !detail" class="phase-loading" role="status">Loading phase evidence…</p>
    <PhaseDetailDrawer v-if="selectedPhaseId && detail" :detail="detail" :session-id="session.sessionId" @close="closeDetail" />
    <OwnerGateCard v-if="session.state === 'AWAITING_OWNER'" :session="session" />
  </main>
</template>
