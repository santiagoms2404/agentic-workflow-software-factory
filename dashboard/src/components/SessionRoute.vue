<script setup lang="ts">
import type { SessionDetailResponse } from "../../shared/types.ts";
import SessionHeader from "./SessionHeader.vue";
import StateRibbon from "./StateRibbon.vue";
import AgentRoster from "./AgentRoster.vue";
import SwimlaneChart from "./SwimlaneChart.vue";
import OwnerGateCard from "./OwnerGateCard.vue";
defineProps<{ session: SessionDetailResponse }>();
</script>
<template>
  <main class="session-route">
    <a class="back-link" href="#/sessions">← All sessions</a>
    <SessionHeader :session="session" />
    <StateRibbon :state="session.state" :transitions="session.transitions" />
    <AgentRoster :agents="session.agents" />
    <SwimlaneChart :session="session" />
    <OwnerGateCard v-if="session.state === 'AWAITING_OWNER'" :session="session" />
  </main>
</template>
