<script setup lang="ts">
import type { BacklogTicket, TicketState } from "../../shared/types.ts";
import type { BacklogGroup } from "../backlog-selection.ts";
import TicketCard from "./TicketCard.vue";

const props = defineProps<{ groups: readonly BacklogGroup[] }>();
const emit = defineEmits<{ open: [ticket: BacklogTicket] }>();
const states: readonly TicketState[] = ["todo", "wip", "done", "failed"];
</script>

<template>
  <section class="backlog-groups" aria-label="Selected plan backlogs">
    <article v-for="group in props.groups" :key="group.plan.id" class="backlog-plan-group">
      <header class="backlog-plan-heading">
        <h2>{{ group.plan.name }}</h2>
        <span class="plan-label">{{ group.plan.kind }}</span>
        <span v-if="group.plan.kind === 'deep'" class="parent-spine-label">parent: {{ group.plan.parentSpineName ?? group.plan.parentSpine }}</span>
      </header>
      <div class="backlog-board">
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
