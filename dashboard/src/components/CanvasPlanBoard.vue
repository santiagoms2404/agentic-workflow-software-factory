<script setup lang="ts">
import { computed } from "vue";
import type { BacklogTicket, SessionCard, SessionPlan } from "../../shared/types.ts";
import { planBoard, TICKET_STATES, waitingOn } from "../canvas-plan.ts";
import { formatDate, shortSessionId, stateLabel, stateTone } from "../display.ts";

const props = defineProps<{
  plan: SessionPlan;
  tickets: readonly BacklogTicket[];
  sessions: readonly SessionCard[];
}>();

const board = computed(() => planBoard(props.tickets, props.sessions, props.plan.id));

function blockers(ticket: BacklogTicket): readonly string[] {
  return waitingOn(ticket, props.tickets.filter((candidate) => candidate.plan === ticket.plan));
}
</script>

<template>
  <div class="plan-board">
    <p class="plan-board-counts">
      <span><b>{{ board.tickets }}</b> tickets</span>
      <span v-for="state in TICKET_STATES" :key="state"><b>{{ board.counts[state] }}</b> {{ state }}</span>
      <span><b>{{ board.runs.length }}</b> run(s) came from this plan</span>
      <!-- The plan's own prose lives in its tickets, and the backlog already
           shows each one byte-for-byte. That is the way to the full text; the
           plan file itself is not served, and adding a route for it would be a
           deliberate hole in a read surface kept narrow on purpose. -->
      <a class="plan-board-source" :href="`#/backlog/${encodeURIComponent(plan.id)}`">every ticket in the backlog ↗</a>
    </p>

    <p v-if="!board.milestones.length" class="absent">
      No ticket is registered against this plan.
    </p>

    <div v-else class="plan-board-grid">
      <!-- Milestones in the plan's own order, as columns; tickets as rows on
           them. A column is a recessed well and every ticket on it is a raised
           pill, which is the shape a list of things takes everywhere here. -->
      <section
        v-for="milestone in board.milestones"
        :key="milestone.name"
        class="plan-milestone neu-well"
        :aria-label="`Milestone ${milestone.name}`"
      >
        <header class="plan-milestone-head">
          <h3>{{ milestone.name }}</h3>
          <p class="plan-milestone-counts">
            <span v-for="state in TICKET_STATES" :key="state" v-show="milestone.counts[state]">
              {{ milestone.counts[state] }} {{ state }}
            </span>
          </p>
        </header>
        <article
          v-for="ticket in milestone.tickets"
          :key="ticket.uid"
          class="plan-ticket"
          :class="[`ticket-${ticket.state}`, { ready: ticket.ready && ticket.state === 'todo' }]"
        >
          <p class="plan-ticket-head">
            <code>{{ ticket.id }}</code>
            <span class="plan-ticket-state">{{ ticket.state }}</span>
            <span v-if="ticket.tier !== undefined" class="plan-ticket-tier">T{{ ticket.tier }}</span>
          </p>
          <p class="plan-ticket-title">{{ ticket.title }}</p>
          <p v-if="blockers(ticket).length" class="plan-ticket-waiting absent">
            waiting on {{ blockers(ticket).join(", ") }}
          </p>
          <p v-else-if="ticket.state === 'todo'" class="plan-ticket-waiting">ready</p>
        </article>
      </section>
    </div>

    <!-- Beside the tickets, never on them: a run records which plan it came
         from and no ticket, so a line from one ticket to one run could only
         come from matching names. -->
    <section v-if="board.runs.length" class="plan-runs neu-well" aria-label="Runs from this plan">
      <div class="session-filter-heading">
        <h3>Runs from this plan</h3>
        <span class="plan-runs-note">recorded at the plan, not at a ticket</span>
      </div>
      <div class="plan-runs-list">
        <a
          v-for="run in board.runs"
          :key="run.sessionId"
          class="plan-run session-filter-option"
          :href="`#/sessions/${encodeURIComponent(run.sessionId)}`"
        >
          <code>{{ shortSessionId(run.sessionId) }}</code>
          <span class="plan-run-task">{{ run.taskId }}</span>
          <span class="state-chip" :class="stateTone(run.state)">{{ stateLabel(run.state) }}</span>
          <span class="plan-run-date">{{ formatDate(run.startedAt) }}</span>
        </a>
      </div>
    </section>
  </div>
</template>
