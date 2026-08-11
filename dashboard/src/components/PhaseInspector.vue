<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { CompiledPrompt, PhaseDetailResponse } from "../../shared/types.ts";
import { costAuthorityLabel, formatCost, formatTokens, formatUsage } from "../display.ts";
import DetailSection from "./DetailSection.vue";

const props = defineProps<{ detail: PhaseDetailResponse }>();
const openSections = reactive(new Set<string>());
const openPrompts = reactive(new Set<string>());
const rawPrompts = reactive(new Set<string>());
const openGates = reactive(new Set<string>());
const openOutputs = reactive(new Set<string>());
watch(() => props.detail.phase.phaseId, () => {
  openSections.clear(); openPrompts.clear(); rawPrompts.clear(); openGates.clear(); openOutputs.clear();
});
function toggle(set: Set<string>, key: string): void { set.has(key) ? set.delete(key) : set.add(key); }
function json(value: unknown): string { return JSON.stringify(value, null, 2); }
const phaseAgents = computed(() => props.detail.agents.filter((agent) => agent.agent === props.detail.phase.owner));

interface SafeLine { kind: "h1" | "h2" | "h3" | "li" | "p" | "code"; text: string }
function safeLines(prompt: CompiledPrompt): SafeLine[] {
  let code = false;
  return prompt.text.split(/\r?\n/).flatMap((line): SafeLine[] => {
    if (line.trim().startsWith("```")) { code = !code; return []; }
    if (code) return [{ kind: "code", text: line }];
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) return [{ kind: `h${heading[1]!.length}` as SafeLine["kind"], text: heading[2]! }];
    const list = /^\s*[-*]\s+(.*)$/.exec(line);
    if (list) return [{ kind: "li", text: list[1]! }];
    return line.trim() ? [{ kind: "p", text: line }] : [];
  });
}
</script>

<template>
  <div class="phase-inspector" aria-label="Phase facts">
    <DetailSection
      v-if="detail.requestText"
      title="request"
      :open="openSections.has('request')"
      @toggle="toggle(openSections, 'request')"
    ><p class="request-full">{{ detail.requestText }}</p></DetailSection>

    <DetailSection
      v-if="phaseAgents.length"
      title="agent config"
      :count="phaseAgents.length"
      :open="openSections.has('config')"
      @toggle="toggle(openSections, 'config')"
    >
      <dl v-for="agent in phaseAgents" :key="agent.agent" class="fact-grid">
        <dt>role</dt><dd>{{ agent.agent }}</dd>
        <dt>provider</dt><dd>{{ agent.provider }}</dd>
        <dt>requested model</dt><dd>{{ agent.requestedModel }}</dd>
        <dt>resolved model</dt><dd>{{ agent.resolvedModel ?? "not yet recorded" }}</dd>
        <dt>identity authority</dt><dd>{{ agent.modelProvenance ?? "unrecorded" }}</dd>
        <dt>sandbox</dt><dd>{{ agent.sandboxBadge ? `${agent.sandboxBadge} · ${agent.sandboxMechanism}` : "evidence not recorded" }}</dd>
      </dl>
      <details class="config-snapshot"><summary>Redacted effective config</summary><pre>{{ json(detail.effectiveConfig) }}</pre></details>
    </DetailSection>

    <DetailSection title="description" :open="openSections.has('description')" @toggle="toggle(openSections, 'description')">
      <p>{{ detail.phase.description }}</p>
    </DetailSection>

    <DetailSection
      title="compiled prompts"
      :count="detail.compiledPrompts.length"
      :open="openSections.has('prompts')"
      @toggle="toggle(openSections, 'prompts')"
    >
      <p v-if="!detail.compiledPrompts.length" class="empty-note">No compiled prompts were projected.</p>
      <article v-for="prompt in detail.compiledPrompts" :key="prompt.name" class="prompt-panel">
        <button type="button" class="prompt-head" :aria-expanded="openPrompts.has(prompt.name)" @click="toggle(openPrompts, prompt.name)">
          <span>{{ openPrompts.has(prompt.name) ? "▾" : "▸" }}</span><strong>{{ prompt.name }}</strong><span>{{ prompt.lineCount }} lines</span>
        </button>
        <div v-if="openPrompts.has(prompt.name)" class="prompt-body">
          <div class="view-toggle" aria-label="Prompt display mode">
            <button type="button" :class="{ active: !rawPrompts.has(prompt.name) }" @click="rawPrompts.delete(prompt.name)">rendered-safe</button>
            <button type="button" :class="{ active: rawPrompts.has(prompt.name) }" @click="rawPrompts.add(prompt.name)">raw</button>
          </div>
          <pre v-if="rawPrompts.has(prompt.name)" class="prompt-raw">{{ prompt.text }}</pre>
          <div v-else class="prompt-rendered">
            <component :is="line.kind === 'code' ? 'code' : line.kind === 'li' ? 'p' : line.kind" v-for="(line, index) in safeLines(prompt)" :key="index" :class="{ 'safe-list': line.kind === 'li' }">{{ line.kind === "li" ? `• ${line.text}` : line.text }}</component>
          </div>
        </div>
      </article>
    </DetailSection>

    <DetailSection title="gates" :count="detail.gates.length" :open="openSections.has('gates')" @toggle="toggle(openSections, 'gates')">
      <p v-if="!detail.gates.length" class="empty-note">No gate results recorded.</p>
      <article v-for="gate in detail.gates" :key="gate.id" class="evidence-row" :class="gate.passed ? 'pass' : 'fail'">
        <button type="button" :aria-expanded="openGates.has(gate.id)" @click="toggle(openGates, gate.id)">
          <span>{{ openGates.has(gate.id) ? "▾" : "▸" }}</span><strong>{{ gate.passed ? "✓ PASS" : "× FAIL" }} {{ gate.gateId }}</strong><span>round {{ gate.round }} · {{ gate.kind }}</span>
        </button>
        <div v-if="openGates.has(gate.id)"><pre>checks: {{ json(gate.checks) }}</pre><pre>violations: {{ json(gate.violations) }}</pre></div>
      </article>
    </DetailSection>

    <DetailSection title="usage" :open="openSections.has('usage')" @toggle="toggle(openSections, 'usage')">
      <dl class="fact-grid">
        <dt>total tokens</dt><dd>{{ formatUsage(detail.usage) }} · {{ detail.usage.usageAuthority }}</dd>
        <dt>input / output</dt><dd>{{ formatTokens(detail.usage.inputTokens) }} / {{ formatTokens(detail.usage.outputTokens) }}</dd>
        <dt>cache read / write</dt><dd>{{ formatTokens(detail.usage.cacheReadTokens) }} / {{ formatTokens(detail.usage.cacheWriteTokens) }}</dd>
        <dt>reasoning</dt><dd>{{ formatTokens(detail.usage.reasoningTokens) }} · {{ detail.usage.reasoningRelation }}</dd>
        <dt>cost</dt><dd>{{ formatCost(detail.usage.costAuthority, detail.usage.estimatedCostUsd) }} · {{ costAuthorityLabel(detail.usage.costAuthority) }}<template v-if="detail.usage.costPartial"> · partial total</template></dd>
      </dl>
    </DetailSection>

    <DetailSection title="outputs" :count="detail.envelopes.length" :open="openSections.has('outputs')" @toggle="toggle(openSections, 'outputs')">
      <p v-if="!detail.envelopes.length" class="empty-note">No envelopes recorded.</p>
      <article v-for="envelope in detail.envelopes" :key="envelope.id" class="evidence-row" :class="envelope.valid ? 'pass' : 'fail'">
        <button type="button" :aria-expanded="openOutputs.has(envelope.id)" @click="toggle(openOutputs, envelope.id)">
          <span>{{ openOutputs.has(envelope.id) ? "▾" : "▸" }}</span><strong>{{ envelope.valid ? "VALID" : "INVALID — retained" }}</strong><span>round {{ envelope.correctionRound }} · {{ envelope.schemaId }}</span>
        </button>
        <div v-if="openOutputs.has(envelope.id)"><pre>{{ json(envelope.payload) }}</pre><pre>violations: {{ json(envelope.violations) }}</pre></div>
      </article>
    </DetailSection>

    <DetailSection title="process evidence" :count="detail.processes.length" :open="openSections.has('process')" @toggle="toggle(openSections, 'process')">
      <dl v-for="process in detail.processes" :key="process.id" class="fact-grid process-facts">
        <dt>role / adapter</dt><dd>{{ process.role }} · {{ process.adapterId }}</dd>
        <dt>status</dt><dd>{{ process.status }} · {{ process.transport }}</dd>
        <dt>registered</dt><dd>{{ process.registeredAt }}</dd>
        <dt>released / ended</dt><dd>{{ process.releasedAt ?? "not released" }} / {{ process.endedAt ?? "still live" }}</dd>
        <dt>exit</dt><dd>{{ process.exitCode ?? "not recorded" }} {{ process.exitSignal ?? "" }}</dd>
      </dl>
      <p v-if="!detail.processes.length" class="empty-note">No process evidence recorded.</p>
    </DetailSection>
  </div>
</template>
