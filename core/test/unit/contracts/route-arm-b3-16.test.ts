// B3-16 — the replay arm and the --route flag split one spec differently.
//
// The effort is the part after the LAST '@' for a replay arm and after the
// FIRST '@' for a --route flag. A model id with two '@' characters (a Vertex
// versioned id) was therefore accepted as an arm and refused as a flag. The
// flag grammar already refuses '@' inside a model as "not a representable
// selector", so the arm now applies the same refusal, and both spellings fail
// with the same reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRouteArm, RouteArmSpecInvalid } from "../../../src/contracts/route-arm.ts";
import { parseRouteFlag } from "../../../src/workflow/route-flags.ts";

const TWO_AT = "claude/vertex/claude-3-5-sonnet@20241022@high";

test("a model id containing '@' is refused as a replay arm (B3-16)", () => {
  assert.throws(() => parseRouteArm(TWO_AT), (error: unknown) =>
    error instanceof RouteArmSpecInvalid && /representable selector/u.test(error.message));
});

test("the same spec is refused as a --route flag with the same reason (B3-16)", () => {
  assert.throws(() => parseRouteFlag(`builder=${TWO_AT}`), /not a representable selector/u);
});

test("a plain arm and the matching --route flag name the same adapter, provider, model and effort", () => {
  const arm = parseRouteArm("claude/vertex/claude-3-5-sonnet@high");
  assert.deepEqual(
    { adapter: arm.adapter, provider: arm.provider, model: arm.model, effort: arm.effort },
    { adapter: "claude", provider: "vertex", model: "claude-3-5-sonnet", effort: "high" },
  );
  const flag = parseRouteFlag("builder=claude/vertex/claude-3-5-sonnet@high");
  assert.deepEqual(flag.selection, { adapter: "claude", provider: "vertex", model: "claude-3-5-sonnet", effort: "high" });
});
