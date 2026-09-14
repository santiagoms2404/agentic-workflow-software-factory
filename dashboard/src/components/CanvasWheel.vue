<script setup lang="ts">
import { computed } from "vue";
import { stepIndex, wheelShift, wheelSlots } from "../canvas-wheel.ts";

const props = defineProps<{
  /** One key per item, in order. The payload itself comes through the slot. */
  keys: readonly string[];
  index: number;
  /** What a marker on the spine is called, for the reader and for a screen reader. */
  label: string;
  /** A state class per item, so the spine carries colour without a legend. */
  tones?: readonly string[];
}>();
const emit = defineEmits<{ "update:index": [index: number] }>();

const slots = computed(() => wheelSlots(props.keys.length, props.index));
/**
 * Slide every seat by the same amount so what the wheel is drawing sits in the
 * middle of the stage. Applied to each seat's own offset rather than to the
 * stage, so it is measured in the same slot widths the offsets are — a shift
 * in stage widths is about twice too far and throws the middle card off the
 * panel entirely.
 */
const shift = computed(() => wheelShift(props.keys.length, props.index));
const atStart = computed(() => props.index <= 0);
const atEnd = computed(() => props.index >= props.keys.length - 1);
/**
 * One item is not a sequence.
 *
 * Most decks hold a single run — twenty-six of the owner's thirty-three dots —
 * and drawing a spine with one marker, two arrows that cannot move and a
 * counter reading "1 of 1" puts four controls on screen that do nothing. A
 * chain of one shows its card and nothing else, and the card takes the room
 * the spine was using.
 */
const alone = computed(() => props.keys.length <= 1);

function go(delta: number): void {
  emit("update:index", stepIndex(props.index, delta, props.keys.length));
}

function onKeydown(event: KeyboardEvent): void {
  if (alone.value) return;
  if (event.key === "ArrowLeft") go(-1);
  else if (event.key === "ArrowRight") go(1);
  else if (event.key === "Home") emit("update:index", 0);
  else if (event.key === "End") emit("update:index", props.keys.length - 1);
  else return;
  event.preventDefault();
}

/**
 * Scrolling over a lone card scrolls the page, as it would over any other card.
 * Swallowing the wheel to turn a sequence with nothing to turn to would trap
 * the reader halfway down a long panel.
 */
function onWheel(event: WheelEvent): void {
  if (alone.value) return;
  event.preventDefault();
  go(event.deltaY > 0 || event.deltaX > 0 ? 1 : -1);
}

function transform(scale: number, turn: number, offset: number): string {
  return `translateX(calc(-50% + ${offset * 62}%)) perspective(1400px) rotateY(${turn}deg) scale(${scale})`;
}
</script>

<template>
  <div
    class="wheel"
    :class="{ alone }"
    role="group"
    :aria-label="alone ? label : `${label}. Left and right arrows step, Home and End reach the ends.`"
    :tabindex="alone ? -1 : 0"
    @keydown="onKeydown"
    @wheel="onWheel"
  >
    <div class="wheel-stage">
      <!-- The wheel does not wrap: a chain of attempts has a first and a last,
           and spinning past the end back to the beginning would make a sequence
           look like a loop. The ends simply stop. -->
      <div
        v-for="slot in slots"
        :key="keys[slot.index] ?? String(slot.index)"
        class="wheel-seat"
        :class="{ middle: slot.offset === 0 }"
        :style="{ transform: transform(slot.scale, slot.turn, slot.offset + shift), opacity: String(slot.opacity), zIndex: String(10 - Math.abs(slot.offset)) }"
        :aria-hidden="slot.offset !== 0"
        @click="slot.offset === 0 ? undefined : emit('update:index', slot.index)"
      >
        <slot name="item" :index="slot.index" :middle="slot.offset === 0" />
      </div>
    </div>

    <!-- What sits between the middle card and the one before it: the recorded
         reason these two runs are in the same chain. -->
    <div v-if="$slots.between && !alone" class="wheel-between">
      <slot name="between" />
    </div>

    <nav v-if="!alone" class="wheel-spine neu-well" :aria-label="`${label} position`">
      <button
        type="button"
        class="wheel-step"
        :disabled="atStart"
        :aria-label="`Previous ${label}`"
        @click="go(-1)"
      >←</button>
      <!-- A chain of seven costs six spins to cross without this. Every item is
           a marker in its own state's colour, and clicking one jumps to it. -->
      <span class="wheel-markers">
        <button
          v-for="(key, at) in keys"
          :key="key"
          type="button"
          class="wheel-marker"
          :class="[tones?.[at], { current: at === index }]"
          :aria-label="`${label} ${at + 1} of ${keys.length}`"
          :aria-current="at === index"
          @click="emit('update:index', at)"
        />
      </span>
      <button
        type="button"
        class="wheel-step"
        :disabled="atEnd"
        :aria-label="`Next ${label}`"
        @click="go(1)"
      >→</button>
      <span class="wheel-count">{{ index + 1 }} of {{ keys.length }}</span>
    </nav>
  </div>
</template>
