<script setup lang="ts">
import { computed, ref } from "vue";
import type { GroupSummary, SessionCard as Session } from "../../shared/types.ts";
import { COLLAPSED_STACK_LIMIT, memberSpan, sectionSpan, type BoardMember, type BoardSection } from "../session-clusters.ts";
import { groupTitle } from "../session-groups.ts";
import SessionStack from "./SessionStack.vue";

const props = defineProps<{
  section: BoardSection<Session>;
  /** The recorded journals, so a member reads its ask rather than its id. */
  summaries: ReadonlyMap<string, GroupSummary>;
}>();

/**
 * Three levels, and each one appears only when it holds more than the level
 * below already shows: the cluster panel exists only for two or more connected
 * sessions, the session card only for a run that recorded one, and the deck
 * only for two or more related runs. A run with no driving session takes no
 * container at all, which is why the board is unchanged on a projection where
 * no run carries a group.
 */
const clustered = computed(() => props.section.kind === "cluster");

/**
 * The sum of the session cards inside it, capped at the collapse limit, so the
 * card is exactly as wide as its contents. Sessions sit beside each other
 * rather than stacking, which is what closes the hole a narrower session used
 * to leave inside a card nothing else could be placed in.
 */
const span = computed(() => sectionSpan(props.section));

/** Sessions the reader has opened past the collapse limit. */
const opened = ref<readonly string[]>([]);

function isOpened(member: BoardMember<Session>): boolean {
  return opened.value.includes(member.key);
}

function toggle(member: BoardMember<Session>): void {
  opened.value = isOpened(member)
    ? opened.value.filter((key) => key !== member.key)
    : [...opened.value, member.key];
}

function visibleStacks(member: BoardMember<Session>): BoardMember<Session>["stacks"] {
  return isOpened(member) ? member.stacks : member.stacks.slice(0, COLLAPSED_STACK_LIMIT);
}

/**
 * One column per deck the session card shows, so a run card inside a session is
 * the same width as one outside it — and a session with one deck is one card
 * wide rather than a lone card stretched across the cluster.
 */
function columns(member: BoardMember<Session>): number {
  return memberSpan(member);
}

function hiddenStacks(member: BoardMember<Session>): number {
  return member.stacks.length - visibleStacks(member).length;
}

function memberTitle(member: BoardMember<Session>): string {
  if (member.groupIds.length === 0) return "no driving session";
  if (member.groupIds.length === 1) return groupTitle(props.summaries.get(member.groupIds[0]!) ?? null);
  // Two asks concatenated make a heading nobody reads and no session anyone
  // can pick out. The seam is named for what it is; each session's own ask
  // stays on its own card, one level down.
  return `work spanning ${member.groupIds.length} driving sessions`;
}

function memberRuns(member: BoardMember<Session>): number {
  return member.stacks.reduce((total, stack) => total + stack.sessions.length, 0);
}
</script>

<template>
  <!-- A deck with no driving session is rendered exactly as it was before this
       screen learned about groups: one grid cell, no wrapper, no heading. -->
  <SessionStack
    v-if="section.kind === 'run'"
    :sessions="section.members[0]?.stacks[0]?.sessions ?? []"
  />

  <section
    v-else
    class="board-section"
    :class="clustered ? 'board-cluster neu-well' : 'board-group-standalone'"
    :style="{ '--board-span': span }"
    :aria-label="clustered ? 'Connected driving sessions' : 'Driving session'"
  >
    <header v-if="clustered" class="board-cluster-head">
      <p class="eyebrow">connected driving sessions</p>
      <!-- The edges are read out of the runs below every time this renders.
           Nothing stores a group-to-group link, so it cannot disagree with the
           task chain it summarises. -->
      <p class="board-connection-note">
        {{ section.connections.length }} connection string(s) between {{ section.members.length }} session(s),
        read from the runs below and never stored
      </p>
      <p v-if="section.hiddenBridges.length" class="board-connection-hidden absent">
        {{ section.hiddenBridges.length }} run(s) carrying a connection here are hidden by the current filters;
        these sessions stay together because the connection is still on record.
      </p>
    </header>

    <article
      v-for="member in section.members"
      :key="member.key"
      class="board-group"
      :class="{ spanning: member.groupIds.length > 1, empty: member.stacks.length === 0 }"
      :style="{ '--member-span': columns(member) }"
    >
      <!-- The control that opens the tree sits INSIDE the card, in its own
           top-right corner. A control parked beside the card is one the reader
           has to scroll sideways to reach, and the card is what it belongs to.
           The ELI summary under the title is a separate stream: the place it
           sits is left empty rather than filled with a generated sentence. -->
      <header class="board-group-head">
        <h3 class="board-group-title" :class="{ absent: member.groupIds.some((group) => (summaries.get(group)?.title ?? null) === null) }">
          {{ memberTitle(member) }}
        </h3>
        <p class="board-group-meta">
          <code v-for="group in member.groupIds" :key="group">{{ group }}</code>
          <span :class="{ absent: memberRuns(member) === 0 }">
            {{ memberRuns(member) === 0 ? "no runs on this board" : `${memberRuns(member)} run(s) here` }}
          </span>
          <!-- A deck stays whole, so a run that predates `--group` travels with
               the related run that carries one. Said out loud rather than left
               for the reader to assume every card here recorded this session. -->
          <span v-if="member.unsessioned" class="absent">
            {{ member.unsessioned }} of them recorded no driving session
          </span>
        </p>
        <a
          v-if="member.groupIds.length === 1"
          class="board-group-open"
          :href="`#/groups/${encodeURIComponent(member.groupIds[0]!)}`"
          :aria-label="`Open the decision tree for ${member.groupIds[0]}`"
          title="Open the decision tree"
        ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.7 10.3 10.3 5.7M6.3 5.7h4v4" /></svg></a>
      </header>

      <!-- A deck spanning two sessions has two trees to open, so they are named
           rather than folded into one unlabelled corner button. -->
      <p v-if="member.groupIds.length > 1" class="board-group-trees">
        <a
          v-for="group in member.groupIds"
          :key="`open-${group}`"
          class="session-filter-control board-group-tree-link"
          :href="`#/groups/${encodeURIComponent(group)}`"
        >tree · {{ group }}</a>
      </p>

      <div v-if="member.stacks.length" class="board-group-grid" :style="{ '--member-columns': columns(member) }">
        <SessionStack v-for="stack in visibleStacks(member)" :key="stack.key" :sessions="stack.sessions" />
      </div>
      <p v-else class="board-group-empty absent">No runs in this driving session match the current filters.</p>

      <!-- Past the limit the card keeps its width and grows a control, instead
           of taking the whole board row and leaving the space beside it empty. -->
      <button
        v-if="member.stacks.length > COLLAPSED_STACK_LIMIT"
        type="button"
        class="board-group-expand"
        :aria-expanded="isOpened(member)"
        @click="toggle(member)"
      >
        <span class="board-group-expand-count">{{ member.stacks.length }} decks in this driving session</span>
        <span class="board-group-expand-action">{{ isOpened(member) ? "show fewer" : `show all · +${hiddenStacks(member)}` }}</span>
      </button>
    </article>
  </section>
</template>
