<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { BacklogTicket, EventsResponse, GroupSummary, GroupTree, SessionCard, SessionPlan, TicketsResponse } from "../../shared/types.ts";
import { buildCanvasGraph, type CanvasNodeKind } from "../canvas-graph.ts";
import type { Point } from "../canvas-layout.ts";
import {
  CANVAS_KINDS,
  canvasRouteHash,
  filterGraph,
  kindCounts,
  KIND_LABEL,
  openHref,
  type Camera,
  type CanvasRoute,
} from "../canvas-view.ts";
import { browserPins, readPins, writePins } from "../canvas-pins.ts";
import { askLine, decisionSlides, elsewhere } from "../canvas-session.ts";
import { clampIndex, relationBetween, relationReason } from "../canvas-wheel.ts";
import { stateTone } from "../display.ts";
import CanvasMap from "../components/CanvasMap.vue";
import CanvasDecisionSlide from "../components/CanvasDecisionSlide.vue";
import CanvasPlanBoard from "../components/CanvasPlanBoard.vue";
import CanvasRunCard from "../components/CanvasRunCard.vue";
import GroupDecisionTree from "../components/GroupDecisionTree.vue";
import GroupTreeGraph from "../components/GroupTreeGraph.vue";
import CanvasWheel from "../components/CanvasWheel.vue";

const props = defineProps<{
  sessions: readonly SessionCard[];
  plans: readonly SessionPlan[];
  groups: readonly GroupSummary[];
  route: CanvasRoute;
}>();

const map = ref<InstanceType<typeof CanvasMap> | null>(null);
/**
 * Focus across the open and the return.
 *
 * Opening a node swaps the map out for the opened panel, so focus would fall
 * to the document twice — once on the way in and once on the way back — and a
 * keyboard reader would start again at the top of the page each time, having
 * lost the dot they were reading from.
 *
 * On the way in it lands on the panel itself rather than on the first link in
 * it: the panel is what opened, a screen reader announces it, and Tab then
 * walks forward into the content instead of past it. Nothing has to trap focus
 * inside, because the map is `v-else` in this chain and simply does not exist
 * while a node is open. On the way back it returns to the dot that was opened,
 * or to its entry in the parked rail when the map was never drawing it.
 */
const panel = ref<HTMLElement | null>(null);
const parked = new Map<string, HTMLElement>();

function holdParked(id: string, element: unknown): void {
  if (element === null || element === undefined) parked.delete(id);
  else parked.set(id, element as HTMLElement);
}

watch(() => props.route.opened, async (now, before) => {
  // Lazily, so arriving with `opened` already in the address moves nothing:
  // the reader did not navigate, they landed.
  await nextTick();
  if (now !== null) { panel.value?.focus(); return; }
  if (before === null || before === undefined) return;
  if (map.value?.focusNode(before) !== true) parked.get(before)?.focus();
});
const graph = computed(() => buildCanvasGraph(props.sessions, props.groups, props.plans));
const shown = computed(() => filterGraph(graph.value, props.route.kinds));
const counts = computed(() => kindCounts(graph.value));

/**
 * Where the reader has dragged a dot, read back from this browser on arrival.
 *
 * The reading and the writing live in `canvas-pins.ts` so the round trip a
 * drop has to survive — dropped, stored, read again on the next load, honoured
 * by the simulation — is something a test can run rather than something the
 * component asserts about itself.
 */
const store = browserPins();
const pinned = ref<ReadonlyMap<string, Point>>(readPins(store));

function keepPins(next: ReadonlyMap<string, Point>): void {
  pinned.value = next;
  writePins(store, next);
}

function go(next: Partial<CanvasRoute>): void {
  location.hash = canvasRouteHash({ ...props.route, ...next });
}

function toggleKind(kind: CanvasNodeKind): void {
  const has = props.route.kinds.includes(kind);
  const next = has ? props.route.kinds.filter((candidate) => candidate !== kind) : [...props.route.kinds, kind];
  // Every kind off is every kind on: a map showing nothing reads as broken
  // rather than as filtered, and there would be no control left to undo it.
  go({ kinds: next.length === 0 ? CANVAS_KINDS : CANVAS_KINDS.filter((candidate) => next.includes(candidate)) });
}

/* --- The opened run: its deck, in execution order ------------------------- */

const opened = computed(() => {
  if (props.route.opened === null) return null;
  // The parked rail opens too: a plan nothing has run against still has its
  // tickets, and a session whose runs are elsewhere still has its journal.
  return graph.value.nodes.find((node) => node.id === props.route.opened)
    ?? graph.value.unplaced.find((node) => node.id === props.route.opened)
    ?? null;
});

const byId = computed(() => new Map(props.sessions.map((session) => [session.sessionId, session])));
/** The deck's runs, oldest first, which is the order they ran in. */
const chain = computed<readonly SessionCard[]>(() =>
  (opened.value?.sessionIds ?? []).map((id) => byId.value.get(id)).filter((run): run is SessionCard => run !== undefined));

const at = ref(0);
watch(() => props.route.opened, () => { at.value = 0; reason.value = null; });
watch(chain, (next) => { at.value = clampIndex(at.value, next.length); });

const middle = computed(() => chain.value[clampIndex(at.value, chain.value.length)]);
const previous = computed(() => chain.value[clampIndex(at.value, chain.value.length) - 1]);
const relation = computed(() => relationBetween(previous.value, middle.value));

/**
 * The written reason behind a continuation.
 *
 * `awsf relate` demands one and the projector keeps it on an event row rather
 * than on the `continues_task` column, which cannot hold it. This is the only
 * place in the dashboard that reads it back — the driver wrote down why one
 * task followed another and until now nothing showed it to them again. Fetched
 * for the middle run only, and only when the pair is actually a continuation.
 */
const reason = ref<string | null>(null);
watch([middle, relation], async ([run, link]) => {
  reason.value = null;
  if (run === undefined || link === null || link.kind !== "continuation") return;
  try {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(run.sessionId)}/events`);
    if (!response.ok) return;
    const payload = await response.json() as EventsResponse;
    reason.value = relationReason(payload.events);
  } catch {
    // A reason that cannot be fetched is shown as unavailable, never invented.
  }
});

/* --- The opened driving session: its journal, three ways ------------------ */

/**
 * Slides, reading, tree — one control with three positions, not two switches
 * whose four states include two that describe nothing. It opens on slides when
 * you arrive from the map, because the map is where you came to follow a
 * story; the sessions board still opens the tree on its own screen.
 */
const view = ref<"slides" | "reading" | "tree">("slides");
const tree = ref<GroupTree | null>(null);
const treeError = ref<string | null>(null);
const slides = computed(() => decisionSlides(tree.value));
const slideAt = ref(0);

watch(() => opened.value?.kind === "session" ? opened.value.ref : null, async (group) => {
  tree.value = null;
  treeError.value = null;
  view.value = "slides";
  slideAt.value = 0;
  if (group === null || group === undefined) return;
  try {
    const response = await fetch(`/api/v1/groups?group=${encodeURIComponent(group)}`);
    if (!response.ok) {
      treeError.value = response.status === 404
        ? "No planning journal exists for this driving session."
        : "The journal could not be read.";
      return;
    }
    const payload = await response.json() as GroupTree;
    if (payload.group !== group) {
      treeError.value = "The journal returned did not match this driving session.";
      return;
    }
    tree.value = payload;
  } catch {
    treeError.value = "The journal could not be read.";
  }
}, { immediate: true });

watch(slides, (next) => { slideAt.value = clampIndex(slideAt.value, next.length); });
const slide = computed(() => slides.value[clampIndex(slideAt.value, slides.value.length)]);

/* --- The opened plan: what it asks for, and what came out of it ----------- */

const openedPlan = computed(() =>
  opened.value?.kind === "plan"
    ? props.plans.find((plan) => plan.id === opened.value?.ref) ?? null
    : null);
const tickets = ref<readonly BacklogTicket[]>([]);
const ticketsError = ref<string | null>(null);

watch(openedPlan, async (plan) => {
  ticketsError.value = null;
  if (plan === null) return;
  // Fetched when a plan is opened rather than with the board, because the
  // ticket set is large and nothing else on this screen needs it.
  try {
    const response = await fetch("/api/v1/tickets");
    if (!response.ok) { ticketsError.value = "The ticket set could not be read."; return; }
    tickets.value = (await response.json() as TicketsResponse).tickets;
  } catch {
    ticketsError.value = "The ticket set could not be read.";
  }
}, { immediate: true });

const selectedNode = computed(() =>
  shown.value.nodes.find((node) => node.id === props.route.selected)
  ?? graph.value.unplaced.find((node) => node.id === props.route.selected)
  ?? null);

/**
 * Clear a selection the FILTER has hidden, and only that.
 *
 * A highlight nobody can see, with no control on screen to bring it back, is
 * worth clearing. A node that is in neither the map nor the parked list is a
 * different thing entirely: usually the page has simply not loaded yet. The
 * first cut cleared on absence alone, and because the group list resolves
 * before the session list, it fired once against an empty graph and threw away
 * the selection every reader arrived with in their URL.
 */
watch(shown, (next) => {
  const selected = props.route.selected;
  if (selected === null) return;
  const recorded = (nodes: readonly { readonly id: string }[]): boolean => nodes.some((node) => node.id === selected);
  // On the map and hidden — nothing else. A node in the parked rail was never
  // on the map, so a selection naming one is not something the filter hid; and
  // during the load, before any run has arrived, EVERY recorded session is
  // parked, which is how the first two versions of this guard came to throw
  // away the selection the reader arrived with.
  if (recorded(graph.value.nodes) && !recorded(next.nodes)) go({ selected: null });
});
</script>

<template>
  <main class="canvas-route canvas-shell">
    <div class="canvas-rail">
      <header class="canvas-head neu-well">
        <p class="eyebrow">read-only execution map</p>
        <h1>Canvas</h1>
        <p class="canvas-head-note">
          {{ shown.nodes.length }} on the map · {{ shown.edges.length }} connection(s)
        </p>
      </header>

      <section class="canvas-filter neu-well" aria-labelledby="canvas-filter-title">
        <div class="session-filter-heading">
          <h2 id="canvas-filter-title">Show</h2>
          <!-- The only way back to how it first drew, which is what makes
               keeping an arrangement safe: drop a dot anywhere and it stays
               there until this is pressed. -->
          <button type="button" class="session-filter-control" @click="map?.reset()">reset the map</button>
        </div>
        <!-- A filter REMOVES a kind and takes its lines with it. Selecting a dot
             does not: it dims the others and removes nothing. Two controls that
             both dimmed would leave neither legible. -->
        <div class="canvas-filter-options" role="group" aria-label="Node kinds">
          <button
            v-for="kind in CANVAS_KINDS"
            :key="kind"
            type="button"
            class="session-filter-option canvas-kind"
            :class="[`canvas-kind-${kind}`, { selected: route.kinds.includes(kind) }]"
            :aria-pressed="route.kinds.includes(kind)"
            @click="toggleKind(kind)"
          >
            <span class="canvas-kind-dot" aria-hidden="true" />
            <span>{{ KIND_LABEL[kind] }}</span>
            <span class="session-filter-count">{{ counts.get(kind) ?? 0 }}</span>
          </button>
        </div>
      </section>

      <section v-if="selectedNode" class="canvas-selected neu-well" aria-live="polite">
        <p class="eyebrow">selected</p>
        <h2 class="canvas-selected-title">{{ selectedNode.label }}</h2>
        <p class="canvas-selected-meta">
          <code>{{ selectedNode.kind }}</code>
          <span>{{ selectedNode.weight }} run(s) behind it</span>
        </p>
        <!-- The one-line plain-language summary belongs here. A separate stream
             writes it; until then the place it sits says so rather than being
             filled with a sentence nothing generated. -->
        <p class="canvas-selected-summary absent">no summary written yet</p>
        <a v-if="openHref(selectedNode, route)" class="session-filter-control canvas-open" :href="openHref(selectedNode, route) ?? '#'">
          open this
        </a>
      </section>

      <!-- Recorded, but nothing puts it on the map: a session whose runs are
           all elsewhere, or a plan no run has named. On the real projection
           that is fourteen of forty-seven. Dropping them would make a recorded
           session unreachable; leaving them adrift in the drawing would make a
           third of the map look broken. -->
      <section v-if="shown.unplaced.length" class="canvas-parked neu-well" aria-labelledby="canvas-parked-title">
        <div class="session-filter-heading">
          <h2 id="canvas-parked-title">Not on the map</h2>
          <span class="canvas-parked-note">no run points at these yet</span>
        </div>
        <div class="canvas-parked-list">
          <a
            v-for="node in shown.unplaced"
            :key="node.id"
            :ref="(element) => holdParked(node.id, element)"
            class="canvas-parked-item session-filter-option"
            :class="`canvas-kind-${node.kind}`"
            :href="openHref(node) ?? '#'"
          >
            <span class="canvas-kind-dot" aria-hidden="true" />
            <span class="canvas-parked-label">{{ node.label }}</span>
          </a>
        </div>
      </section>
    </div>

    <!-- A run opens its own view: the deck as a pipeline, the run you came for
         in the middle. The map's state rides in the query, so leaving returns
         to it exactly as it was. -->
    <section v-if="opened && opened.kind === 'run' && chain.length" ref="panel" tabindex="-1" class="canvas-opened canvas-board neu-well">
      <header class="canvas-opened-head">
        <a class="session-filter-control" :href="canvasRouteHash({ ...route, opened: null })">← the map</a>
        <p class="canvas-opened-title">{{ opened.label }}</p>
        <p class="canvas-opened-meta">{{ chain.length }} run(s) in this chain, oldest first</p>
      </header>
      <CanvasWheel
        v-model:index="at"
        :keys="chain.map((run) => run.sessionId)"
        :tones="chain.map((run) => stateTone(run.state))"
        label="run"
      >
        <template #item="{ index, middle: isMiddle }">
          <CanvasRunCard :session="chain[index]!" :middle="isMiddle" />
        </template>
        <template #between>
          <p v-if="relation" class="canvas-relation">
            <span class="canvas-relation-kind">{{ relation.text }}</span>
            <!-- `awsf relate` demands a reason and `awsf new --continues` takes
                 none, so an absent one is a fact about how the link was made
                 rather than something the dashboard lost. -->
            <span v-if="relation.kind === 'continuation'" :class="{ absent: reason === null }">
              {{ reason ?? "no reason was recorded — this link was declared at `awsf new --continues`, which takes none" }}
            </span>
          </p>
          <p v-else-if="at === 0" class="canvas-relation">
            <span class="canvas-relation-kind">the first run in this chain</span>
          </p>
          <p v-else class="canvas-relation absent">the record does not say how these two are related</p>
        </template>
      </CanvasWheel>
    </section>

    <!-- A driving session opens its journal: the decisions as a sequence, or
         either of the two readings that already exist. -->
    <section v-else-if="opened && opened.kind === 'session'" ref="panel" tabindex="-1" class="canvas-opened canvas-board neu-well">
      <header class="canvas-opened-head">
        <a class="session-filter-control" :href="canvasRouteHash({ ...route, opened: null })">← the map</a>
        <p class="canvas-opened-title">{{ opened.label }}</p>
        <div class="canvas-view-switch" role="group" aria-label="View">
          <button
            v-for="mode in (['slides', 'reading', 'tree'] as const)"
            :key="mode"
            type="button"
            class="session-filter-control"
            :class="{ selected: view === mode }"
            :aria-pressed="view === mode"
            @click="view = mode"
          >{{ mode }}</button>
        </div>
      </header>

      <p v-if="treeError" class="absent">{{ treeError }}</p>
      <p v-else-if="!tree" class="absent">Reading the journal…</p>
      <template v-else>
        <template v-if="view === 'slides'">
          <p v-if="!slides.length" class="absent">No decision has been applied in this driving session.</p>
          <template v-else>
            <!-- The owner's own words that this decision came out of, pinned
                 above the wheel and changing as it turns. That is what "how
                 this ask became these tasks" looks like, one slide at a time. -->
            <div class="canvas-ask">
              <p class="decision-voice">the ask this decision came out of</p>
              <p :class="{ absent: askLine(slide?.ask ?? null) === null }">
                {{ askLine(slide?.ask ?? null) ?? "no recorded ask precedes this decision" }}
              </p>
            </div>
            <CanvasWheel
              v-model:index="slideAt"
              :keys="slides.map((item) => item.key)"
              label="decision"
            >
              <template #item="{ index, middle: isMiddle }">
                <CanvasDecisionSlide :decision="slides[index]!.decision" :middle="isMiddle" />
              </template>
            </CanvasWheel>
            <p v-if="elsewhere(tree)" class="canvas-elsewhere absent">{{ elsewhere(tree) }}</p>
          </template>
        </template>
        <!-- Both readings are the components that already exist, at the width
             this canvas gives them. A third rendering of one journal would be
             a third thing to keep true. -->
        <GroupDecisionTree v-else-if="view === 'reading'" :tree="tree" />
        <GroupTreeGraph v-else :tree="tree" />
      </template>
    </section>

    <!-- A plan opens the work it asks for, built from the ticket data the
         dashboard already serves. Rendering the plan's own file would need a
         route serving local files and a second stylesheet in the shell. -->
    <section v-else-if="opened && opened.kind === 'plan'" ref="panel" tabindex="-1" class="canvas-opened canvas-board neu-well">
      <header class="canvas-opened-head">
        <a class="session-filter-control" :href="canvasRouteHash({ ...route, opened: null })">← the map</a>
        <p class="canvas-opened-title">{{ opened.label }}</p>
        <p class="canvas-opened-meta">{{ openedPlan?.kind ?? "plan" }}<template v-if="openedPlan?.parentSpineName"> · under {{ openedPlan.parentSpineName }}</template></p>
      </header>
      <p v-if="ticketsError" class="absent">{{ ticketsError }}</p>
      <p v-else-if="!openedPlan" class="absent">The catalog no longer registers this plan.</p>
      <CanvasPlanBoard v-else :plan="openedPlan" :tickets="tickets" :sessions="sessions" />
    </section>

    <CanvasMap
      v-else
      ref="map"
      class="canvas-board"
      :graph="shown"
      :camera="route.camera"
      :selected="route.selected"
      :pinned="pinned"
      :route="route"
      @update:camera="go({ camera: $event })"
      @update:selected="go({ selected: $event })"
      @update:pinned="keepPins($event)"
    />

    <!-- Pan and zoom over thirty-odd dots on a phone is a second set of
         gestures to design and keep, for a screen that fits four of them. -->
    <p class="canvas-too-narrow neu-well">
      The map needs a wider screen. <a href="#/sessions">The sessions board</a> shows the same runs here.
    </p>
  </main>
</template>
