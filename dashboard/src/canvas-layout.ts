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
const REPLAY_ORBIT_LIMIT = 1.4;
const REGION_GAP = 120;

/** FNV-1a over the id: a stable number per node, and never a random one. */
function hash(id: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

interface ReplayFamily {
  readonly region: string;
  readonly hub: string | null;
  readonly pair: string;
  readonly runs: readonly string[];
}

/** Relations only: no grouping information is recovered from node names. */
function replayFamilies(graph: CanvasGraph): ReplayFamily[] {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  return graph.nodes.filter((node) => node.kind === "pair")
    .map((node) => ({
      region: graph.clusters.find((cluster) => cluster.nodeIds.includes(node.id))?.key ?? node.id,
      hub: graph.edges.find((edge) => edge.kind === "replay" && edge.from === node.id && kinds.get(edge.to) === "proving-ground")?.to ?? null,
      pair: node.id,
      runs: graph.edges.filter((edge) => edge.kind === "replay" && edge.to === node.id && kinds.get(edge.from) === "run")
        .map((edge) => edge.from).sort(),
    })).sort((left, right) => left.pair.localeCompare(right.pair));
}

function familyRadius(count: number): number {
  return Math.max(90, count * MIN_SEPARATION / (2 * Math.PI));
}

/** Ordinary nodes keep their hashed spiral; replay pairs start in disjoint neighbourhoods. */
export function initialPositions(graph: CanvasGraph): ReadonlyMap<string, Point> {
  const positions = new Map<string, Point>();
  const families = replayFamilies(graph);
  const replayIds = new Set(families.flatMap((family) => [...(family.hub === null ? [] : [family.hub]), family.pair, ...family.runs]));
  const ordinary = graph.nodes.filter((node) => !replayIds.has(node.id));
  ordinary.forEach((node, index) => {
    const radius = 34 * Math.sqrt(index + 1);
    const angle = (hash(node.id) / 0x1_0000_0000) * Math.PI * 2 + index * 2.399_963;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  seedReplayPositions(positions, families, ordinary.length === 0 ? null : boundsOf(positions));
  return positions;
}

/** Pack disjoint pair neighbourhoods without widening an already-wide drawing. */
function seedReplayPositions(
  positions: Map<string, Point>,
  families: readonly ReplayFamily[],
  ordinary: CanvasLayout["bounds"] | null,
): void {
  if (families.length === 0) return;
  // Leave forty units between the largest settled run orbits, rather than a
  // whole extra orbit. The same limit is enforced by the replay simulation.
  const extent = Math.max(...families.map((family) => familyRadius(family.runs.length))) * REPLAY_ORBIT_LIMIT;
  const spacing = extent * 2 + 40;
  const keys = [...new Set(families.map((family) => family.region))].sort();
  const ordinaryWidth = ordinary === null ? 0 : ordinary.maxX - ordinary.minX;
  const below = ordinary !== null && ordinaryWidth >= ordinary.maxY - ordinary.minY;
  const availableWidth = (ordinaryWidth - REGION_GAP * (keys.length - 1)) / keys.length;
  const regions = keys.map((key) => {
    const pairs = families.filter((family) => family.region === key);
    // Below a wide drawing, use its existing width to avoid unnecessary rows.
    const columns = Math.min(pairs.length, Math.max(Math.ceil(Math.sqrt(pairs.length)),
      below ? Math.floor((availableWidth - extent * 2) / spacing) + 1 : 0));
    const hub = pairs[0]!.hub;
    const minY = Math.min(-extent, hub === null ? 0 : -spacing * 0.65);
    return { pairs, columns, hub, minY, width: (columns - 1) * spacing + extent * 2,
      height: (Math.ceil(pairs.length / columns) - 1) * spacing + extent - minY };
  });
  const width = regions.reduce((sum, region) => sum + region.width, 0) + REGION_GAP * (regions.length - 1);
  const height = Math.max(...regions.map((region) => region.height));
  let left = ordinary === null ? 0 : below ? (ordinary.minX + ordinary.maxX - width) / 2 : ordinary.maxX + REGION_GAP;
  const top = ordinary === null ? 0 : below ? ordinary.maxY + REGION_GAP : (ordinary.minY + ordinary.maxY - height) / 2;
  for (const region of regions) {
    const origin = { x: left + extent, y: top - region.minY };
    if (region.hub !== null) positions.set(region.hub, {
      x: origin.x + (region.columns - 1) * spacing / 2, y: origin.y - spacing * 0.65,
    });
    region.pairs.forEach((family, index) => {
      const centre = { x: origin.x + (index % region.columns) * spacing, y: origin.y + Math.floor(index / region.columns) * spacing };
      positions.set(family.pair, centre);
      family.runs.forEach((id, run) => {
        const angle = run * Math.PI * 2 / family.runs.length + hash(family.pair) / 0x1_0000_0000 * Math.PI * 2;
        const radius = familyRadius(family.runs.length);
        positions.set(id, { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
      });
    });
    left += region.width + REGION_GAP;
  }
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
  const families = replayFamilies(graph);
  const replayIds = new Set(families.flatMap((family) => [...(family.hub === null ? [] : [family.hub]), family.pair, ...family.runs]));
  stepReplayFamilies(families, bodies);
  const ids = graph.nodes.map((node) => node.id).filter((id) => !replayIds.has(id));
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
    if (replayIds.has(edge.from) || replayIds.has(edge.to)) continue;
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

/** Local physics inside each pair's neighbourhood, independent of ordinary runs. */
function stepReplayFamilies(families: readonly ReplayFamily[], bodies: Map<string, Body>): void {
  const pairs = families.map((family) => bodies.get(family.pair)).filter((body): body is Body => body !== undefined);
  for (const family of families) {
    const pair = bodies.get(family.pair);
    if (pair === undefined) continue;
    const radius = familyRadius(family.runs.length);
    // Staying inside half the nearest pair distance makes the own-pair
    // relation true geometrically, rather than hoping a spring settles there.
    const nearest = Math.min(...pairs.filter((other) => other !== pair).map((other) => Math.hypot(other.x - pair.x, other.y - pair.y)));
    const limit = Math.min(radius * REPLAY_ORBIT_LIMIT, nearest * 0.49);
    for (const id of family.runs) {
      const body = bodies.get(id);
      if (body === undefined || body.pinned) continue;
      let dx = body.x - pair.x;
      let dy = body.y - pair.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        const angle = hash(id) / 0x1_0000_0000 * Math.PI * 2;
        dx = Math.cos(angle) * 0.01;
        dy = Math.sin(angle) * 0.01;
        distance = 0.01;
      }
      body.vx -= dx / distance * (distance - radius) * SPRING;
      body.vy -= dy / distance * (distance - radius) * SPRING;
      for (const otherId of family.runs) {
        if (id === otherId) continue;
        const other = bodies.get(otherId);
        if (other === undefined) continue;
        const ox = body.x - other.x;
        const oy = body.y - other.y;
        const gap = Math.max(1, Math.hypot(ox, oy));
        body.vx += ox / gap * REPULSION / (gap * gap);
        body.vy += oy / gap * REPULSION / (gap * gap);
      }
      body.vx *= DAMPING;
      body.vy *= DAMPING;
      body.x += body.vx * STEP;
      body.y += body.vy * STEP;
      dx = body.x - pair.x;
      dy = body.y - pair.y;
      distance = Math.hypot(dx, dy);
      if (distance > limit) {
        body.x = pair.x + dx / distance * limit;
        body.y = pair.y + dy / distance * limit;
        body.vx = 0;
        body.vy = 0;
      }
    }
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
  const families = replayFamilies(graph);
  if (families.length === 0) return settle(graph, initialPositions(graph), options);
  const replayIds = new Set(families.flatMap((family) => [...(family.hub === null ? [] : [family.hub]), family.pair, ...family.runs]));
  const ordinaryGraph = { ...graph, nodes: graph.nodes.filter((node) => !replayIds.has(node.id)),
    edges: graph.edges.filter((edge) => !replayIds.has(edge.from) && !replayIds.has(edge.to)) };
  // Settle the ordinary drawing once and keep that result byte for byte. Its
  // measured extent decides where the replay formation starts, including pins.
  const ordinary = settle(ordinaryGraph, initialPositions(ordinaryGraph), options);
  const replayGraph = { ...graph, nodes: graph.nodes.filter((node) => replayIds.has(node.id)),
    edges: graph.edges.filter((edge) => replayIds.has(edge.from) && replayIds.has(edge.to)) };
  const seeds = new Map<string, Point>();
  seedReplayPositions(seeds, families, ordinary.positions.size === 0 ? null : ordinary.bounds);
  const replays = settle(replayGraph, seeds, options);
  const positions = new Map(graph.nodes.map((node) => [node.id, (ordinary.positions.get(node.id) ?? replays.positions.get(node.id))!]));
  return { positions, bounds: boundsOf(positions) };
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
