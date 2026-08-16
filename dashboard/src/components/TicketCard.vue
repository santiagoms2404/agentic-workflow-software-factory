<script setup lang="ts">
import type { BacklogTicket } from "../../shared/types.ts";
defineProps<{ ticket: BacklogTicket }>();
</script>
<template>
  <article class="ticket-card" :class="{ ready: ticket.ready }">
    <header><code>{{ ticket.id }}</code><span class="tier-chip">T{{ ticket.tier }}</span></header>
    <strong>{{ ticket.title }}</strong>
    <small>{{ ticket.milestone }} · {{ ticket.workflow }}</small>
    <p :class="ticket.ready ? 'ready-label' : 'blocked-label'">{{ ticket.ready ? 'ready' : 'blocked' }}</p>
  </article>
</template>
