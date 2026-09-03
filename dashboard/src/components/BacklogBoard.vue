<script setup lang="ts">
import type { BacklogTicket, TicketState } from "../../shared/types.ts";
import type { BacklogGroup } from "../backlog-selection.ts";
import TicketCard from "./TicketCard.vue";

const props = defineProps<{
  groups: readonly BacklogGroup[];
  collapsed: readonly string[];
}>();
const emit = defineEmits<{
  open: [ticket: BacklogTicket];
  "toggle-plan": [planId: string];
}>();
const states: readonly TicketState[] = ["todo", "wip", "done", "failed"];

function isCollapsed(planId: string): boolean {
  return props.collapsed.includes(planId);
}
</script>

<template>
  <section class="backlog-groups" aria-label="Selected plan backlogs">
    <article
      v-for="group in props.groups"
      :key="group.plan.id"
      class="backlog-plan-group"
      :class="{ collapsed: isCollapsed(group.plan.id) }"
    >
      <header class="backlog-plan-heading">
        <h2>
          <button
            type="button"
            class="backlog-plan-toggle"
            :aria-expanded="!isCollapsed(group.plan.id)"
            @click="emit('toggle-plan', group.plan.id)"
          >
            {{ group.plan.name }}
          </button>
        </h2>
        <template v-if="!isCollapsed(group.plan.id)">
          <span class="plan-label">{{ group.plan.kind }}</span>
          <span v-if="group.plan.kind === 'deep'" class="parent-spine-label">parent: {{ group.plan.parentSpineName ?? group.plan.parentSpine }}</span>
        </template>
        <span v-else class="collapsed-plan-counts" aria-label="Ticket state counts">
          <span v-for="state in states" :key="state"><b>{{ group.plan.counts[state] }}</b> {{ state }}</span>
        </span>
      </header>
      <div v-if="!isCollapsed(group.plan.id)" class="backlog-board">
        <section v-for="state in states" :key="state" class="backlog-column">
          <h3>{{ state }} <span>{{ group.plan.counts[state] }}</span></h3>
          <TicketCard
            v-for="ticket in group.tickets.filter((candidate) => candidate.state === state)"
            :key="ticket.uid"
            :ticket="ticket"
            @open="emit('open', $event)"
          />
        </section>
      </div>
    </article>
  </section>
</template>
