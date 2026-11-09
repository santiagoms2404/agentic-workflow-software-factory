import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidPhaseRouteSelection, requestedPhaseRoute } from "../../../src/workflow/phase-routing.ts";
import { parseRouteFlags } from "../../../src/workflow/route-flags.ts";
import { validConfig } from "../config/fixture.ts";

// B6-25: the undeclared-adapter check indexed config.adapters with a plain
// property read, so names inherited from Object.prototype passed as declared.
for (const adapter of ["nope", "toString", "constructor", "__proto__"]) {
  test(`B6-25: adapter ${adapter} is refused as undeclared, never read from the prototype`, () => {
    const config = validConfig();
    assert.throws(
      () => requestedPhaseRoute(config, "builder", config.agents[0]!, parseRouteFlags([`builder=${adapter}/anthropic/`])),
      (error: unknown) => error instanceof InvalidPhaseRouteSelection && /is disabled or undeclared/.test(error.message),
    );
  });
}

test("B6-25: a declared adapter is still accepted by the same check", () => {
  const config = validConfig();
  const declared = Object.keys(config.adapters).find((name) => config.adapters[name]?.enabled !== false);
  assert.ok(declared, "the fixture config declares at least one enabled adapter");
  const selected = requestedPhaseRoute(config, "builder", config.agents[0]!, parseRouteFlags([`builder=${declared}/anthropic/`]));
  assert.equal(selected.requested.adapterId, declared);
});
