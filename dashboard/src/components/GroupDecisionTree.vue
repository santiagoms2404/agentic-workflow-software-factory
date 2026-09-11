<script setup lang="ts">
import { computed } from "vue";
import type { GroupTree, TreeProposal } from "../../shared/types.ts";
import { narrativeFields, notTakenReason, VOICE_LABEL } from "../group-tree.ts";

const props = defineProps<{ tree: GroupTree }>();

/** The ask a decision traces back to, so a reader can follow one link, not scan. */
const askText = computed(() => new Map(props.tree.asks.map((ask) => [ask.inputId, ask.text])));

function fields(proposal: TreeProposal): ReturnType<typeof narrativeFields> {
  return narrativeFields(proposal.narrative);
}

function askLine(inputId: string | null): string {
  if (inputId === null) return "no recorded ask precedes this";
  const text = askText.value.get(inputId) ?? "";
  const line = text.split("\n").map((value) => value.trim()).find((value) => value.length > 0) ?? "";
  return line.length <= 120 ? line : `${line.slice(0, 119)}…`;
}
</script>

<template>
  <div class="decision-tree">
    <p class="decision-tree-counts">
      <span><b>{{ tree.counts.stages }}</b> stages</span>
      <span><b>{{ tree.counts.inputs }}</b> asks</span>
      <span><b>{{ tree.counts.applied }}</b> decided</span>
      <span><b>{{ tree.counts.notTaken }}</b> not taken</span>
      <span><b>{{ tree.counts.alternatives }}</b> alternatives</span>
      <span><b>{{ tree.counts.unitRecords }}</b> unit records across <b>{{ tree.counts.units }}</b></span>
    </p>

    <section class="decision-branch" aria-label="What was decided">
      <h4>What was decided</h4>
      <p v-if="!tree.spine.length" class="absent">No decision has been applied in this group.</p>
      <ol class="decision-list">
        <li v-for="decision in tree.spine" :key="decision.id" class="decision-node voice-owner-decision">
          <p class="decision-voice">{{ VOICE_LABEL["owner-decision"] }} · {{ decision.decidedAt }}</p>
          <h5>{{ decision.narrative.title }}</h5>
          <dl class="decision-fields">
            <dt>from the ask</dt>
            <dd :class="{ absent: decision.ask === null }">{{ askLine(decision.ask) }}</dd>
            <dt>the owner's reason</dt>
            <dd :class="{ absent: !decision.ownerReason }">{{ decision.ownerReason || "not recorded" }}</dd>
            <dt>the assistant's explanation</dt>
            <dd :class="{ absent: !fields(decision).explanation.recorded }">{{ fields(decision).explanation.text }}</dd>
            <dt>what changed</dt>
            <dd :class="{ absent: !fields(decision).changes.recorded }">{{ fields(decision).changes.text }}</dd>
            <dt>friction</dt>
            <dd :class="{ absent: !fields(decision).friction.recorded }">{{ fields(decision).friction.text }}</dd>
          </dl>
          <ul v-if="decision.changes.length" class="decision-changes">
            <li v-for="(change, index) in decision.changes" :key="index">
              <code>{{ change.kind }}</code>
              <code v-if="change.unit" class="decision-change-unit">{{ change.unit }}</code>
              — {{ change.detail }}
            </li>
          </ul>
          <div v-if="decision.alternatives.length" class="decision-alternatives">
            <p class="decision-voice">considered and dropped ({{ decision.alternatives.length }})</p>
            <ul>
              <li v-for="(alternative, index) in decision.alternatives" :key="index">{{ alternative }}</li>
            </ul>
          </div>
          <p v-if="decision.tasks.length" class="decision-tasks">
            tasks: <code v-for="task in decision.tasks" :key="task">{{ task }}</code>
          </p>
        </li>
      </ol>
    </section>

    <section v-if="tree.notTaken.length" class="decision-branch" aria-label="What was proposed and not taken">
      <h4>Proposed and not taken</h4>
      <ol class="decision-list">
        <li v-for="proposal in tree.notTaken" :key="proposal.id" class="decision-node voice-not-taken">
          <p class="decision-voice">{{ VOICE_LABEL["assistant-proposal"] }} · {{ proposal.proposedAt }} · {{ notTakenReason(proposal) }}</p>
          <h5>{{ proposal.narrative.title }}</h5>
          <dl class="decision-fields">
            <dt>from the ask</dt>
            <dd :class="{ absent: proposal.ask === null }">{{ askLine(proposal.ask) }}</dd>
            <dt>the assistant's explanation</dt>
            <dd :class="{ absent: !fields(proposal).explanation.recorded }">{{ fields(proposal).explanation.text }}</dd>
            <dt>its reason</dt>
            <dd :class="{ absent: !fields(proposal).reason.recorded }">{{ fields(proposal).reason.text }}</dd>
            <dt>friction</dt>
            <dd :class="{ absent: !fields(proposal).friction.recorded }">{{ fields(proposal).friction.text }}</dd>
          </dl>
          <div v-if="proposal.alternatives.length" class="decision-alternatives">
            <p class="decision-voice">considered and dropped ({{ proposal.alternatives.length }})</p>
            <ul>
              <li v-for="(alternative, index) in proposal.alternatives" :key="index">{{ alternative }}</li>
            </ul>
          </div>
        </li>
      </ol>
    </section>

    <section class="decision-branch" aria-label="What was asked">
      <h4>What was asked</h4>
      <ol class="decision-list">
        <li v-for="ask in tree.asks" :key="ask.stageId" class="decision-node voice-owner-input">
          <p class="decision-voice">{{ VOICE_LABEL["owner-input"] }} · {{ ask.at }} · {{ ask.provenance }}</p>
          <pre class="owner-words">{{ ask.text }}</pre>
          <p class="decision-gloss">
            <span class="decision-voice">the assistant read it as</span>
            <span :class="{ absent: !narrativeFields(ask.narrative).explanation.recorded }">
              {{ narrativeFields(ask.narrative).explanation.text }}
            </span>
          </p>
        </li>
      </ol>
    </section>

    <section v-if="tree.units.length" class="decision-branch" aria-label="Units and their superseded revisions">
      <h4>Units</h4>
      <ul class="decision-list">
        <li v-for="unit in tree.units" :key="unit.id" class="decision-node voice-unit">
          <h5>{{ unit.current.title }}</h5>
          <p class="decision-voice">
            <code>{{ unit.id }}</code> · task <code>{{ unit.taskId }}</code> ·
            revision {{ unit.current.revision }} · {{ unit.current.disposition }}
          </p>
          <p v-if="unit.current.reason" class="decision-gloss">{{ unit.current.reason }}</p>
          <details v-if="unit.superseded.length" class="decision-superseded">
            <summary>{{ unit.superseded.length }} superseded revision(s)</summary>
            <ul>
              <li v-for="revision in unit.superseded" :key="revision.revision">
                revision {{ revision.revision }} · {{ revision.disposition }} — {{ revision.title }}
              </li>
            </ul>
          </details>
        </li>
      </ul>
    </section>
  </div>
</template>
