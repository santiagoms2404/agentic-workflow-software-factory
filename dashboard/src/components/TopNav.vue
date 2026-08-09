<script setup lang="ts">
defineProps<{ project: string }>();
</script>
<template>
  <header class="top-nav">
    <div class="crumb"><span class="mark">▰</span><strong>{{ project }}</strong><span>›</span><span>sessions</span></div>
    <div class="project-badge">AWSF</div>
    <slot />
  </header>
</template>
