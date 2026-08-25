<script setup lang="ts">
import type { LifecycleState, TransitionSummary } from "../../shared/types.ts";
const states: LifecycleState[] = ["DRAFT", "PREPARED", "RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER", "LANDING", "LANDED", "PUBLISHED"];
defineProps<{ state: LifecycleState; transitions: TransitionSummary[] }>();
function transitionFor(to: string, transitions: TransitionSummary[]) { return transitions.findLast((transition) => transition.to === to) ?? null; }
function detail(transition: TransitionSummary | null) { return transition ? `${transition.edgeId}: ${transition.actor}; ${transition.reason.source}${transition.reason.code ? `/${transition.reason.code}` : ""}${transition.reason.detail ? ` — ${transition.reason.detail}` : ""}` : "Not yet entered"; }
</script>
<template><section class="state-ribbon-wrap" aria-label="Lifecycle audit trail"><h2>Lifecycle</h2><ol class="state-ribbon"><li v-for="(item, index) in states" :key="item" :class="{ current: item === state, earned: Boolean(transitionFor(item, transitions)) }"><span>{{ item }}</span><small v-if="transitionFor(item, transitions)">{{ transitionFor(item, transitions)?.actor }}</small><span v-if="index < states.length - 1" class="ribbon-arrow" :title="detail(transitionFor(states[index + 1]!, transitions))" tabindex="0" role="img" :aria-label="detail(transitionFor(states[index + 1]!, transitions))">→</span></li></ol></section></template>
