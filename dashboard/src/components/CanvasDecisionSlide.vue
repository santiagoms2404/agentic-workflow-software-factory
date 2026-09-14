<script setup lang="ts">
import { computed } from "vue";
import type { TreeProposal } from "../../shared/types.ts";
import { formatDate } from "../display.ts";
import { narrativeFields, VOICE_LABEL } from "../group-tree.ts";

const props = defineProps<{ decision: TreeProposal; middle: boolean }>();

/**
 * One decision, as a slide.
 *
 * The same boxes the reading uses — a recessed well per field, raised rows for
 * what it wrote and what it dropped — so this is one design language seen a
 * different way rather than a second one. What it drops is "from the ask": the
 * ask is pinned above the wheel and changes as it turns, so repeating it on
 * every slide would say the same thing twice on a card that has no room.
 */
const fields = computed(() => narrativeFields(props.decision.narrative));
</script>

<template>
  <article class="wheel-card decision-slide" :class="{ middle }">
    <header class="wheel-card-head">
      <p class="wheel-card-voice">
        {{ VOICE_LABEL["owner-decision"] }} · {{ formatDate(decision.decidedAt ?? decision.proposedAt) }}
      </p>
      <h3 class="wheel-card-title">{{ decision.narrative.title }}</h3>
    </header>

    <template v-if="middle">
      <p class="decision-reason" :class="{ absent: !decision.ownerReason }">
        {{ decision.ownerReason || "no reason recorded with this decision" }}
      </p>

      <dl class="decision-fields">
        <div class="decision-field">
          <dt>read as</dt>
          <dd :class="{ absent: !fields.explanation.recorded }">{{ fields.explanation.text }}</dd>
        </div>
        <div class="decision-field">
          <dt>friction</dt>
          <dd :class="{ absent: !fields.friction.recorded }">{{ fields.friction.text }}</dd>
        </div>
      </dl>

      <div v-if="decision.changes.length || decision.alternatives.length" class="decision-groups">
        <div v-if="decision.changes.length" class="decision-rows">
          <p class="decision-voice">what this wrote ({{ decision.changes.length }})</p>
          <p v-for="(change, index) in decision.changes.slice(0, 2)" :key="index" class="decision-row">
            <code>{{ change.kind }}</code>
            <code v-if="change.unit" class="decision-change-unit">{{ change.unit }}</code>
            <span>{{ change.detail }}</span>
          </p>
          <p v-if="decision.changes.length > 2" class="decision-voice absent">
            +{{ decision.changes.length - 2 }} more, on the reading
          </p>
        </div>
        <div v-if="decision.alternatives.length" class="decision-rows">
          <p class="decision-voice">considered and dropped ({{ decision.alternatives.length }})</p>
          <p v-for="(alternative, index) in decision.alternatives.slice(0, 2)" :key="index" class="decision-row dropped">
            <span>{{ alternative }}</span>
          </p>
          <p v-if="decision.alternatives.length > 2" class="decision-voice absent">
            +{{ decision.alternatives.length - 2 }} more, on the reading
          </p>
        </div>
      </div>

      <p v-if="decision.tasks.length" class="decision-tasks">
        tasks: <code v-for="task in decision.tasks" :key="task">{{ task }}</code>
      </p>
    </template>
  </article>
</template>
