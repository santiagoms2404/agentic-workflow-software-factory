<script setup lang="ts">
import { computed } from "vue";
import type { SessionDetailResponse } from "../../shared/types.ts";

const props = defineProps<{ session: SessionDetailResponse }>();
const passed = computed(() => props.session.gates.filter((gate) => gate.passed).length);
const diffStat = computed(() => {
  const text = JSON.stringify(props.session.gates.map((gate) => gate.checks));
  const match = text.match(/[+][0-9]+\s*[-−][0-9]+/) ?? text.match(/\d+ files? changed/);
  return match?.[0] ?? "Unavailable in session projection";
});
const summarySections = computed(() => {
  const summary = props.session.landingSummary;
  return summary === null ? [] : [
    { title: "Problem", body: summary.problem },
    { title: "Changes", body: summary.changes },
    { title: "Verification", body: summary.verification },
    { title: "Risks", body: summary.risks },
  ];
});
</script>

<template>
  <aside class="owner-gate-card" aria-labelledby="owner-gate-title">
    <p class="eyebrow">Human approval required</p>
    <h2 id="owner-gate-title">Ready for owner review</h2>
    <dl>
      <div><dt>Diff stat</dt><dd>{{ diffStat }}</dd></div>
      <div><dt>Gates</dt><dd>{{ passed }}/{{ session.gates.length }} passed</dd></div>
      <div><dt>Verdict</dt><dd>{{ session.reviewVerdict ?? "not required / not recorded" }}</dd></div>
      <div><dt>Candidate SHA</dt><dd><code>{{ session.candidateSha ?? "unavailable" }}</code></dd></div>
    </dl>
    <ul class="owner-gates">
      <li v-for="gate in session.gates" :key="gate.id"><strong>{{ gate.passed ? "PASS" : "FAIL" }}</strong> {{ gate.gateId }}</li>
    </ul>
    <section v-if="summarySections.length > 0" class="landing-summary" aria-labelledby="landing-summary-title">
      <h3 id="landing-summary-title">Landing summary</h3>
      <p class="summary-copy-note">Portable Markdown record · select and copy by hand</p>
      <article v-for="section in summarySections" :key="section.title">
        <h4>{{ section.title }}</h4>
        <p>{{ section.body }}</p>
      </article>
    </section>
    <p class="terminal-command">Run in a terminal: <code>awsf land {{ session.taskId }}</code></p>
    <p class="terminal-note">Landing happens in a terminal. This dashboard cannot approve or land a candidate.</p>
  </aside>
</template>
