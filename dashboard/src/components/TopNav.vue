<script setup lang="ts">
defineProps<{ project: string }>();
</script>
<template>
  <header class="top-nav">
    <div class="crumb"><span class="mark">▰</span><strong>{{ project }}</strong><span>›</span><a href="#/sessions">sessions</a><a href="#/settings">settings</a></div>
    <div class="project-badge">AWSF</div>
    <slot />
  </header>
</template>
