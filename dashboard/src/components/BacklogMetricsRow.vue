<script setup lang="ts">
import { computed } from "vue";
import type { TicketsResponse } from "../../shared/types.ts";
import type { BacklogGroup } from "../backlog-selection.ts";
import { countBlockedTickets, projectedCostText } from "../backlog-view.ts";
import { costAuthorityLabel, formatCost } from "../display.ts";

const props = defineProps<{
  groups: readonly BacklogGroup[];
  projectedCost: TicketsResponse["projectedCost"];
}>();
const tickets = computed(() => props.groups.flatMap((group) => group.tickets));
const ready = computed(() => tickets.value.filter((ticket) => ticket.ready).length);
const blocked = computed(() => countBlockedTickets(tickets.value));
const unavailableCost = computed(() => projectedCostText(props.projectedCost));
</script>

<template>
  <dl class="backlog-metrics">
    <div><dt>ready</dt><dd>{{ ready }}</dd></div>
    <div><dt>blocked</dt><dd>{{ blocked }}</dd></div>
    <div>
      <dt>projected cost</dt>
      <dd v-if="unavailableCost">{{ unavailableCost }}</dd>
      <dd v-else>{{ formatCost(projectedCost.authority, projectedCost.usd) }} <small>{{ costAuthorityLabel(projectedCost.authority) }}</small></dd>
    </div>
  </dl>
</template>
