<script setup lang="ts">
import { computed } from "vue";
import type { BacklogTicket } from "../../shared/types.ts";
import TicketCard from "./TicketCard.vue";
const props = defineProps<{ tickets: readonly BacklogTicket[]; counts: Record<BacklogTicket["state"], number> }>();
const states: BacklogTicket["state"][] = ["todo", "wip", "done", "failed"];
const columns = computed(() => states.map((state) => ({ state, count: props.counts[state], tickets: props.tickets.filter((ticket) => ticket.state === state) })));
</script>
<template>
  <section class="backlog-board" aria-label="Backlog board">
    <div v-for="column in columns" :key="column.state" class="backlog-column">
      <h2>{{ column.state }} <span>{{ column.count }}</span></h2>
      <TicketCard v-for="ticket in column.tickets" :key="ticket.id" :ticket="ticket" />
    </div>
  </section>
</template>
