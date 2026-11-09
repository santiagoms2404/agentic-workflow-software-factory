import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { coalescedPersistableEvents } from "../../../src/cli/commands/review-phase.ts";

const common = { runId: "run", hostAt: "2026-01-01T00:00:00.000Z", providerAt: null } as const;

test("persisted streamed events keep non-text order and one complete text delta", () => {
  const events: NormalizedEvent[] = [
    { ...common, seq: 1, kind: "run.started", adapter: "fixture", requestedModel: "model" },
    { ...common, seq: 2, kind: "text.delta", text: "first " },
    { ...common, seq: 3, kind: "thinking.delta", text: "not retained" },
    { ...common, seq: 4, kind: "text.delta", text: "last" },
    { ...common, seq: 5, kind: "run.completed", exitCode: 0 },
  ];

  const retained = coalescedPersistableEvents(events, "complete response");
  assert.deepEqual(retained.map((event) => event.kind), ["run.started", "text.delta", "run.completed"]);
  const delta = retained.find((event) => event.kind === "text.delta");
  assert.equal(delta?.kind === "text.delta" ? delta.text : null, "complete response");
  assert.equal(delta?.seq, 4, "the consolidated record keeps the final text chunk's host observation");
  assert.equal(events[1]?.kind === "text.delta" ? events[1].text : null, "first ", "stream data is not mutated");
});
