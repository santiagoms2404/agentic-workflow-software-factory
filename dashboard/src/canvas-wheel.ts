import type { SessionCard } from "../shared/types.ts";

/**
 * The wheel: one component, three payloads.
 *
 * Runs in execution order, decision slides, plan milestones — all of them are
 * a sequence with one item in the middle and its neighbours turned away on
 * either side. Building three carousels would draw the same three pictures at
 * three times the cost, so the geometry lives here once and the payload is
 * whatever is slotted into it.
 *
 * The wheel does NOT wrap. A chain of attempts has a first and a last, and
 * spinning past the end back to the beginning would make a sequence look like a
 * loop — which is the one thing this view exists to show correctly.
 */

/** How many items sit either side of the middle before the wheel stops drawing. */
export const WHEEL_WINDOW = 2;

export interface WheelSlot {
  readonly index: number;
  /** Distance from the middle: 0 is centre, negative is behind, positive ahead. */
  readonly offset: number;
  readonly scale: number;
  readonly opacity: number;
  /** Degrees of turn away from the reader; the middle faces them squarely. */
  readonly turn: number;
}

const SCALE = [1, 0.74, 0.56] as const;
const OPACITY = [1, 0.5, 0.26] as const;
const TURN = [0, 20, 28] as const;

/**
 * The items to draw, nearest the middle last so the centre paints over its
 * neighbours without a stacking rule to maintain.
 */
export function wheelSlots(count: number, index: number, window = WHEEL_WINDOW): readonly WheelSlot[] {
  if (count <= 0) return [];
  const middle = clampIndex(index, count);
  const slots: WheelSlot[] = [];
  for (let offset = -window; offset <= window; offset += 1) {
    const at = middle + offset;
    if (at < 0 || at >= count) continue;
    const depth = Math.abs(offset);
    slots.push({
      index: at,
      offset,
      scale: SCALE[depth] ?? SCALE[SCALE.length - 1]!,
      opacity: OPACITY[depth] ?? OPACITY[OPACITY.length - 1]!,
      turn: offset === 0 ? 0 : Math.sign(offset) * -(TURN[depth] ?? TURN[TURN.length - 1]!),
    });
  }
  return slots.sort((left, right) => Math.abs(right.offset) - Math.abs(left.offset));
}

/**
 * How far to slide the whole wheel so the items it is actually drawing sit in
 * the middle of the stage.
 *
 * At either end there is nothing on one side, and without this the cards lean
 * against one edge and leave the other half of the stage empty — which is the
 * blank space this dashboard has been asked repeatedly to remove. Measured in
 * slot widths, so the component decides what a slot is worth in pixels.
 */
export function wheelShift(count: number, index: number, window = WHEEL_WINDOW): number {
  const offsets = wheelSlots(count, index, window).map((slot) => slot.offset);
  if (offsets.length === 0) return 0;
  return -(Math.min(...offsets) + Math.max(...offsets)) / 2;
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0));
}

/** One step, and no further than the ends: the wheel has a beginning and an end. */
export function stepIndex(index: number, delta: number, count: number): number {
  return clampIndex(index + delta, count);
}

export type WheelRelation =
  | { readonly kind: "attempt"; readonly text: string }
  | { readonly kind: "continuation"; readonly task: string; readonly text: string }
  | null;

/**
 * Why the item before this one is before it.
 *
 * The two recorded relationships and nothing else. It is read from the cards
 * themselves, so it cannot disagree with the decks the board draws from the
 * same two columns.
 */
export function relationBetween(
  previous: Pick<SessionCard, "taskId" | "attempt"> | undefined,
  current: Pick<SessionCard, "taskId" | "attempt" | "continuesTask"> | undefined,
): WheelRelation {
  if (previous === undefined || current === undefined) return null;
  if (previous.taskId === current.taskId) {
    return { kind: "attempt", text: `attempt ${current.attempt} of the same task` };
  }
  // Read forwards only: the later run is the one that continues the earlier,
  // which is what the deck's own order guarantees.
  if (current.continuesTask === previous.taskId) {
    return { kind: "continuation", task: previous.taskId, text: `continues ${previous.taskId}` };
  }
  // Two runs can share a deck through a third, so an adjacent pair is not
  // always directly related. Saying nothing is better than naming a link the
  // projection did not record.
  return null;
}

/**
 * The written reason behind a continuation, out of the run's own events.
 *
 * `awsf relate` demands a reason and the projector keeps it — but on an event
 * row, not on the `continues_task` column, because a column cannot hold it.
 * This is the only place in the dashboard that reads it back, which is most of
 * why the wheel is worth building: the driver wrote down why one task followed
 * another and until now nothing showed it to them again.
 */
export function relationReason(events: readonly { readonly type: string; readonly payload: unknown }[]): string | null {
  for (const event of events) {
    if (event.type !== "task_relation") continue;
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null || !("reason" in payload)) continue;
    const reason = (payload as { reason: unknown }).reason;
    if (typeof reason === "string" && reason.trim().length > 0) return reason.trim();
  }
  return null;
}
