<script setup lang="ts">
import type { SessionCard as Session } from "../../shared/types.ts";
import SessionCard from "./SessionCard.vue";
defineProps<{ sessions: Session[] }>();
</script>
<template>
  <section aria-labelledby="sessions-title">
    <h1 id="sessions-title" class="run-count">{{ sessions.length }} runs</h1>
    <div v-if="sessions.length" class="sessions-grid"><SessionCard v-for="session in sessions" :key="session.sessionId" :session="session" /></div>
    <p v-else class="empty-note run-count">No sessions yet. Start an AWSF attempt in the terminal to see it here.</p>
  </section>
</template>
