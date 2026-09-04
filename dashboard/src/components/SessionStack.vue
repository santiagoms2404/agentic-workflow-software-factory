<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { SessionCard as Session } from "../../shared/types.ts";
import { formatCalls, formatTokens, formatUsage, shortSessionId, stateLabel } from "../display.ts";
import {
  orderSessionStack,
  promoteSession,
  sessionPeekWindow,
  sessionStackToneClass,
} from "../session-stacks.ts";
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
const peekWindow = computed(() => sessionPeekWindow(ordered.value));
const peekToneById = computed(() => new Map(peekWindow.value.visible.map((session, index) => [
  session.sessionId,
  sessionStackToneClass(peekWindow.value.hiddenCount + index),
])));
const overflowTone = computed(() => sessionStackToneClass(Math.max(0, peekWindow.value.hiddenCount - 1)));

function isFront(session: Session): boolean {
  return session.sessionId === front.value?.sessionId;
}

function isHiddenPeek(session: Session): boolean {
  return !isFront(session) && !peekToneById.value.has(session.sessionId);
}

function controlClasses(session: Session): readonly string[] {
  if (isFront(session)) return ["session-stack-current-control"];
  const tone = peekToneById.value.get(session.sessionId);
  return tone === undefined ? ["session-stack-hidden-control"] : ["session-stack-peek", tone];
}

async function promote(sessionId: string, event: MouseEvent): Promise<void> {
  const keyboardActivated = event.detail === 0;
  promotedIds.value = promoteSession(ordered.value, sessionId).map((session) => session.sessionId);
  if (!keyboardActivated) return;
  await nextTick();
  element.value?.querySelector<HTMLElement>(".session-stack-front .session-card")?.focus({ preventScroll: true });
}

function restoreDefault(event: MouseEvent): void {
  const stack = element.value;
  if (stack !== null && event.composedPath().includes(stack)) return;
  promotedIds.value = null;
}

onMounted(() => document.addEventListener("click", restoreDefault));
onUnmounted(() => document.removeEventListener("click", restoreDefault));
</script>

<template>
  <SessionCard v-if="sessions.length === 1 && standalone" :session="standalone" />
  <div v-else ref="element" class="session-stack" role="group" aria-label="Related runs">
    <div class="session-stack-deck">
      <div
        v-if="peekWindow.hiddenCount"
        class="session-stack-overflow"
        :class="overflowTone"
        :aria-label="`${peekWindow.hiddenCount} further related runs`"
      >+{{ peekWindow.hiddenCount }} further runs</div>
      <button
        v-for="session in ordered"
        :key="session.sessionId"
        type="button"
        class="session-stack-control"
        :class="controlClasses(session)"
        :tabindex="isFront(session) || isHiddenPeek(session) ? -1 : 0"
        :aria-hidden="isHiddenPeek(session)"
        :aria-expanded="isFront(session)"
        :aria-label="isFront(session) ? `Run ${shortSessionId(session.sessionId)} is in front` : `Show run ${shortSessionId(session.sessionId)} in front`"
        @click="promote(session.sessionId, $event)"
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
