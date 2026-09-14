import type { CanvasGraph, CanvasNodeKind } from "./canvas-graph.ts";
import type { CanvasLayout, Point } from "./canvas-layout.ts";

/**
 * What the canvas screen holds that is not geometry: which kinds are shown,
 * where the camera is, and what is selected — all of it in the URL.
 *
 * Back has to restore the camera, the selection and the filters, and the URL is
 * the only store that survives a reload and a back button. It is the same
 * argument that put the plan in `#/backlog/<plan>`.
 */

export const CANVAS_KINDS = ["run", "session", "plan"] as const;

export const KIND_LABEL: Readonly<Record<CanvasNodeKind, string>> = {
  run: "runs",
  session: "driving sessions",
  plan: "plans",
};

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
}

export interface CanvasRoute {
  /** Kinds currently on the map. Absent from the URL means all of them. */
  readonly kinds: readonly CanvasNodeKind[];
  readonly selected: string | null;
  /** Absent means "fit the graph", which is what a first visit wants. */
  readonly camera: Camera | null;
  /**
   * The node whose own view is open, as a path segment: `#/canvas/run:abc`.
   *
   * A path rather than another query key, because opening a node is a place
   * you went and the browser's own Back should leave it. The camera, the
   * selection and the filters ride along in the query, so leaving the node
   * returns to the map exactly as it was rather than to a fresh one.
   */
  readonly opened: string | null;
}

const ALL_KINDS: readonly CanvasNodeKind[] = CANVAS_KINDS;

function readKinds(value: string | null): readonly CanvasNodeKind[] {
  if (value === null) return ALL_KINDS;
  const asked = value.split(",").filter((kind): kind is CanvasNodeKind => (ALL_KINDS as readonly string[]).includes(kind));
  // An empty or unreadable list means every kind, never an empty map: a URL
  // that renders nothing looks like a broken screen rather than a filter.
  return asked.length === 0 ? ALL_KINDS : ALL_KINDS.filter((kind) => asked.includes(kind));
}

function readCamera(value: string | null): Camera | null {
  if (value === null) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0]!, y: parts[1]!, zoom: clampZoom(parts[2]!) };
}

export const CANVAS_PATH = "#/canvas";

/** Whether a hash belongs to the canvas at all, opened node or not. */
export function isCanvasRoute(hash: string): boolean {
  return hash === CANVAS_PATH || hash.startsWith(`${CANVAS_PATH}?`) || hash.startsWith(`${CANVAS_PATH}/`);
}

/** `#/canvas/run:abc?kinds=run,plan&sel=run:abc&cam=12,-40,1.2` */
export function parseCanvasRoute(hash: string): CanvasRoute {
  const split = hash.includes("?") ? hash.indexOf("?") : hash.length;
  const path = hash.slice(0, split);
  const params = new URLSearchParams(hash.slice(split + 1));
  const selected = params.get("sel");
  const segment = path.startsWith(`${CANVAS_PATH}/`) ? decodeURIComponent(path.slice(CANVAS_PATH.length + 1)) : "";
  return {
    kinds: readKinds(params.get("kinds")),
    selected: selected !== null && selected.length > 0 ? selected : null,
    camera: readCamera(params.get("cam")),
    opened: segment.length > 0 ? segment : null,
  };
}

/**
 * Only what differs from the default is written, so an untouched canvas has a
 * clean URL and a reader can tell at a glance whether anything is filtered.
 */
export function canvasRouteHash(route: CanvasRoute): string {
  const path = route.opened === null ? CANVAS_PATH : `${CANVAS_PATH}/${route.opened}`;
  const parts: string[] = [];
  if (route.kinds.length !== ALL_KINDS.length) parts.push(`kinds=${route.kinds.join(",")}`);
  // Written by hand rather than with `URLSearchParams`, which percent-encodes
  // the commas and colons here into `%2C` and `%3A`. Both are legal unencoded
  // in a query, and this is an address the reader reads and shares with
  // themselves — `cam=120,-40,1.25` says what it is and `cam=120%2C-40%2C1.25`
  // does not. Parsing accepts either form, since the decoder handles both.
  if (route.selected !== null) parts.push(`sel=${route.selected}`);
  if (route.camera !== null) {
    const { x, y, zoom } = route.camera;
    parts.push(`cam=${Math.round(x)},${Math.round(y)},${zoom.toFixed(2)}`);
  }
  return parts.length === 0 ? path : `${path}?${parts.join("&")}`;
}

/**
 * The map with whole kinds removed.
 *
 * Switching off a kind is a FILTER: it takes those dots off the map, and takes
 * every line that ended on one with them. Selecting a dot is not that — it dims
 * the others and removes nothing. Two controls that both dimmed would leave
 * neither legible, which is why one lives in the corner and the other on the
 * canvas.
 */
export function filterGraph(graph: CanvasGraph, kinds: readonly CanvasNodeKind[]): CanvasGraph {
  const shown = new Set(kinds);
  const nodes = graph.nodes.filter((node) => shown.has(node.kind));
  const live = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => live.has(edge.from) && live.has(edge.to)),
    clusters: graph.clusters
      .map((cluster) => ({ ...cluster, nodeIds: cluster.nodeIds.filter((id) => live.has(id)) }))
      // A region drawn around one surviving session is a box around a dot.
      .filter((cluster) => cluster.nodeIds.length > 1),
    unplaced: graph.unplaced.filter((node) => shown.has(node.kind)),
  };
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Put the whole drawing on screen, centred, with room for the dots' own radius
 * at the edges. This is what a first visit gets and what `0` returns to.
 */
export function fitCamera(layout: CanvasLayout, viewport: Viewport, padding = 90): Camera {
  const width = layout.bounds.maxX - layout.bounds.minX;
  const height = layout.bounds.maxY - layout.bounds.minY;
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(width <= 0 || height <= 0 ? 1 : Math.min(usableWidth / width, usableHeight / height));
  const centreX = (layout.bounds.minX + layout.bounds.maxX) / 2;
  const centreY = (layout.bounds.minY + layout.bounds.maxY) / 2;
  return { x: viewport.width / 2 - centreX * zoom, y: viewport.height / 2 - centreY * zoom, zoom };
}

/** Where a node sits on screen, after the camera. */
export function screenPoint(point: Point, camera: Camera): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

/** Where a screen position sits in the drawing — what a drag needs. */
export function graphPoint(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

/**
 * Zoom about a fixed screen position, so the thing under the pointer stays
 * under it. Zooming about the origin instead slides the map away from whatever
 * the reader was looking at.
 */
export function zoomAbout(camera: Camera, at: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const scale = zoom / camera.zoom;
  return { x: at.x - (at.x - camera.x) * scale, y: at.y - (at.y - camera.y) * scale, zoom };
}

/** Dot radius from the runs behind it: free information, no extra colour. */
export function nodeRadius(weight: number): number {
  return 9 + Math.min(Math.max(weight, 0), 6) * 2.2;
}

/** Every node kind on the map, with how many of each, for the filter menu. */
export function kindCounts(graph: CanvasGraph): ReadonlyMap<CanvasNodeKind, number> {
  const counts = new Map<CanvasNodeKind, number>(CANVAS_KINDS.map((kind) => [kind, 0]));
  for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  return counts;
}

/**
 * Where opening a node goes.
 *
 * A run opens its own view on the canvas — the pipeline wheel — and carries the
 * map's state with it, so leaving returns to the map exactly as it was. The
 * session and plan views are the next two slices; until they exist those dots
 * go to the screen that already shows that thing, so nothing here is a control
 * that does nothing. Each is replaced by its own view in turn.
 */
export function openHref(
  node: { readonly kind: CanvasNodeKind; readonly id?: string; readonly ref: string | null; readonly sessionIds: readonly string[] },
  route?: CanvasRoute,
): string | null {
  if (node.kind === "session" && node.ref !== null) return `#/groups/${encodeURIComponent(node.ref)}`;
  if (node.kind === "plan" && node.ref !== null) return `#/backlog/${encodeURIComponent(node.ref)}`;
  if (node.sessionIds.length === 0) return null;
  if (node.id !== undefined && route !== undefined) return canvasRouteHash({ ...route, opened: node.id });
  return `#/sessions/${encodeURIComponent(node.sessionIds.at(-1)!)}`;
}
