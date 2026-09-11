<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BacklogTicket, TicketSourceResponse, TicketsResponse } from "../../shared/types.ts";
import { initialPlanSelection, togglePlan, visibleGroups as selectVisibleGroups, type PlanFilter } from "../backlog-selection.ts";
import BacklogBoard from "../components/BacklogBoard.vue";
import BacklogMetricsRow from "../components/BacklogMetricsRow.vue";
import PlanCardRow from "../components/PlanCardRow.vue";
import TicketSourceOverlay from "../components/TicketSourceOverlay.vue";

const props = defineProps<{ backlog: TicketsResponse; plan?: string | null }>();
const selectedPlans = ref<readonly string[]>([]);
const collapsedPlans = ref<readonly string[]>([]);
const expandedColumns = ref<readonly string[]>([]);
let hasSeededSelection = false;
const planFilter = ref<PlanFilter>("both");
const activeTicket = ref<BacklogTicket | null>(null);
const ticketSources = ref<Readonly<Record<string, string>>>({});
const loadingSources = ref<readonly string[]>([]);
const sourceErrors = ref<Readonly<Record<string, string>>>({});

watch(
  () => [props.backlog.plans, props.plan] as const,
  ([plans, requested]) => {
    if (hasSeededSelection || plans.length === 0) return;
    selectedPlans.value = initialPlanSelection(plans, requested);
    hasSeededSelection = true;
  },
  { immediate: true },
);

const groups = computed(() => selectVisibleGroups(
  props.backlog.plans,
  props.backlog.tickets,
  selectedPlans.value,
  planFilter.value,
));

async function loadSource(ticket: BacklogTicket): Promise<void> {
  if (ticketSources.value[ticket.uid] !== undefined || loadingSources.value.includes(ticket.uid)) return;
  loadingSources.value = [...loadingSources.value, ticket.uid];
  const { [ticket.uid]: _priorError, ...remainingErrors } = sourceErrors.value;
  sourceErrors.value = remainingErrors;
  try {
    const response = await fetch(`/api/v1/tickets?plan=${encodeURIComponent(ticket.plan)}&ticket=${encodeURIComponent(ticket.id)}`);
    if (!response.ok) throw new Error("Ticket source unavailable");
    const payload = await response.json() as TicketSourceResponse;
    if (payload.uid !== ticket.uid) throw new Error("Ticket source did not match the selected ticket");
    ticketSources.value = { ...ticketSources.value, [ticket.uid]: payload.source };
  } catch (error) {
    sourceErrors.value = {
      ...sourceErrors.value,
      [ticket.uid]: error instanceof Error ? error.message : "Ticket source unavailable",
    };
  } finally {
    loadingSources.value = loadingSources.value.filter((uid) => uid !== ticket.uid);
  }
}

function toggleCollapsedPlan(planId: string): void {
  collapsedPlans.value = togglePlan(collapsedPlans.value, planId);
}

function toggleExpandedColumn(columnId: string): void {
  expandedColumns.value = togglePlan(expandedColumns.value, columnId);
}

function openTicket(ticket: BacklogTicket): void {
  activeTicket.value = ticket;
  void loadSource(ticket);
}

function closeTicket(): void {
  activeTicket.value = null;
}
</script>

<template>
  <main class="backlog-route backlog-shell">
    <div class="backlog-rail">
      <header class="backlog-head"><p class="eyebrow">read-only work queue</p><h1>Backlog</h1></header>
      <BacklogMetricsRow :groups="groups" :projected-cost="backlog.projectedCost" />
    </div>
    <PlanCardRow v-model:selected="selectedPlans" v-model:filter="planFilter" :plans="backlog.plans" />
    <BacklogBoard
      :groups="groups"
      :collapsed="collapsedPlans"
      :expanded-columns="expandedColumns"
      @toggle-plan="toggleCollapsedPlan"
      @toggle-column="toggleExpandedColumn"
      @open="openTicket"
    />
    <TicketSourceOverlay
      v-if="activeTicket"
      :ticket="activeTicket"
      :source="ticketSources[activeTicket.uid]"
      :loading="loadingSources.includes(activeTicket.uid)"
      :error="sourceErrors[activeTicket.uid]"
      @close="closeTicket"
    />
  </main>
</template>
