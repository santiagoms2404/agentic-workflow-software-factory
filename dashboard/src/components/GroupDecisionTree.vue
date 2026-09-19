<script setup lang="ts">
import { computed } from "vue";
import type { GroupTree, TreeProposal } from "../../shared/types.ts";
import { formatDate } from "../display.ts";
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
          <p class="decision-voice">{{ VOICE_LABEL["owner-decision"] }} · {{ formatDate(decision.decidedAt ?? "") }}</p>
          <h5>{{ decision.narrative.title }}</h5>
          <!-- The decision itself, lifted out of the field list and set in a
               recessed well: it is the one line the reader came for, and it was
               the fourth of five rows of identical weight before. -->
          <p class="decision-reason" :class="{ absent: !decision.ownerReason }">
            {{ decision.ownerReason || "no reason recorded with this decision" }}
          </p>
          <!-- Each field is a labelled row rather than a two-column grid: the
               chip gives the eye a rail to track down, which is the job the
               accent border used to do badly. -->
          <dl class="decision-fields">
            <div class="decision-field">
              <dt>from the ask</dt>
              <dd :class="{ absent: decision.ask === null }">{{ askLine(decision.ask) }}</dd>
            </div>
            <div class="decision-field">
              <dt>read as</dt>
              <dd :class="{ absent: !fields(decision).explanation.recorded }">{{ fields(decision).explanation.text }}</dd>
            </div>
            <div class="decision-field">
              <dt>changed</dt>
              <dd :class="{ absent: !fields(decision).changes.recorded }">{{ fields(decision).changes.text }}</dd>
            </div>
            <div class="decision-field">
              <dt>friction</dt>
              <dd :class="{ absent: !fields(decision).friction.recorded }">{{ fields(decision).friction.text }}</dd>
            </div>
          </dl>
          <!-- What it wrote and what it dropped are the same kind of list and
               read as a pair, so they sit side by side and use the width the
               card already has rather than stacking down it. -->
          <div v-if="decision.changes.length || decision.alternatives.length" class="decision-groups">
            <div v-if="decision.changes.length" class="decision-rows">
              <p class="decision-voice">what this wrote ({{ decision.changes.length }})</p>
              <p v-for="(change, index) in decision.changes" :key="index" class="decision-row">
                <code>{{ change.kind }}</code>
                <code v-if="change.unit" class="decision-change-unit">{{ change.unit }}</code>
                <span>{{ change.detail }}</span>
              </p>
            </div>
            <div v-if="decision.alternatives.length" class="decision-rows">
              <p class="decision-voice">considered and dropped ({{ decision.alternatives.length }})</p>
              <p v-for="(alternative, index) in decision.alternatives" :key="index" class="decision-row dropped">
                <span>{{ alternative }}</span>
              </p>
            </div>
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
          <p class="decision-voice">{{ VOICE_LABEL["assistant-proposal"] }} · {{ formatDate(proposal.proposedAt) }}</p>
          <h5>{{ proposal.narrative.title }}</h5>
          <p class="decision-reason absent">{{ notTakenReason(proposal) }}</p>
          <dl class="decision-fields">
            <div class="decision-field">
              <dt>from the ask</dt>
              <dd :class="{ absent: proposal.ask === null }">{{ askLine(proposal.ask) }}</dd>
            </div>
            <div class="decision-field">
              <dt>read as</dt>
              <dd :class="{ absent: !fields(proposal).explanation.recorded }">{{ fields(proposal).explanation.text }}</dd>
            </div>
            <div class="decision-field">
              <dt>its reason</dt>
              <dd :class="{ absent: !fields(proposal).reason.recorded }">{{ fields(proposal).reason.text }}</dd>
            </div>
            <div class="decision-field">
              <dt>friction</dt>
              <dd :class="{ absent: !fields(proposal).friction.recorded }">{{ fields(proposal).friction.text }}</dd>
            </div>
          </dl>
          <div v-if="proposal.alternatives.length" class="decision-groups">
            <div class="decision-rows">
              <p class="decision-voice">considered and dropped ({{ proposal.alternatives.length }})</p>
              <p v-for="(alternative, index) in proposal.alternatives" :key="index" class="decision-row dropped">
                <span>{{ alternative }}</span>
              </p>
            </div>
          </div>
        </li>
      </ol>
    </section>

    <section class="decision-branch" aria-label="What was asked">
      <h4>What was asked</h4>
      <ol class="decision-list">
        <li v-for="ask in tree.asks" :key="ask.stageId" class="decision-node voice-owner-input">
          <p class="decision-voice">{{ VOICE_LABEL["owner-input"] }} · {{ formatDate(ask.at) }} · {{ ask.provenance }}</p>
          <!-- The owner's exact bytes beside our reading of them, never under
               it: the point of this section is that the two are different, and
               a column each says so while using the width. -->
          <div class="ask-split">
            <pre class="owner-words">{{ ask.text }}</pre>
            <p class="decision-gloss">
              <span class="decision-voice">the assistant read it as</span>
              <span :class="{ absent: !narrativeFields(ask.narrative).explanation.recorded }">
                {{ narrativeFields(ask.narrative).explanation.text }}
              </span>
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section v-if="tree.units.length" class="decision-branch" aria-label="Units and their superseded revisions">
      <h4>Units</h4>
      <ul class="decision-list unit-grid">
        <li v-for="unit in tree.units" :key="unit.id" class="decision-node voice-unit">
          <h5>{{ unit.current.title }}</h5>
          <p class="decision-voice">
            <code>{{ unit.id }}</code> · task <code>{{ unit.taskId }}</code> ·
            revision {{ unit.current.revision }} · {{ unit.current.disposition }}
          </p>
          <p v-if="unit.current.reason" class="decision-gloss">{{ unit.current.reason }}</p>
          <details v-if="unit.superseded.length" class="decision-superseded">
            <summary>{{ unit.superseded.length }} superseded revision(s)</summary>
            <p v-for="revision in unit.superseded" :key="revision.revision" class="decision-row dropped">
              <code>r{{ revision.revision }}</code>
              <span>{{ revision.disposition }} — {{ revision.title }}</span>
            </p>
          </details>
        </li>
      </ul>
    </section>
  </div>
</template>
