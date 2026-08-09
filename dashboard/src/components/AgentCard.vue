<script setup lang="ts">
import { computed } from "vue";
import type { AgentSummary } from "../../shared/types.ts";
import { contextMeterPercent, modelProvenanceLabel } from "../display.ts";
const props = defineProps<{ agent: AgentSummary; index: number }>();
const color = computed(() => props.agent.color ?? ["var(--agent-planner)", "var(--agent-builder)", "var(--agent-reviewer)", "var(--agent-code)"][props.index % 4]!);
const model = computed(() => props.agent.resolvedModel ?? props.agent.requestedModel);
const provenance = computed(() => modelProvenanceLabel(props.agent.modelProvenance));
const contextPercent = computed(() => contextMeterPercent(props.agent.contextTokens, props.agent.contextWindow));
const sandbox = computed(() => props.agent.adapterId.includes("sandbox") ? "os-enforced" : props.agent.adapterId.includes("policy") ? "tool-policy" : "unavailable");
</script>
<template><article class="agent-card"><span class="agent-swatch" :style="{ background: color }" aria-hidden="true" /><div><h3>{{ agent.agent }}</h3><p class="model-badge" :class="provenance">{{ model }} <small>{{ provenance }}</small></p><p v-if="contextPercent !== null" class="context-meter"><span>Context {{ agent.contextTokens ?? 0 }} / {{ agent.contextWindow }}</span><b :style="{ width: `${contextPercent}%` }" /></p><p class="sandbox-badge" :class="sandbox">Sandbox: {{ sandbox }}</p></div></article></template>
