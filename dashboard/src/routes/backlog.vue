<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BacklogTicket, LightTicketSourceResponse, TicketSourceResponse, TicketsResponse } from "../../shared/types.ts";
import { initialPlanSelection, lightGroup, togglePlan, visibleGroups as selectVisibleGroups, type PlanFilter } from "../backlog-selection.ts";
import { admitNewFilterValues } from "../session-filters.ts";
import BacklogBoard from "../components/BacklogBoard.vue";
import BacklogMetricsRow from "../components/BacklogMetricsRow.vue";
import PlanCardRow from "../components/PlanCardRow.vue";
import TicketSourceOverlay from "../components/TicketSourceOverlay.vue";

const props = defineProps<{ backlog: TicketsResponse; plan?: string | null }>();
const selectedPlans = ref<readonly string[]>([]);
const collapsedPlans = ref<readonly string[]>([]);
const expandedColumns = ref<readonly string[]>([]);
let knownPlans: readonly string[] = [];
let hasSeededSelection = false;
/** The plan the URL named when the selection was last seeded. */
let appliedRequest: string | null = null;
const planFilter = ref<PlanFilter>("both");
const activeTicket = ref<{ ticket: BacklogTicket; light: boolean } | null>(null);
const lightCollapsed = ref(false);
const lightExpandedColumns = ref<readonly string[]>([]);
const ticketSources = ref<Readonly<Record<string, string>>>({});
const loadingSources = ref<readonly string[]>([]);
const sourceErrors = ref<Readonly<Record<string, string>>>({});

watch(
  () => [props.backlog.plans, props.plan] as const,
  ([plans, requested]) => {
    if (plans.length === 0) return;
    const currentPlanIds = plans.map((plan) => plan.id);
    const requestedId = requested ?? null;
    // A different plan in the URL reselects, as a fresh visit would. The same
    // request arriving again on a poll does not, so the reader's choice holds.
    if (!hasSeededSelection || requestedId !== appliedRequest) {
      selectedPlans.value = initialPlanSelection(plans, requestedId);
      hasSeededSelection = true;
      appliedRequest = requestedId;
    } else {
      selectedPlans.value = admitNewFilterValues(knownPlans, currentPlanIds, selectedPlans.value);
    }
    knownPlans = currentPlanIds;
  },
  { immediate: true },
);

const groups = computed(() => selectVisibleGroups(
  props.backlog.plans,
  props.backlog.tickets,
  selectedPlans.value,
  planFilter.value,
));

const light = computed(() => lightGroup(props.backlog.light));

function sourceKey(ticket: BacklogTicket, light: boolean): string {
  return `${light ? "light" : "plan"}:${ticket.uid}`;
}

const activeSourceKey = computed(() => activeTicket.value === null ? "" : sourceKey(activeTicket.value.ticket, activeTicket.value.light));

async function loadSource(ticket: BacklogTicket, refresh = false, light = false): Promise<void> {
  const key = sourceKey(ticket, light);
  if (!refresh && ticketSources.value[key] !== undefined) return;
  if (loadingSources.value.includes(key)) return;
  if (refresh) {
    const { [key]: _priorSource, ...remainingSources } = ticketSources.value;
    ticketSources.value = remainingSources;
  }
  loadingSources.value = [...loadingSources.value, key];
  const { [key]: _priorError, ...remainingErrors } = sourceErrors.value;
  sourceErrors.value = remainingErrors;
  try {
    const response = await fetch(light
      ? `/api/v1/tickets?light=${encodeURIComponent(ticket.id)}`
      : `/api/v1/tickets?plan=${encodeURIComponent(ticket.plan)}&ticket=${encodeURIComponent(ticket.id)}`);
    if (!response.ok) throw new Error("Ticket source unavailable");
    const payload = await response.json() as TicketSourceResponse | LightTicketSourceResponse;
    if (payload.uid !== ticket.uid || ("light" in payload) !== light) {
      throw new Error("Ticket source did not match the selected ticket");
    }
    ticketSources.value = { ...ticketSources.value, [key]: payload.source };
  } catch (error) {
    sourceErrors.value = {
      ...sourceErrors.value,
      [key]: error instanceof Error ? error.message : "Ticket source unavailable",
    };
  } finally {
    loadingSources.value = loadingSources.value.filter((pending) => pending !== key);
  }
}

function toggleCollapsedPlan(planId: string): void {
  collapsedPlans.value = togglePlan(collapsedPlans.value, planId);
}

function toggleExpandedColumn(columnId: string): void {
  expandedColumns.value = togglePlan(expandedColumns.value, columnId);
}

function openTicket(ticket: BacklogTicket): void {
  void loadSource(ticket, true);
  activeTicket.value = { ticket, light: false };
}

function openLightTicket(ticket: BacklogTicket): void {
  activeTicket.value = { ticket, light: true };
  void loadSource(ticket, true, true);
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
    <div class="backlog-content">
      <BacklogBoard
        :groups="groups"
        :collapsed="collapsedPlans"
        :expanded-columns="expandedColumns"
        @toggle-plan="toggleCollapsedPlan"
        @toggle-column="toggleExpandedColumn"
        @open="openTicket"
      />
      <BacklogBoard
        v-if="light"
        :groups="[light]"
        label="Light tickets"
        :collapsed="lightCollapsed ? [light.plan.id] : []"
        :expanded-columns="lightExpandedColumns"
        @toggle-plan="lightCollapsed = !lightCollapsed"
        @toggle-column="lightExpandedColumns = togglePlan(lightExpandedColumns, $event)"
        @open="openLightTicket"
      />
      <ul v-if="backlog.light?.invalid.length" class="ticket-source-error" aria-label="Invalid light tickets">
        <li v-for="entry in backlog.light.invalid" :key="entry.file">
          <code>{{ entry.file }}</code> — invalid: {{ entry.violations.join('; ') }}
        </li>
      </ul>
      <p v-if="backlog.light?.error" class="ticket-source-error">Light tickets unavailable: {{ backlog.light.error }}</p>
    </div>
    <TicketSourceOverlay
      v-if="activeTicket"
      :ticket="activeTicket.ticket"
      :label="activeTicket.light ? light?.label ?? 'light tier' : activeTicket.ticket.plan"
      :source="ticketSources[activeSourceKey]"
      :loading="loadingSources.includes(activeSourceKey)"
      :error="sourceErrors[activeSourceKey]"
      @close="closeTicket"
    />
  </main>
</template>
