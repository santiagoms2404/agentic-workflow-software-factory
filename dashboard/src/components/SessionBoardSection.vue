<script setup lang="ts">
import { computed } from "vue";
import type { GroupSummary, SessionCard as Session } from "../../shared/types.ts";
import type { BoardMember, BoardSection } from "../session-clusters.ts";
import { groupTitle } from "../session-groups.ts";
import SessionStack from "./SessionStack.vue";

const props = defineProps<{
  section: BoardSection<Session>;
  /** The recorded journals, so a member reads its ask rather than its id. */
  summaries: ReadonlyMap<string, GroupSummary>;
}>();

/**
 * Three levels, and each one appears only when it holds more than the level
 * below already shows: the cluster well exists only for two or more connected
 * sessions, the group card only for a run that recorded one, and the deck only
 * for two or more related runs. A run with no driving session takes no
 * container at all, which is why the board is unchanged on a projection where
 * no run carries a group.
 */
const clustered = computed(() => props.section.kind === "cluster");

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
    >
      <header class="board-group-head">
        <h3 class="board-group-title" :class="{ absent: member.groupIds.some((group) => (summaries.get(group)?.title ?? null) === null) }">
          {{ memberTitle(member) }}
        </h3>
        <p class="board-group-meta">
          <span v-if="member.groupIds.length > 1" class="board-group-span">spans</span>
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
          v-for="group in member.groupIds"
          :key="`open-${group}`"
          class="session-filter-control board-group-open"
          :href="`#/groups/${encodeURIComponent(group)}`"
        >{{ member.groupIds.length > 1 ? `tree · ${group}` : "open the tree" }}</a>
      </header>
      <!-- The scoped ELI summary under the title is a separate stream and is
           not built here. The place it sits is left empty rather than filled
           with a sentence nothing generated. -->
      <div v-if="member.stacks.length" class="board-group-grid">
        <SessionStack v-for="stack in member.stacks" :key="stack.key" :sessions="stack.sessions" />
      </div>
      <p v-else class="board-group-empty absent">No runs in this driving session match the current filters.</p>
    </article>
  </section>
</template>
