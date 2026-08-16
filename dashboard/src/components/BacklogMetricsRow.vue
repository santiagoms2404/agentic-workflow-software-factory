<script setup lang="ts">
import type { TicketsResponse } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost } from "../display.ts";
const props = defineProps<{ backlog: TicketsResponse }>();
const costLabel = () => props.backlog.projectedCost.partial ? "partial" : costAuthorityLabel(props.backlog.projectedCost.authority);
</script>
<template>
  <dl class="backlog-metrics">
    <div><dt>ready</dt><dd>{{ backlog.ready.length }}</dd></div>
    <div><dt>blocked</dt><dd>{{ backlog.tickets.length - backlog.ready.length }}</dd></div>
    <div><dt>projected cost</dt><dd>{{ backlog.projectedCost.partial ? '— partial' : formatCost(backlog.projectedCost.authority, backlog.projectedCost.usd) }} <small>{{ costLabel() }}</small></dd></div>
  </dl>
</template>
