<script setup lang="ts">
import type { AgentSummary } from "../../shared/types.ts";
import AgentCard from "./AgentCard.vue";
defineProps<{ agents: AgentSummary[] }>();
</script>
<template><section class="agent-roster"><h2>Agent roster</h2><p v-if="!agents.length" class="empty-note">No agent roster has been recorded.</p><div class="agent-cards"><AgentCard v-for="(agent, index) in agents" :key="agent.agent" :agent="agent" :index="index" /></div></section></template>
