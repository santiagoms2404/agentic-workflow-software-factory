<script setup lang="ts">
defineProps<{ title: string; count?: number | null; open: boolean }>();
defineEmits<{ toggle: [] }>();
</script>
<template>
  <section class="detail-section">
    <button class="detail-section-head" type="button" :aria-expanded="open" @click="$emit('toggle')">
      <span aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
      <strong>{{ title }}</strong>
      <span v-if="count !== null && count !== undefined">({{ count }})</span>
    </button>
    <div v-if="open" class="detail-section-body"><slot /></div>
  </section>
</template>
