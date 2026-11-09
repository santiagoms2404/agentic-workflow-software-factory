import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  selectedFrameIds,
  VisualReferenceIndexSchema,
  type VisualReferenceIndex,
} from "../../../src/contracts/visual-references.ts";

test("B3-06: VisualReferenceIndexSchema validates index carrying an optional plan field", () => {
  const index = {
    version: 1,
    plan: "plan-a",
    frames: [{ id: "f1", image: "design/f1.png" }],
    ticketFrames: { T05: ["f1"] },
  };
  assert.equal(Value.Check(VisualReferenceIndexSchema, index), true);
});

test("B3-06: selectedFrameIds refuses bare ticket lookup across disparate plan index", () => {
  const index: VisualReferenceIndex = {
    version: 1,
    plan: "plan-a",
    frames: [{ id: "f1", image: "design/f1.png" }],
    ticketFrames: { T05: ["f1"] },
  };

  assert.throws(
    () => selectedFrameIds({ plan: "plan-b", ticket: "T05" }, index, "plan-b"),
    (err: unknown) => {
      assert(err instanceof Error);
      assert.match(err.message, /the index maps no frames for plan-b#T05/);
      return true;
    },
  );
});

test("B3-06: selectedFrameIds resolves matching plan's bare ticket frames", () => {
  const index: VisualReferenceIndex = {
    version: 1,
    plan: "plan-a",
    frames: [{ id: "f1", image: "design/f1.png" }],
    ticketFrames: { T05: ["f1"] },
  };

  const frames = selectedFrameIds({ plan: "plan-a", ticket: "T05" }, index, "plan-a");
  assert.deepEqual(frames, ["f1"]);
});

test("B3-06: selectedFrameIds resolves plan-qualified ticket key in ticketFrames", () => {
  const index: VisualReferenceIndex = {
    version: 1,
    plan: "plan-a",
    frames: [
      { id: "f1", image: "design/f1.png" },
      { id: "f2", image: "design/f2.png" },
    ],
    ticketFrames: {
      T05: ["f1"],
      "plan-b#T05": ["f2"],
    },
  };

  const frames = selectedFrameIds({ plan: "plan-b", ticket: "T05" }, index, "plan-b");
  assert.deepEqual(frames, ["f2"]);
});
