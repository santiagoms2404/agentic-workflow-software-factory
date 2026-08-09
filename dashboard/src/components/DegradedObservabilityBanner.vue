<script setup lang="ts">defineProps<{ degradedSessions: number }>();</script>
<template><aside v-if="degradedSessions > 0" class="degraded" role="status">Observability is degraded for {{ degradedSessions }} {{ degradedSessions === 1 ? "session" : "sessions" }}. Data may be delayed.</aside></template>
