<script setup lang="ts">
import { STATE_GROUPS } from "../../shared/route-metrics.ts";
import { COLUMN_FAMILIES, LEDGER_GROUPS, STATE_LABEL, STATE_TONE, type ColumnFamily, type LedgerGroup } from "../metrics-lens.ts";
import { FAMILY_LABEL, FLAT_TITLE, GROUP_LABEL, terminalStrip, type Ledger, type LedgerHeader, type LedgerRow } from "../metrics-ledger.ts";

const props = defineProps<{
  ledger: Ledger;
  families: readonly ColumnFamily[];
  /** The Run view's hash for a session, keeping the lens. */
  runHref: (sessionId: string) => string;
}>();

const emit = defineEmits<{
  group: [group: LedgerGroup];
  family: [family: ColumnFamily];
  sort: [column: string];
  open: [sessionId: string];
}>();

function openRow(row: LedgerRow): void {
  if (row.run !== null) emit("open", row.run);
}
/** Present attributes only: an unsorted header carries no aria-sort, and a live column no flat title. */
function headerAttrs(header: LedgerHeader): Record<string, string> {
  return { ...(header.flat ? { title: FLAT_TITLE } : {}), ...(header.ariaSort === undefined ? {} : { "aria-sort": header.ariaSort }) };
}
function titled(title: string | undefined): Record<string, string> {
  return title === undefined ? {} : { title };
}
function sortLabel(label: string, flat: boolean): string {
  return flat ? `${label} · flat` : label;
}
</script>

<template>
  <div class="ledger-view">
    <header class="metrics-view-head">
      <h2 class="metrics-view-title">Ledger</h2>
      <p class="metrics-view-lede">Pick a grouping and the column families you need. Click a header to sort. Grouped by run, a row opens that run. A column that is the same for every group is dimmed and marked flat: it carries no signal in this lens.</p>
    </header>

    <div class="ledger-bar" role="group" aria-label="Group by">
      <span class="ledger-bar-label" aria-hidden="true">group by</span>
      <button
        v-for="group in LEDGER_GROUPS"
        :key="group"
        type="button"
        class="metrics-pill"
        :aria-pressed="ledger.group === group"
        @click="emit('group', group)"
      >{{ GROUP_LABEL[group] }}</button>
    </div>
    <div class="ledger-bar" role="group" aria-label="Column families">
      <span class="ledger-bar-label" aria-hidden="true">columns</span>
      <button
        v-for="family in COLUMN_FAMILIES"
        :key="family"
        type="button"
        class="metrics-pill"
        :aria-pressed="props.families.includes(family)"
        @click="emit('family', family)"
      >{{ FAMILY_LABEL[family] }}</button>
    </div>
    <ul class="metrics-legend" aria-label="Terminal states">
      <li v-for="state in STATE_GROUPS" :key="state"><i :style="{ background: STATE_TONE[state] }" aria-hidden="true" />{{ STATE_LABEL[state] }}</li>
    </ul>

    <div class="ledger-scroll">
      <table class="ledger-table">
        <thead>
          <tr class="ledger-family-row">
            <th scope="col" class="ledger-key"><span class="metrics-sr">Group</span></th>
            <th v-for="head in ledger.families" :key="head.family" scope="colgroup" :colspan="head.span">{{ head.label }}</th>
          </tr>
          <tr>
            <th
              v-for="header in ledger.headers"
              :key="header.id"
              scope="col"
              :class="{ 'ledger-key': header.family === null, flat: header.flat, 'ledger-strip-head': header.id === 'strip' }"
              v-bind="headerAttrs(header)"
            >
              <button type="button" class="ledger-sort" @click="emit('sort', header.id)">{{ sortLabel(header.label, header.flat) }}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="ledger.rows.length === 0">
            <td class="ledger-key ledger-empty" :colspan="ledger.headers.length">No role-rows in this lens.</td>
          </tr>
          <tr
            v-for="row in ledger.rows"
            :key="row.key"
            :class="{ clickable: row.run !== null }"
            @click="openRow(row)"
          >
            <th scope="row" class="ledger-key">
              <span class="ledger-key-title">
                <i v-if="row.dot" class="metrics-dot" :style="{ background: row.dot }" aria-hidden="true" />
                <svg v-else-if="row.provider === 'openai'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" /></svg>
                <svg v-else-if="row.provider === 'anthropic'" class="metrics-glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg>
                <a v-if="row.run !== null" :href="props.runHref(row.run)" @click.stop>{{ row.title }}</a>
                <template v-else>{{ row.title }}</template>
              </span>
              <small>{{ row.detail }}<template v-if="row.run !== null"> · {{ row.stats.n }} role-rows</template></small>
            </th>
            <td v-for="column in ledger.columns" :key="column.id" :class="{ flat: ledger.flat.has(column.id) }" v-bind="titled(column.cell(row.stats).title)">
              <span v-if="column.strip" class="ledger-strip" role="img" :aria-label="column.cell(row.stats).title ?? 'terminal states'">
                <i
                  v-for="segment in terminalStrip(row.stats)"
                  :key="segment.state"
                  :style="{ flexGrow: segment.runs, background: segment.tone }"
                />
              </span>
              <template v-else-if="column.cell(row.stats).empty"><span class="ledger-dim">{{ column.cell(row.stats).text }}</span></template>
              <template v-else>{{ column.cell(row.stats).text }}<span v-if="column.cell(row.stats).note" class="ledger-ci">{{ column.cell(row.stats).note }}</span></template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
