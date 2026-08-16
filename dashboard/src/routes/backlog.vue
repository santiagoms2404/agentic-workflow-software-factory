<script setup lang="ts">
import type { TicketsResponse } from "../../shared/types.ts";
import BacklogBoard from "../components/BacklogBoard.vue";
import BacklogMetricsRow from "../components/BacklogMetricsRow.vue";
defineProps<{ backlog: TicketsResponse }>();
</script>
<template>
  <main class="backlog-route">
    <header><p class="eyebrow">read-only work queue</p><h1>Backlog</h1></header>
    <BacklogMetricsRow :backlog="backlog" />
    <BacklogBoard :tickets="backlog.tickets" :counts="backlog.counts.state" />
  </main>
</template>
