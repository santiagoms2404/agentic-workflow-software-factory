<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { type PaletteId, type ThemeMode, useLabPalette } from "../theme.ts";

defineProps<{
  project: string;
  sessionId: string | null;
  phaseName: string | null;
  settings: boolean;
  backlog: boolean;
  groups: boolean;
  canvas: boolean;
}>();

const paletteRoot = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const themeModes: ThemeMode[] = ["dark", "light", "system"];
const { palettes, selectedPalette, selectedMode, resolvedMode, choosePalette, chooseMode, swatchesFor } = useLabPalette();

async function openPaletteMenu(): Promise<void> {
  menuOpen.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role='menuitemradio'][aria-checked='true']")?.focus();
}
function closePaletteMenu(restoreFocus = false): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (restoreFocus) nextTick(() => trigger.value?.focus());
}
function togglePaletteMenu(): void {
  if (menuOpen.value) closePaletteMenu();
  else void openPaletteMenu();
}
function onDocumentPointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && !paletteRoot.value?.contains(event.target)) closePaletteMenu();
}
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && menuOpen.value) {
    event.preventDefault();
    closePaletteMenu(true);
  }
}
function onMenuKeydown(event: KeyboardEvent): void {
  const items = Array.from(menu.value?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? []);
  const current = event.target instanceof HTMLElement ? items.indexOf(event.target) : -1;
  let next = current;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (current + 1 + items.length) % items.length;
  else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]?.focus();
}
function setPalette(id: PaletteId): void { choosePalette(id); }
function setMode(mode: ThemeMode): void { chooseMode(mode); }

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});
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
      <template v-if="backlog">
        <span class="sep">›</span><span class="current">backlog</span>
      </template>
      <template v-if="groups">
        <span class="sep">›</span><span class="current">driving sessions</span>
      </template>
      <template v-if="canvas">
        <span class="sep">›</span><span class="current">canvas</span>
      </template>
    </nav>
    <div ref="paletteRoot" class="palette-control">
      <button
        ref="trigger"
        class="palette-trigger"
        type="button"
        aria-label="Lab palette"
        title="Lab palette"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        aria-controls="lab-palette-menu"
        @click="togglePaletteMenu"
        @keydown.down.prevent="openPaletteMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3h6M10 3v5l-5.5 9.2A2.5 2.5 0 0 0 6.6 21h10.8a2.5 2.5 0 0 0 2.1-3.8L14 8V3" />
          <path d="M7.5 15h9M9.5 12.2h5" />
        </svg>
      </button>
      <div
        v-if="menuOpen"
        id="lab-palette-menu"
        ref="menu"
        class="palette-popover"
        role="menu"
        aria-label="Lab palette"
        @keydown="onMenuKeydown"
      >
        <div class="palette-menu-head">
          <div><span class="eyebrow">Lab palette</span><strong>Color system</strong></div>
          <span>{{ resolvedMode }}</span>
        </div>
        <div class="palette-mode" role="group" aria-label="Mode">
          <span>Mode</span>
          <div class="mode-segments">
            <button
              v-for="option in themeModes"
              :key="option"
              type="button"
              role="menuitemradio"
              :aria-checked="selectedMode === option"
              :class="{ selected: selectedMode === option }"
              @click="setMode(option)"
            >{{ option[0]!.toUpperCase() + option.slice(1) }}</button>
          </div>
        </div>
        <div class="palette-list" role="group" aria-label="Palette">
          <button
            v-for="item in palettes"
            :key="item.id"
            type="button"
            class="palette-option"
            role="menuitemradio"
            :aria-checked="selectedPalette === item.id"
            :class="{ selected: selectedPalette === item.id }"
            @click="setPalette(item.id)"
          >
            <span class="palette-name">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.2 3 3L13 4.8" /></svg>
              <span>{{ item.name }}</span>
            </span>
            <span class="palette-swatches" aria-hidden="true">
              <i v-for="color in swatchesFor(item.id)" :key="color" :style="{ backgroundColor: color }" />
            </span>
          </button>
        </div>
      </div>
    </div>
    <a v-if="!settings && !backlog && !groups" class="settings-link" href="#/settings">Settings</a>
    <a v-if="!canvas" class="settings-link" href="#/canvas">Canvas</a>
    <a v-if="!groups" class="settings-link" href="#/groups">Sessions log</a>
    <a v-if="!backlog" class="settings-link" href="#/backlog">Backlog</a>
    <slot />
  </header>
</template>
