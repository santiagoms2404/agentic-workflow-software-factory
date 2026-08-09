<script setup lang="ts">
import type { SessionDetailResponse } from "../../shared/types.ts";
import SessionHeader from "./SessionHeader.vue";
import StateRibbon from "./StateRibbon.vue";
import AgentRoster from "./AgentRoster.vue";
import SwimlaneChart from "./SwimlaneChart.vue";
import { ref } from "vue";
import OwnerGateCard from "./OwnerGateCard.vue";
import PhaseDetailDrawer from "./PhaseDetailDrawer.vue";
const props = defineProps<{ session: SessionDetailResponse }>();
const selectedPhase = ref<string | null>(null);
const detail = ref<import("../../shared/types.ts").PhaseDetailResponse | null>(null);
async function inspect(phaseId: string) {
  const response = await fetch(`/api/v1/sessions/${encodeURIComponent(props.session.sessionId)}/phases/${encodeURIComponent(phaseId)}`);
  if (response.ok) { detail.value = await response.json() as import("../../shared/types.ts").PhaseDetailResponse; selectedPhase.value = phaseId; }
}
function closeDrawer() { selectedPhase.value = null; detail.value = null; }
</script>
<template>
  <main class="session-route">
    <a class="back-link" href="#/sessions">← All sessions</a>
    <SessionHeader :session="session" />
    <StateRibbon :state="session.state" :transitions="session.transitions" />
    <AgentRoster :agents="session.agents" />
    <SwimlaneChart :session="session" @inspect="inspect" />
    <OwnerGateCard v-if="session.state === 'AWAITING_OWNER'" :session="session" />
    <PhaseDetailDrawer v-if="selectedPhase && detail" :detail="detail" :session-id="session.sessionId" @close="closeDrawer" />
  </main>
</template>
