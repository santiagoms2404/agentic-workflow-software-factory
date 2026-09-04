<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { SessionCard as Session } from "../../shared/types.ts";
import { formatCalls, formatTokens, formatUsage, shortSessionId, stateLabel } from "../display.ts";
import {
  orderSessionStack,
  promoteSessionWithTone,
  removeSessionFromStack,
  sessionPeekWindow,
  sessionStackToneClass,
  sessionStackTones,
  sessionVisiblePeeks,
} from "../session-stacks.ts";
import SessionCard from "./SessionCard.vue";

const props = defineProps<{ sessions: readonly Session[] }>();
const element = ref<HTMLElement | null>(null);
const promotedIds = ref<readonly string[] | null>(null);
const promotedFront = ref<{ readonly sessionId: string; readonly toneClass: string } | null>(null);
const archivedIds = ref<ReadonlySet<string>>(new Set());
const expanded = ref(false);

const activeSessions = computed(() => props.sessions.filter((session) => !archivedIds.value.has(session.sessionId)));
const standalone = computed(() => activeSessions.value[0]);
const defaultOrder = computed(() => orderSessionStack(activeSessions.value));
const ordered = computed<readonly Session[]>(() => {
  if (promotedIds.value === null) return defaultOrder.value;
  const sessionsById = new Map(activeSessions.value.map((session) => [session.sessionId, session]));
  const promoted = promotedIds.value
    .map((sessionId) => sessionsById.get(sessionId))
    .filter((session): session is Session => session !== undefined);
  return promoted.length === activeSessions.value.length ? promoted : defaultOrder.value;
});
const front = computed(() => ordered.value[ordered.value.length - 1]);
const peekWindow = computed(() => sessionPeekWindow(ordered.value));
const visiblePeeks = computed(() => sessionVisiblePeeks(ordered.value, expanded.value));
const visiblePeekIds = computed(() => new Set(visiblePeeks.value.map((session) => session.sessionId)));
const toneById = computed(() => sessionStackTones(ordered.value));
const frontTone = computed(() => {
  const promoted = promotedFront.value;
  return promoted !== null && promoted.sessionId === front.value?.sessionId ? promoted.toneClass : undefined;
});
const overflowTone = computed(() => peekWindow.value.hiddenCount === 0
  ? undefined
  : sessionStackToneClass(visiblePeeks.value.length + 1));

function isFront(session: Session): boolean {
  return session.sessionId === front.value?.sessionId;
}

function isHiddenPeek(session: Session): boolean {
  return !isFront(session) && !visiblePeekIds.value.has(session.sessionId);
}

function controlClasses(session: Session): readonly string[] {
  if (isFront(session)) return ["session-stack-current-control"];
  const tone = toneById.value.get(session.sessionId);
  return tone === undefined || isHiddenPeek(session) ? ["session-stack-hidden-control"] : ["session-stack-peek", tone];
}

async function promote(sessionId: string, event: MouseEvent): Promise<void> {
  const keyboardActivated = event.detail === 0;
  const promotion = promoteSessionWithTone(ordered.value, sessionId);
  promotedIds.value = promotion.ordered.map((session) => session.sessionId);
  promotedFront.value = promotion.frontToneClass === undefined
    ? null
    : { sessionId, toneClass: promotion.frontToneClass };
  if (!keyboardActivated) return;
  await nextTick();
  element.value?.querySelector<HTMLElement>(".session-stack-front .session-card")?.focus({ preventScroll: true });
}

function toggleExpanded(): void {
  expanded.value = !expanded.value;
}

function archiveFront(sessionId: string): void {
  if (sessionId !== front.value?.sessionId) return;
  promotedIds.value = removeSessionFromStack(ordered.value, sessionId).map((session) => session.sessionId);
  promotedFront.value = null;
  archivedIds.value = new Set([...archivedIds.value, sessionId]);
}

function restoreDefault(event: MouseEvent): void {
  const stack = element.value;
  if (stack !== null && event.composedPath().includes(stack)) return;
  promotedIds.value = null;
  promotedFront.value = null;
}

onMounted(() => document.addEventListener("click", restoreDefault));
onUnmounted(() => document.removeEventListener("click", restoreDefault));
</script>

<template>
  <SessionCard v-if="activeSessions.length === 1 && standalone" :session="standalone" />
  <div v-else-if="activeSessions.length > 1" ref="element" class="session-stack" role="group" aria-label="Related runs">
    <div class="session-stack-deck" :class="{ expanded }">
      <button
        v-if="peekWindow.hiddenCount"
        type="button"
        class="session-stack-overflow"
        :class="overflowTone"
        :aria-expanded="expanded"
        :aria-label="expanded ? 'Collapse related runs' : `Expand ${peekWindow.hiddenCount} further related runs`"
        @click="toggleExpanded"
      >{{ expanded ? "Show fewer related runs" : `+${peekWindow.hiddenCount} further runs` }}</button>
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
      <SessionCard
        :key="front.sessionId"
        :session="front"
        :tone-class="frontTone"
        @archived="archiveFront"
      />
    </div>
  </div>
</template>
