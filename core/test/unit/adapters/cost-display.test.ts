// What a run is allowed to say it cost. A measured non-zero cost must never read
// as free, and an estimate must keep its estimate mark (B11-13).

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCost } from "../../../src/adapters/cost-display.ts";

test("B11-13: a measured cost below half a cent is shown below a cent, never as $0.00", () => {
  assert.equal(formatCost("provider", 0.004), "<$0.01");
  assert.notEqual(formatCost("provider", 0.004), "$0.00");
});

test("B11-13: a catalog estimate below half a cent keeps its estimate mark", () => {
  assert.equal(formatCost("catalog-estimate", 0.0049), "≈ <$0.01");
});

test("B11-13: triangulation: a genuine zero stays $0.00, and ordinary amounts round as before", () => {
  assert.equal(formatCost("provider", 0), "$0.00");
  assert.equal(formatCost("provider", 0.6479), "$0.65");
  assert.equal(formatCost("catalog-estimate", 0.6479), "≈ $0.65");
});
