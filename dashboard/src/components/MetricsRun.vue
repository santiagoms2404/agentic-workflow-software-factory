<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChartColumn, Copy } from "lucide-vue-next";
import type { MetricsAttribution, MetricsRun } from "../../shared/types.ts";
import { formatListEquivalent } from "../../shared/rate-card.ts";
import { shortSessionId, stateLabel, stateTone } from "../display.ts";
import {
  ATTRIBUTION_CAUSES,
  ATTRIBUTION_NOTE,
  PHASE_LEGEND,
  PHASE_TONE,
  attributeCommand,
  blockedLabel,
  commandReady,
  runOptionLabel,
  type AttributionPanel,
  type PhaseStrip,
  type RoleLine,
  type RunFact,
} from "../metrics-run.ts";

const props = defineProps<{
  runs: readonly MetricsRun[];
  run: MetricsRun;
  facts: readonly RunFact[];
  strip: PhaseStrip;
  lines: readonly RoleLine[];
  panel: AttributionPanel | null;
}>();

const emit = defineEmits<{ pick: [sessionId: string] }>();

// The composer's state lives in this component only: nothing is stored or
// sent, and a different run starts it empty.
const cause = ref<MetricsAttribution | null>(null);
const reason = ref("");
const copyStatus = ref("");
const field = ref<HTMLTextAreaElement | null>(null);
watch(() => props.run.sessionId, () => {
  cause.value = null;
  reason.value = "";
  copyStatus.value = "";
});

const command = computed(() => attributeCommand(props.run, cause.value, reason.value));
const ready = computed(() => commandReady(cause.value, reason.value));

function pickCause(value: MetricsAttribution): void {
  cause.value = cause.value === value ? null : value;
  copyStatus.value = "";
}

/** The clipboard where the browser grants it; otherwise the text is selected for the owner's own copy. */
async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(command.value);
    copyStatus.value = "Copied. Paste it into a terminal.";
  } catch {
    field.value?.focus();
    field.value?.select();
    copyStatus.value = "Selected. Press Ctrl+C to copy it.";
  }
}

function pickRun(event: Event): void {
  emit("pick", (event.target as HTMLSelectElement).value);
}
function kindWidth(share: number): string {
  return `${share === 0 ? 0 : Math.max(2, share * 100)}%`;
}
</script>

<template>
  <div class="run-view">
    <header class="metrics-view-head">
      <h2 class="metrics-view-title">One run</h2>
      <p class="metrics-view-lede">What the metrics control on a run card opens. The lens rail still applies to the run picker.</p>
    </header>

    <div class="ledger-bar">
      <label class="ledger-bar-label" for="metrics-run-select">run</label>
      <select id="metrics-run-select" class="run-select" :value="run.sessionId" @change="pickRun">
        <option v-for="option in runs" :key="option.sessionId" :value="option.sessionId">{{ runOptionLabel(option) }}</option>
      </select>
    </div>

    <div class="run-top">
      <!-- The run card in miniature. Its link and metrics control are the
           board's; the archive control keeps its text form (O2) and is
           disabled here, because the metrics tab writes nothing. -->
      <div class="run-card">
        <a class="run-card-link" :href="`#/sessions/${encodeURIComponent(run.sessionId)}`">
          <span class="run-card-id">{{ shortSessionId(run.sessionId) }}</span>
          <span class="run-card-workflow">{{ run.workflow }}</span>
          <span class="run-card-task">{{ run.taskId }} · attempt {{ run.attempt }}</span>
          <span class="run-card-foot">
            <span class="state-chip" :class="stateTone(run.lifecycleState)">{{ stateLabel(run.lifecycleState) }}</span>
            <span class="run-card-date">{{ run.startedAt.slice(0, 10) }}</span>
          </span>
        </a>
        <div class="run-card-controls">
          <a
            class="metrics-control"
            aria-current="page"
            :href="`#/metrics/run/${encodeURIComponent(run.sessionId)}`"
            :aria-label="`Open run ${shortSessionId(run.sessionId)} in metrics`"
            title="This run in metrics"
          ><ChartColumn :size="16" :stroke-width="2" aria-hidden="true" /></a>
          <button
            type="button"
            class="archive-control"
            disabled
            :aria-label="`Archive session ${shortSessionId(run.sessionId)}: on the sessions board only`"
            title="Archive from the sessions board. The metrics tab writes nothing."
          >archive</button>
        </div>
      </div>

      <div class="run-side">
        <dl class="run-facts">
          <div v-for="fact in facts" :key="fact.label">
            <dt>{{ fact.label }}</dt>
            <dd>
              <span v-if="fact.chip" class="state-chip" :class="stateTone(run.lifecycleState)">{{ fact.value }}</span>
              <template v-else>{{ fact.value }}</template>
            </dd>
          </div>
        </dl>
        <section v-if="panel" class="run-attribution" aria-labelledby="run-attribution-title">
          <h3 id="run-attribution-title" class="run-attribution-title">
            Blocked in {{ blockedLabel(panel.blocked) }}<template v-if="panel.blocked.errorCode"> · {{ panel.blocked.errorCode }}</template>
            · heuristic: {{ panel.heuristic ?? "none" }}
          </h3>
          <p v-if="panel.override" class="run-attribution-record">
            Owner's override in force: <strong>{{ panel.override.cause }}</strong> · “{{ panel.override.reason }}” · {{ panel.override.date }}
          </p>
          <p v-else class="run-attribution-record">No owner override recorded. In force: {{ panel.inForce ?? "none" }} ({{ panel.source ?? "no source" }}).</p>

          <div class="ledger-bar" role="group" aria-label="Cause">
            <span class="ledger-bar-label" aria-hidden="true">cause</span>
            <button
              v-for="value in ATTRIBUTION_CAUSES"
              :key="value"
              type="button"
              class="metrics-pill"
              :aria-pressed="cause === value"
              @click="pickCause(value)"
            >{{ value }}</button>
          </div>
          <label class="run-reason">
            <span class="ledger-bar-label">reason</span>
            <input v-model="reason" type="text" maxlength="2000" autocomplete="off" spellcheck="true" placeholder="why this block is attributed so" />
          </label>
          <p class="run-attribution-note">{{ ATTRIBUTION_NOTE }}</p>
          <div class="run-command">
            <textarea
              ref="field"
              class="run-command-field"
              :value="command"
              readonly
              rows="2"
              aria-label="The awsf attribute command to run in a terminal"
            />
            <button
              type="button"
              class="metrics-pill run-copy"
              :disabled="!ready"
              :title="ready ? 'Copy the command' : 'Pick a cause and write a reason first'"
              @click="copyCommand"
            ><Copy :size="15" :stroke-width="2" aria-hidden="true" /> Copy command</button>
          </div>
          <p class="run-copy-status" role="status" aria-live="polite">{{ copyStatus }}</p>
        </section>
      </div>
    </div>


    <div class="phase-strip-wrap">
      <div class="phase-strip" role="img" aria-label="Phases in order, width proportional to minutes">
        <span
          v-for="segment in strip.segments"
          :key="segment.phaseId"
          class="phase-segment"
          :class="`tone-${segment.tone}`"
          :style="{ flexGrow: segment.weight, background: PHASE_TONE[segment.tone] }"
          :title="segment.title"
        ><span>{{ segment.label }}</span></span>
      </div>
      <div class="phase-axis"><span>0 min</span><span>{{ Math.round(strip.minutes) }} min of phase time</span></div>
    </div>
    <ul class="metrics-legend" aria-label="Phase status">
      <li v-for="entry in PHASE_LEGEND" :key="entry.tone"><i :style="{ background: PHASE_TONE[entry.tone] }" aria-hidden="true" />{{ entry.label }}</li>
    </ul>

    <p v-if="lines.length === 0" class="metrics-note">This run never reached an agent phase, so it has no role-rows.</p>
    <div v-else class="ledger-scroll">
      <table class="ledger-table run-table">
        <thead>
          <tr>
            <th scope="col" class="ledger-key">Role</th>
            <th scope="col" class="run-route-head">Route</th>
            <th scope="col">Turns</th>
            <th scope="col">Minutes</th>
            <th scope="col" title="tool calls: read · search · edit · exec · other">Tool calls R·S·E·X·O</th>
            <th scope="col">Gates</th>
            <th scope="col">First pass</th>
            <th scope="col">Tokens (cache read · output)</th>
            <th scope="col">List equivalent</th>
            <th scope="col" class="run-kind-head">By token kind</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in lines" :key="`${line.role}:${line.taskClass}`">
            <th scope="row" class="ledger-key">
              <span class="ledger-key-title"><i class="metrics-dot" :style="{ background: line.dot }" aria-hidden="true" />{{ line.role }}</span>
              <small>{{ line.taskClass }} · {{ line.provenance }}</small>
            </th>
            <td class="run-route">
              <svg v-if="line.provider === 'openai'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" /></svg>
              <svg v-else-if="line.provider === 'anthropic'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg>
              {{ line.route }}
            </td>
            <td>{{ line.turns }}</td>
            <td>{{ line.minutes }}</td>
            <td class="run-mono">{{ line.toolMix }}</td>
            <td>{{ line.gates }}</td>
            <td><span class="run-mark" :class="`mark-${line.firstPass.replace(' ', '-')}`">{{ line.firstPass }}</span></td>
            <td>{{ line.tokens }}</td>
            <td>{{ line.list }}</td>
            <td class="run-kinds">
              <span v-if="line.byKind === null" class="ledger-dim">unpriced</span>
              <span v-else class="run-kind-grid">
                <template v-for="share in line.byKind" :key="share.kind">
                  <span class="run-kind-label">{{ share.kind }}</span>
                  <span class="run-kind-track" :title="`${share.kind} ${formatListEquivalent(share.usd)} · ${Math.round(share.share * 100)}%`">
                    <b :style="{ width: kindWidth(share.share) }" />
                  </span>
                </template>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
