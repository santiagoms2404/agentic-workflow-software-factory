// W18 task 8: the metrics tab's SVG geometry. Scales, 1-2-5 log ticks, the
// tile ring and label placement, all pure (dashboard/src/metrics-chart.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERCENT_TICKS,
  formatPercentTick,
  formatTick,
  intersects,
  linearScale,
  logDomain,
  logScale,
  logTicks,
  placeLabels,
  ring,
  thinTicks,
  type Rect,
} from "../../../dashboard/src/metrics-chart.ts";

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≠ ${expected}`);

test("a linear scale maps its domain onto its range, inverted ranges included, and a zero span to the middle", () => {
  const y = linearScale([0, 1], [500, 20]);
  close(y(0), 500);
  close(y(1), 20);
  close(y(0.25), 380);
  close(linearScale([3, 3], [0, 10])(3), 5);
});

test("a log scale spaces decades evenly and pins values it cannot place to the low end", () => {
  const x = logScale([0.1, 10], [0, 200]);
  close(x(0.1), 0);
  close(x(1), 100);
  close(x(10), 200);
  close(x(0), 0, "zero has no logarithm");
  close(x(-4), 0);
  close(x(1000), 200, "clamped to the domain");
});

test("a log domain pads its values and snaps outward to 1-2-5 values, so both ends carry a tick", () => {
  assert.deepEqual(logDomain([0.51, 2.09, 4.11]), [0.2, 10]);
  assert.deepEqual(logDomain([1]), [0.5, 2]);
  assert.deepEqual(logDomain([12, 40]), [5, 100]);
  assert.deepEqual(logDomain([]), [0.1, 1], "nothing to place is one decade");
  assert.deepEqual(logDomain([0, -1, Number.NaN]), [0.1, 1], "non-positive values are ignored");
});

test("log ticks are every 1-2-5 value inside the domain, printed without float noise", () => {
  assert.deepEqual(logTicks([0.2, 10]), [0.2, 0.5, 1, 2, 5, 10]);
  assert.deepEqual(logTicks([0.1, 1]), [0.1, 0.2, 0.5, 1]);
  assert.deepEqual(logTicks([3, 4]), []);
  assert.deepEqual(logTicks([0, 1]), [], "a log axis cannot start at zero");
  assert.deepEqual(logTicks([0.2, 10]).map(formatTick), ["0.2", "0.5", "1", "2", "5", "10"]);
  assert.equal(formatTick(0.05), "0.05");
  assert.equal(formatTick(2000), "2k");
  assert.deepEqual(PERCENT_TICKS.map(formatPercentTick), ["0%", "25%", "50%", "75%", "100%"]);
});

test("thinning drops ticks that would overprint, and keeps both ends", () => {
  const ticks = logTicks([0.1, 100]);
  const wide = logScale([0.1, 100], [0, 900]);
  assert.deepEqual(thinTicks(ticks, wide, 40), ticks, "room for every tick");
  const narrow = logScale([0.1, 100], [0, 150]);
  const kept = thinTicks(ticks, narrow, 40);
  assert.equal(kept[0], 0.1);
  assert.equal(kept[kept.length - 1], 100);
  for (let i = 1; i < kept.length; i += 1) assert.ok(narrow(kept[i]!) - narrow(kept[i - 1]!) >= 40, `${kept}`);
  assert.deepEqual(thinTicks([1, 2], narrow, 400), [1, 2], "two ticks are never thinned");
});

test("the ring's arc is the yield's share of its circumference, and nothing settled reads a dash", () => {
  const full = 2 * Math.PI * 15;
  const seventySix = ring(0.76, 15);
  close(seventySix.circumference, full);
  close(seventySix.arc, full * 0.76);
  assert.equal(seventySix.text, "76");
  assert.equal(seventySix.dasharray, `${(full * 0.76).toFixed(2)} ${full.toFixed(2)}`);
  const none = ring(null, 15);
  assert.deepEqual([none.arc, none.text], [0, "–"]);
  assert.deepEqual([ring(0, 15).arc, ring(0, 15).text], [0, "0"], "zero draws the round cap only");
  assert.equal(ring(1.4, 15).text, "100", "clamped");
});

const bounds: Rect = { x: 0, y: 0, width: 400, height: 200 };
const font = { charWidth: 8, lineHeight: 18, gap: 14 };

test("a label sits to the right of its mark when there is room, and flips left at the right edge", () => {
  const [right, flipped] = placeLabels([
    { id: "a", x: 50, y: 100, text: "Opus 5 · high · n6", priority: 1 },
    { id: "b", x: 390, y: 40, text: "GPT-6 Sol · n1", priority: 1 },
  ], bounds, font);
  assert.equal(right?.anchor, "start");
  assert.equal(right?.x, 64);
  assert.equal(flipped?.anchor, "end");
  assert.ok(flipped!.box.x + flipped!.box.width <= 390 - 14 + 1e-9);
});

test("labels never overlap one another or an avoided mark; the higher priority keeps the contested spot", () => {
  const requests = [
    { id: "low", x: 100, y: 100, text: "Opus 5 · medium · n1", priority: 1 },
    { id: "high", x: 100, y: 104, text: "GPT-5.6 Sol · high · n6", priority: 50 },
    { id: "third", x: 104, y: 98, text: "GPT-5.6 Sol · xhigh · n21", priority: 20 },
  ];
  const avoid: Rect[] = [{ x: 150, y: 80, width: 20, height: 20 }];
  const placed = placeLabels(requests, bounds, { ...font, avoid });
  const byId = new Map(requests.map((request, index) => [request.id, placed[index]]));
  assert.equal(byId.get("high")?.anchor, "start", "the priority label takes the first choice");
  const boxes = placed.filter((label) => label !== null).map((label) => label!.box);
  for (let i = 0; i < boxes.length; i += 1) {
    assert.ok(!intersects(boxes[i]!, avoid[0]!), "no label covers an avoided mark");
    for (let j = i + 1; j < boxes.length; j += 1) assert.ok(!intersects(boxes[i]!, boxes[j]!), `labels ${i} and ${j} overlap`);
    const box = boxes[i]!;
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 400 && box.y + box.height <= 200, "inside the bounds");
  }
  assert.deepEqual(placed.map((label) => label?.id ?? null).filter((id) => id !== null).length, boxes.length);
});

test("multiline badge labels reserve their full height, including at the upper axis edge", () => {
  const requests = [
    { id: "ranked", x: 100, y: 0, text: "ranked route", priority: 10 },
    { id: "badged", x: 100, y: 0, text: "identity unconfirmed", lines: 2, priority: 1 },
  ];
  const placed = placeLabels(requests, bounds, font);
  assert.ok(placed.every((label) => label !== null));
  assert.equal(placed[0]!.box.height, 18);
  assert.equal(placed[1]!.box.height, 36);
  assert.equal(intersects(placed[0]!.box, placed[1]!.box), false);
  assert.ok(placed[1]!.box.y >= bounds.y);
});

test("a label with no free spot is left out rather than drawn over another", () => {
  const tiny: Rect = { x: 0, y: 0, width: 120, height: 26 };
  const placed = placeLabels([
    { id: "a", x: 10, y: 10, text: "abcdefgh", priority: 2 },
    { id: "b", x: 10, y: 10, text: "abcdefgh", priority: 1 },
  ], tiny, { charWidth: 8, lineHeight: 18, gap: 4 });
  assert.notEqual(placed[0], null);
  assert.equal(placed[1], null);
});
