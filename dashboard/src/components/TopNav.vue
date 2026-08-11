<script setup lang="ts">
defineProps<{
  project: string;
  sessionId: string | null;
  phaseName: string | null;
  settings: boolean;
}>();
</script>

<template>
  <header class="top-nav">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <svg class="awsf-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="4" y="6" width="17" height="5" rx="2.5" fill="var(--amber)" />
        <rect x="8" y="13.5" width="20" height="5" rx="2.5" fill="var(--purple)" />
        <rect x="4" y="21" width="13" height="5" rx="2.5" fill="var(--cyan)" />
      </svg>
      <strong class="brand">{{ project }}</strong>
      <span class="sep">›</span>
      <a href="#/sessions" :aria-current="!sessionId && !settings ? 'page' : false">sessions</a>
      <template v-if="sessionId">
        <span class="sep">›</span>
        <a :href="`#/sessions/${sessionId}`" :aria-current="!phaseName ? 'page' : false">{{ sessionId.slice(0, 8) }}</a>
      </template>
      <template v-if="phaseName">
        <span class="sep">›</span><span class="current">{{ phaseName }}</span>
      </template>
      <template v-if="settings">
        <span class="sep">›</span><span class="current">settings</span>
      </template>
    </nav>
    <a v-if="!settings" class="settings-link" href="#/settings">Settings</a>
    <slot />
  </header>
</template>
