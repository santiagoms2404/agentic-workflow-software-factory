import type { CanvasGraph } from "./canvas-graph.ts";

/**
 * Where the dots go: a force simulation that is also reproducible.
 *
 * The owner chose a physics layout over a computed one, and the usual cost of
 * that choice is that it can never be tested or screenshotted — a simulation
 * seeded with randomness draws a different picture every time. That cost is
 * avoidable and is not paid here. Every node starts from a position derived
 * from its own id, the timestep and the step count are fixed, and nothing calls
 * `Math.random`. The same graph therefore settles into the same picture on
 * every load, in every test, and in every screenshot — and it still drifts,
 * pushes and settles the way a node graph is supposed to.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CanvasLayout {
  readonly positions: ReadonlyMap<string, Point>;
  /** The drawing's extent, for fitting the camera to it. */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

/** Enough steps to settle a graph of this size; fixed, so the result is too. */
export const SETTLE_STEPS = 260;
const REPULSION = 52_000;
const SPRING = 0.045;
const SPRING_LENGTH = 168;
const CENTRING = 0.0035;
/**
 * The pull to the centre is stronger vertically than horizontally, so the graph
 * settles into a landscape ellipse instead of a circle.
 *
 * A circular graph fitted into a landscape viewport is limited by its height
 * and leaves half the width empty — which is the blank space this dashboard has
 * been asked twice to remove. Squashing the settled shape to roughly the
 * proportions of the surface it will be drawn on costs nothing and fills it.
 */
const VERTICAL_CENTRING = 2.1;
/** Nodes stop pushing at this distance, so a settled graph does not vibrate. */
const MIN_SEPARATION = 62;
const DAMPING = 0.82;
const STEP = 0.55;

/** FNV-1a over the id: a stable number per node, and never a random one. */
function hash(id: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * A phyllotaxis spiral, turned by the node's own hash.
 *
 * The spiral spaces nodes evenly from the centre so the simulation starts
 * spread out rather than exploding out of a single point, and the hash keeps a
 * node's starting angle its own — so adding one node does not re-seat every
 * other node and redraw a map the reader had learned.
 */
export function initialPositions(graph: CanvasGraph): ReadonlyMap<string, Point> {
  const positions = new Map<string, Point>();
  graph.nodes.forEach((node, index) => {
    const radius = 34 * Math.sqrt(index + 1);
    const angle = (hash(node.id) / 0x1_0000_0000) * Math.PI * 2 + index * 2.399_963;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return positions;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly pinned: boolean;
}

/**
 * One frame of the simulation.
 *
 * Repulsion between every pair, a spring along every edge, and a weak pull to
 * the centre so a disconnected node does not drift away forever. Quadratic in
 * the node count, which is the right trade at this size: the owner's whole
 * projection is under forty nodes, and an approximation would cost determinism.
 *
 * A pinned node takes part in every force it exerts and none that it feels.
 * That is what lets a dragged node stay exactly where it was dropped while the
 * rest of the graph arranges itself around it.
 */
export function stepSimulation(graph: CanvasGraph, bodies: Map<string, Body>): void {
  const ids = graph.nodes.map((node) => node.id);
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const one = bodies.get(ids[left]!);
      const other = bodies.get(ids[right]!);
      if (one === undefined || other === undefined) continue;
      let dx = other.x - one.x;
      let dy = other.y - one.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        // Exactly coincident nodes have no direction to push apart in, so they
        // are separated along a direction their ids agree on rather than a
        // random one.
        dx = ids[left]! < ids[right]! ? 0.01 : -0.01;
        dy = 0.01;
        distance = Math.hypot(dx, dy);
      }
      const push = REPULSION / (distance * distance);
      const ux = (dx / distance) * push;
      const uy = (dy / distance) * push;
      if (!one.pinned) { one.vx -= ux; one.vy -= uy; }
      if (!other.pinned) { other.vx += ux; other.vy += uy; }
      if (distance >= MIN_SEPARATION) continue;
      const overlap = (MIN_SEPARATION - distance) / 2;
      const ox = (dx / distance) * overlap;
      const oy = (dy / distance) * overlap;
      if (!one.pinned) { one.x -= ox; one.y -= oy; }
      if (!other.pinned) { other.x += ox; other.y += oy; }
    }
  }

  for (const edge of graph.edges) {
    const from = bodies.get(edge.from);
    const to = bodies.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    const pull = (distance - SPRING_LENGTH) * SPRING;
    const ux = (dx / distance) * pull;
    const uy = (dy / distance) * pull;
    if (!from.pinned) { from.vx += ux; from.vy += uy; }
    if (!to.pinned) { to.vx -= ux; to.vy -= uy; }
  }

  for (const id of ids) {
    const body = bodies.get(id);
    if (body === undefined || body.pinned) continue;
    body.vx = (body.vx - body.x * CENTRING) * DAMPING;
    body.vy = (body.vy - body.y * CENTRING * VERTICAL_CENTRING) * DAMPING;
    body.x += body.vx * STEP;
    body.y += body.vy * STEP;
  }
}

function bodiesFrom(
  graph: CanvasGraph,
  positions: ReadonlyMap<string, Point>,
  pinned: ReadonlyMap<string, Point>,
): Map<string, Body> {
  const bodies = new Map<string, Body>();
  for (const node of graph.nodes) {
    const fixed = pinned.get(node.id);
    const start = fixed ?? positions.get(node.id) ?? { x: 0, y: 0 };
    bodies.set(node.id, { x: start.x, y: start.y, vx: 0, vy: 0, pinned: fixed !== undefined });
  }
  return bodies;
}

function boundsOf(positions: ReadonlyMap<string, Point>): CanvasLayout["bounds"] {
  if (positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export interface LayoutOptions {
  /**
   * Nodes the reader has dragged, and where they dropped them.
   *
   * A preference, not evidence: it lives in the reader's browser and never in
   * the projection. Without it the simulation re-settles on every load and
   * silently undoes the arrangement — so a dragged node is pinned, and the
   * unpinned ones arrange themselves around it.
   */
  readonly pinned?: ReadonlyMap<string, Point>;
  readonly steps?: number;
}

/** Settle the graph from its deterministic start. Same input, same picture. */
export function layoutGraph(graph: CanvasGraph, options: LayoutOptions = {}): CanvasLayout {
  return settle(graph, initialPositions(graph), options);
}

/**
 * Settle from where the graph already is — what a drag needs, so the reader
 * sees the neighbours give way rather than the whole map jump to a new answer.
 */
export function settle(
  graph: CanvasGraph,
  from: ReadonlyMap<string, Point>,
  options: LayoutOptions = {},
): CanvasLayout {
  const bodies = bodiesFrom(graph, from, options.pinned ?? new Map());
  const steps = options.steps ?? SETTLE_STEPS;
  for (let step = 0; step < steps; step += 1) stepSimulation(graph, bodies);
  const positions = new Map<string, Point>();
  for (const [id, body] of bodies) positions.set(id, { x: body.x, y: body.y });
  return { positions, bounds: boundsOf(positions) };
}

/**
 * Stored positions for nodes the graph no longer has are dropped on read.
 *
 * A layout outlives the runs it was drawn around: a task is archived, a group
 * is renamed, and a position for a node nobody can see would otherwise sit in
 * the store forever, pinning empty space.
 */
export function retainedPins(
  graph: CanvasGraph,
  stored: ReadonlyMap<string, Point>,
): ReadonlyMap<string, Point> {
  const live = new Set(graph.nodes.map((node) => node.id));
  return new Map([...stored].filter(([id]) => live.has(id)));
}
