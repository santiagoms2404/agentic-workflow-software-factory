<script setup lang="ts">
import { computed } from "vue";
import type { AgentSummary } from "../../shared/types.ts";
import { contextMeterPercent, formatTokens, modelProvenanceLabel, providerMark } from "../display.ts";

const props = defineProps<{ agent: AgentSummary; index: number }>();
const palette = ["var(--purple)", "var(--cyan)", "var(--red)", "var(--amber)"];
const color = computed(() => props.agent.color ?? palette[props.index % palette.length]!);
const model = computed(() => props.agent.resolvedModel ?? props.agent.requestedModel);
const provenance = computed(() => modelProvenanceLabel(props.agent.modelProvenance));
const contextPercent = computed(() => contextMeterPercent(props.agent.contextTokens, props.agent.contextWindow));
</script>

<template>
  <article class="agent-card">
    <span class="agent-swatch" :style="{ background: color }" aria-hidden="true" />
    <div class="agent-card-body">
      <h3>{{ agent.agent }}</h3>
      <p class="provider-line"><b aria-hidden="true">{{ providerMark(agent.provider) }}</b>{{ agent.provider }}</p>
      <p class="model-badge" :class="provenance" :title="`${model} · ${provenance}`">
        {{ model }} <small>{{ provenance }}</small>
      </p>
      <div v-if="contextPercent !== null" class="context-meter" :title="`${agent.contextTokens} of ${agent.contextWindow} context tokens`">
        <span>Context {{ formatTokens(agent.contextTokens) }} / {{ formatTokens(agent.contextWindow) }}</span>
        <i><b :style="{ width: `${Math.max(contextPercent, 2)}%`, background: color }" /></i>
      </div>
      <p v-if="agent.sandboxBadge" class="sandbox-badge" :class="agent.sandboxBadge">
        Sandbox {{ agent.sandboxBadge }} · {{ agent.sandboxMechanism ?? "mechanism not recorded" }}
      </p>
      <p v-else class="sandbox-badge legacy">Sandbox evidence: not recorded</p>
    </div>
  </article>
</template>
