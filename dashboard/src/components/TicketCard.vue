<script setup lang="ts">
import type { BacklogTicket } from "../../shared/types.ts";
import { isBlockedTicket } from "../backlog-view.ts";

const props = defineProps<{ ticket: BacklogTicket }>();
const emit = defineEmits<{ open: [ticket: BacklogTicket] }>();
</script>

<template>
  <article class="ticket-card" :class="{ ready: ticket.ready }">
    <button
      type="button"
      class="ticket-card-toggle"
      aria-haspopup="dialog"
      @click="emit('open', props.ticket)"
    >
      <span class="ticket-card-meta">
        <code>{{ ticket.id }}</code>
        <span v-if="ticket.tier !== undefined" class="tier-chip">T{{ ticket.tier }}</span>
      </span>
      <strong>{{ ticket.title }}</strong>
      <small>{{ ticket.milestone }}<template v-if="ticket.workflow"> · {{ ticket.workflow }}</template></small>
      <span :class="ticket.ready ? 'ready-label' : isBlockedTicket(ticket) ? 'blocked-label' : 'state-label'">
        {{ ticket.ready ? 'ready' : isBlockedTicket(ticket) ? 'blocked' : ticket.state }}
      </span>
    </button>
  </article>
</template>
