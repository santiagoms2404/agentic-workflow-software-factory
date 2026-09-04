<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { SessionCard as Session } from "../../shared/types.ts";
import { formatCalls, formatTokens, formatUsage, shortSessionId, stateLabel } from "../display.ts";
import { orderSessionStack, promoteSession } from "../session-stacks.ts";
import SessionCard from "./SessionCard.vue";

const props = defineProps<{ sessions: readonly Session[] }>();
const element = ref<HTMLElement | null>(null);
const promotedIds = ref<readonly string[] | null>(null);

const standalone = computed(() => props.sessions[0]);
const defaultOrder = computed(() => orderSessionStack(props.sessions));
const ordered = computed<readonly Session[]>(() => {
  if (promotedIds.value === null) return defaultOrder.value;
  const sessionsById = new Map(props.sessions.map((session) => [session.sessionId, session]));
  const promoted = promotedIds.value
    .map((sessionId) => sessionsById.get(sessionId))
    .filter((session): session is Session => session !== undefined);
  return promoted.length === props.sessions.length ? promoted : defaultOrder.value;
});
const front = computed(() => ordered.value[ordered.value.length - 1]);
const peeks = computed(() => ordered.value.slice(0, -1));

function promote(sessionId: string): void {
  promotedIds.value = promoteSession(ordered.value, sessionId).map((session) => session.sessionId);
}

function peekStyle(index: number): Readonly<Record<string, string>> {
  return { "--session-stack-inset": `${Math.max(0, peeks.value.length - index - 1) * 6}px` };
}

function restoreDefault(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Node && element.value?.contains(target)) return;
  promotedIds.value = null;
}

onMounted(() => document.addEventListener("click", restoreDefault));
onUnmounted(() => document.removeEventListener("click", restoreDefault));
</script>

<template>
  <SessionCard v-if="sessions.length === 1 && standalone" :session="standalone" />
  <div v-else ref="element" class="session-stack" role="group" aria-label="Related runs">
    <div class="session-stack-deck">
      <button
        v-for="(session, index) in peeks"
        :key="session.sessionId"
        type="button"
        class="session-stack-peek"
        :style="peekStyle(index)"
        aria-expanded="false"
        :aria-label="`Show run ${shortSessionId(session.sessionId)} in front`"
        @click="promote(session.sessionId)"
      >
        <span class="session-stack-peek-id">{{ shortSessionId(session.sessionId) }}</span>
        <span class="session-stack-peek-workflow" :title="session.workflowId">{{ session.workflowId }}</span>
        <span class="session-stack-peek-state">{{ stateLabel(session.state) }}</span>
        <span class="session-stack-peek-calls"><small>calls</small> {{ formatCalls(session.callsSpent, session.callCeiling) }}</span>
        <span class="session-stack-peek-usage">
          <small>usage</small> {{ formatUsage(session.usage) }}<template v-if="session.usage.cacheReadTokens !== null"> · cache {{ formatTokens(session.usage.cacheReadTokens) }}</template>
        </span>
      </button>
    </div>
    <div v-if="front" class="session-stack-front">
      <SessionCard :key="front.sessionId" :session="front" />
    </div>
  </div>
</template>
