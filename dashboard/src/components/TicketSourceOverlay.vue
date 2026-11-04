<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { BacklogTicket } from "../../shared/types.ts";
import { BUILD_PROMPT_HEADING, ticketSourceView } from "../backlog-view.ts";

const props = defineProps<{
  ticket: BacklogTicket;
  source: string | undefined;
  loading: boolean;
  error: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const closeControl = ref<HTMLButtonElement | null>(null);
const copyStatus = ref("");
const view = computed(() => props.source === undefined ? null : ticketSourceView(props.source));
const prompt = computed(() => view.value?.buildPrompt ?? null);
const sourceText = computed(() => view.value?.source);
let opener: HTMLElement | null = null;
let priorBodyOverflow = "";
let mousedownOnOverlay = false;

function onBackdropMousedown(event: MouseEvent): void {
  mousedownOnOverlay = event.target === event.currentTarget;
}

function onBackdropMouseup(event: MouseEvent): void {
  if (mousedownOnOverlay && event.target === event.currentTarget) {
    emit("close");
  }
  mousedownOnOverlay = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key === "Tab") {
    if (!dialog.value) return;
    const focusable = dialog.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first || !dialog.value.contains(document.activeElement)) {
        event.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last || !dialog.value.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
}

async function copyBuildPrompt(): Promise<void> {
  if (prompt.value === null) return;
  try {
    await navigator.clipboard.writeText(prompt.value.text);
    copyStatus.value = "Build prompt copied";
  } catch {
    copyStatus.value = "Build prompt could not be copied";
  }
}

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  priorBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKeydown);
  void nextTick(() => closeControl.value?.focus());
});

onUnmounted(() => {
  document.body.style.overflow = priorBodyOverflow;
  document.removeEventListener("keydown", onKeydown);
  opener?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="ticket-source-overlay"
      @mousedown="onBackdropMousedown"
      @mouseup="onBackdropMouseup"
    >
      <section
        ref="dialog"
        class="ticket-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-source-title"
      >
        <header class="ticket-source-dialog-head">
          <div>
            <p class="eyebrow">{{ ticket.plan }} · {{ ticket.id }}</p>
            <h2 id="ticket-source-title">{{ ticket.title }}</h2>
          </div>
          <button ref="closeControl" type="button" class="ticket-source-close" aria-label="Close ticket source" @click="emit('close')">close</button>
        </header>
        <div v-if="prompt" class="build-prompt-control">
          <code>{{ BUILD_PROMPT_HEADING }}</code>
          <button type="button" @click="copyBuildPrompt">copy build prompt</button>
          <span role="status" aria-live="polite">{{ copyStatus }}</span>
        </div>
        <div class="ticket-source-scroll">
          <p v-if="loading" class="ticket-source-status">loading source…</p>
          <p v-else-if="error" class="ticket-source-error">{{ error }}</p>
          <pre v-else-if="sourceText !== undefined" class="ticket-source">{{ sourceText }}</pre>
        </div>
      </section>
    </div>
  </Teleport>
</template>
