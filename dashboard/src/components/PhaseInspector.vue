<script setup lang="ts">
import type { PhaseDetailResponse } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost, formatUsage } from "../display.ts";
defineProps<{ detail: PhaseDetailResponse }>();
function json(value: unknown) { return JSON.stringify(value, null, 2); }
</script>
<template>
  <section class="phase-inspector" aria-label="Phase details">
    <section><h3>Agent config</h3><dl><template v-for="agent in detail.agents" :key="agent.agent"><dt>{{ agent.agent }}</dt><dd>{{ agent.requestedModel }} · {{ agent.resolvedModel ?? "unrecorded" }}</dd></template></dl><pre>{{ json(detail.effectiveConfig) }}</pre></section>
    <section><h3>Compiled prompts ({{ detail.compiledPrompts.length }})</h3><ul v-if="detail.compiledPrompts.length" class="inspector-list"><li v-for="prompt in detail.compiledPrompts" :key="prompt.name"><strong>{{ prompt.name }}</strong><span>{{ prompt.lineCount }} lines</span><pre>{{ prompt.text }}</pre></li></ul><p v-else class="empty-note">No compiled prompts were projected for this phase.</p></section>
    <section><h3>Gates ({{ detail.gates.length }})</h3><ul class="inspector-list"><li v-for="gate in detail.gates" :key="gate.id"><strong>{{ gate.passed ? "PASS" : "FAIL" }} {{ gate.gateId }}</strong><span>round {{ gate.round }} · {{ gate.kind }}</span><pre v-if="gate.checks !== null">checks: {{ json(gate.checks) }}</pre><pre v-if="gate.violations !== null">violations: {{ json(gate.violations) }}</pre></li></ul><p v-if="!detail.gates.length" class="empty-note">No gate results recorded.</p></section>
    <section><h3>Usage</h3><p class="usage-line">{{ formatUsage(detail.usage) }} tokens ({{ detail.usage.usageAuthority }}) · {{ formatCost(detail.usage.costAuthority, detail.usage.estimatedCostUsd) }} ({{ costAuthorityLabel(detail.usage.costAuthority) }})<template v-if="detail.usage.costPartial"> · total is partial</template></p></section>
    <section><h3>Envelope rounds ({{ detail.envelopes.length }})</h3><ul class="inspector-list"><li v-for="envelope in detail.envelopes" :key="envelope.id" :class="{ invalid: !envelope.valid }"><strong>{{ envelope.valid ? "VALID" : "INVALID — retained" }} · round {{ envelope.correctionRound }}</strong><span>{{ envelope.agent }} · {{ envelope.schemaId }}</span><pre>{{ json(envelope.payload) }}</pre><pre v-if="envelope.violations !== null">violations: {{ json(envelope.violations) }}</pre></li></ul><p v-if="!detail.envelopes.length" class="empty-note">No envelopes recorded.</p></section>
  </section>
</template>
