<script setup lang="ts">
import { computed, ref } from "vue";
import type { SessionCard } from "../../shared/types.ts";
import {
  FAILURE_CLASSES,
  FAILURE_CLASS_LABEL,
  FAILURE_CLASS_NOTE,
  failureCodes,
  failureCounts,
  runFailures,
  type FailureClass,
} from "../run-failures.ts";
import { formatDate, shortSessionId, stateLabel, stateTone } from "../display.ts";

const props = defineProps<{ sessions: readonly SessionCard[] }>();

const failures = computed(() => runFailures(props.sessions));
const counts = computed(() => failureCounts(failures.value));
/** Only classes that have actually happened; an empty bucket is not a control. */
const present = computed(() => FAILURE_CLASSES.filter((held) => counts.value[held] > 0));

/** Closed until asked for: most visits to this board are not about failures. */
const open = ref<FailureClass | null>(null);
const shown = computed(() => open.value === null ? [] : failures.value.filter((held) => held.failure === open.value));
const codes = computed(() => open.value === null ? [] : failureCodes(failures.value, open.value));
const expanded = ref<string | null>(null);

function toggle(failure: FailureClass): void {
  open.value = open.value === failure ? null : failure;
  expanded.value = null;
}

/** One row per failed phase, so the key has to carry the phase, not the run. */
function rowKey(sessionId: string, ordinal: number): string {
  return `${sessionId}:${ordinal}`;
}
</script>

<template>
  <section v-if="failures.length" class="run-failures neu-well" aria-labelledby="run-failures-title">
    <!-- Title, count and the classes on ONE row. Collapsed, this card is a
         single line across the board rather than a heading with an empty half
         beneath it. Every failed phase, not every blocked run: a run that
         failed once, corrected and carried on is the factory working, and
         counting blocked runs would never show it. -->
    <div class="run-failures-bar">
      <h2 id="run-failures-title">Why runs stopped</h2>
      <span class="run-failures-note">{{ failures.length }} failed phase(s), every run on this board</span>
      <div class="run-failures-classes" role="group" aria-label="Failure kinds">
      <button
        v-for="failure in present"
        :key="failure"
        type="button"
        class="session-filter-option run-failure-class"
        :class="[`failure-${failure}`, { selected: open === failure }]"
        :aria-pressed="open === failure"
        :title="FAILURE_CLASS_NOTE[failure]"
        @click="toggle(failure)"
      >
        <span>{{ FAILURE_CLASS_LABEL[failure] }}</span>
        <span class="session-filter-count">{{ counts[failure] }}</span>
      </button>
      </div>
    </div>

    <template v-if="open">
      <p class="run-failures-meaning absent">{{ FAILURE_CLASS_NOTE[open] }}</p>

      <!-- What to go and fix, commonest first. The class says which kind of
           problem; the code says which one. -->
      <p class="run-failures-codes">
        <span v-for="entry in codes" :key="entry.code" class="run-failure-code">
          <code>{{ entry.code }}</code><span class="session-filter-count">{{ entry.count }}</span>
        </span>
      </p>

      <div class="run-failures-list">
        <article
          v-for="failure in shown"
          :key="rowKey(failure.sessionId, failure.ordinal)"
          class="run-failure"
        >
          <p class="run-failure-head">
            <code class="run-failure-phase">{{ failure.phaseKey }}</code>
            <code class="run-failure-code-name">{{ failure.code ?? "no code recorded" }}</code>
            <span class="state-chip" :class="stateTone(failure.runState)">{{ stateLabel(failure.runState) }}</span>
            <span class="run-failure-when">{{ failure.at ? formatDate(failure.at) : "—" }}</span>
          </p>
          <p class="run-failure-task">
            <a :href="`#/sessions/${encodeURIComponent(failure.sessionId)}`">
              <code>{{ shortSessionId(failure.sessionId) }}</code> {{ failure.taskId }}
            </a>
            <span class="run-failure-workflow">{{ failure.workflowId }}</span>
          </p>
          <!-- The message is behind a click: the list is for seeing the
               pattern, and a provider's own words are long and belong to one
               run rather than to the shape of the whole board. -->
          <button
            v-if="failure.message"
            type="button"
            class="session-filter-control run-failure-more"
            :aria-expanded="expanded === rowKey(failure.sessionId, failure.ordinal)"
            @click="expanded = expanded === rowKey(failure.sessionId, failure.ordinal) ? null : rowKey(failure.sessionId, failure.ordinal)"
          >{{ expanded === rowKey(failure.sessionId, failure.ordinal) ? "hide what it said" : "what it said" }}</button>
          <pre v-if="expanded === rowKey(failure.sessionId, failure.ordinal)" class="run-failure-message">{{ failure.message }}</pre>
          <!-- Task 8's recovery diagnostics answer whether the work behind this
               failure can still be carried forward. They are on `main` and not
               merged, so the place the answer goes says so rather than being
               filled with a claim nothing computed. -->
          <p class="run-failure-recoverable absent">
            <template v-if="failure.recoverable === null">recoverable: not known until Task 8 lands</template>
            <template v-else>{{ failure.recoverable ? "work here can be carried forward" : "nothing here to carry forward" }}</template>
          </p>
        </article>
      </div>
    </template>
  </section>
</template>
