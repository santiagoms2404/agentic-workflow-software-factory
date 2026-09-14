import type { Point } from "./canvas-layout.ts";

/**
 * Where the reader has dragged a dot, kept in this browser and nowhere else.
 *
 * A position is a preference, not evidence: it says where someone liked to
 * look at a thing, which has no business in a projection other people read.
 * So it goes to browser storage, and that is also what makes it survive a
 * reload — the simulation is deterministic and would otherwise settle the
 * graph back to its starting arrangement on every visit, silently undoing
 * whatever the reader had arranged.
 *
 * The store is passed in rather than reached for, because a blocked or absent
 * one is an ordinary state on this path and because a round trip through it is
 * then something a test can actually run.
 */

export const PIN_STORE = "awsf.canvas-layout";

/** The part of `Storage` this needs. Nothing here writes a second key. */
export interface PinStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The browser's own store, or null where there is none to reach.
 *
 * Private windows and blocked site data throw on the property itself, not only
 * on the call, so this is guarded rather than assumed.
 */
export function browserPins(): PinStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function point(value: unknown): Point | null {
  if (typeof value !== "object" || value === null) return null;
  const held = value as { x?: unknown; y?: unknown };
  // A stored file is as trustworthy as anything else a reader can edit by
  // hand: a coordinate that is not a finite number would put a dot at NaN and
  // take the whole drawing with it.
  if (!Number.isFinite(held.x) || !Number.isFinite(held.y)) return null;
  return { x: held.x as number, y: held.y as number };
}

export function readPins(store: PinStore | null, key: string = PIN_STORE): ReadonlyMap<string, Point> {
  if (store === null) return new Map();
  try {
    const raw = store.getItem(key);
    if (raw === null) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map();
    const pins = new Map<string, Point>();
    for (const [id, value] of Object.entries(parsed)) {
      const held = point(value);
      if (held !== null) pins.set(id, held);
    }
    return pins;
  } catch {
    // Unreadable or unparseable is an arrangement nobody has made yet, which
    // is a state the canvas draws perfectly well.
    return new Map();
  }
}

export function writePins(store: PinStore | null, pins: ReadonlyMap<string, Point>, key: string = PIN_STORE): void {
  if (store === null) return;
  try {
    store.setItem(key, JSON.stringify(Object.fromEntries(pins)));
  } catch {
    // The arrangement is a convenience; losing it costs nothing recorded.
  }
}
