<script setup lang="ts">
import type { SessionCard as Session } from "../../shared/types.ts";
import SessionCard from "./SessionCard.vue";
defineProps<{ sessions: Session[] }>();
</script>
<template><section><p class="run-count">{{ sessions.length }} runs</p><div class="sessions-grid"><SessionCard v-for="session in sessions" :key="session.sessionId" :session="session" /></div></section></template>
