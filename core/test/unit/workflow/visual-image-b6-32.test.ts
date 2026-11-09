import assert from "node:assert/strict";
import { test } from "node:test";

import { ImageDecodeFailure, inspectImage } from "../../../src/workflow/visual-image.ts";

// B6-32 and B6-33: the JPEG frame header was read at fixed offsets without
// checking the segment's own length. A short SOF segment threw a RangeError (not
// an ImageDecodeFailure, so the refusal code was lost), or took its dimensions
// from bytes after the segment.

const TRUNCATED_FRAME = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xd9]);
const SHORT_FRAME_WITH_TRAILING_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
const WELL_FORMED_FRAME = Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03,
  0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

test("B6-32: a frame segment too short for its dimensions is refused as a decode failure, not a RangeError", () => {
  assert.throws(() => inspectImage(TRUNCATED_FRAME), (error: unknown) => {
    assert.ok(error instanceof ImageDecodeFailure, `expected ImageDecodeFailure, got ${String(error)}`);
    return true;
  });
});

test("B6-33: dimensions are never taken from bytes outside the frame segment", () => {
  assert.throws(() => inspectImage(SHORT_FRAME_WITH_TRAILING_BYTES), (error: unknown) => {
    assert.ok(error instanceof ImageDecodeFailure, `expected ImageDecodeFailure, got ${String(error)}`);
    return true;
  });
});

test("B6-32/33: a well-formed frame header still yields its dimensions", () => {
  assert.deepEqual(inspectImage(WELL_FORMED_FRAME), { mediaType: "image/jpeg", extension: "jpg", width: 32, height: 16 });
});
