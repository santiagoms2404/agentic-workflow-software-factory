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
</script>
<template><aside class="owner-gate-card" aria-labelledby="owner-gate-title"><p class="eyebrow">Human approval required</p><h2 id="owner-gate-title">Ready for owner review</h2><dl><div><dt>Diff stat</dt><dd>{{ diffStat }}</dd></div><div><dt>Gates</dt><dd>{{ passed }}/{{ session.gates.length }} passed</dd></div><div><dt>Verdict</dt><dd>{{ session.reviewVerdict ?? "not required / not recorded" }}</dd></div><div><dt>Candidate SHA</dt><dd><code>{{ session.candidateSha ?? "unavailable" }}</code></dd></div></dl><ul class="owner-gates"><li v-for="gate in session.gates" :key="gate.id"><strong>{{ gate.passed ? "PASS" : "FAIL" }}</strong> {{ gate.gateId }}</li></ul><p class="terminal-command">Run in a terminal: <code>awsf land {{ session.taskId }}</code></p><p class="terminal-note">Landing happens in a terminal. This dashboard cannot approve or land a candidate.</p></aside></template>
