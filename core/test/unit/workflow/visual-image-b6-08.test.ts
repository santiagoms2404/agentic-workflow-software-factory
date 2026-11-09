import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { VISUAL_REFERENCE_LIMITS } from "../../../src/contracts/visual-references.ts";
import { ImageDecodeFailure, inspectImage } from "../../../src/workflow/visual-image.ts";

function chunk(type: string, body: Buffer): Buffer {
  const bytes = Buffer.alloc(body.length + 12);
  bytes.writeUInt32BE(body.length);
  bytes.write(type, 4, "latin1");
  body.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}

function png(width: number, height: number, raw: Buffer, depth = 8, color = 0, interlace = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  header[12] = interlace;
  const compressed = deflateSync(raw);
  const middle = Math.floor(compressed.length / 2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    ...(color === 3 ? [chunk("PLTE", Buffer.from([0, 0, 0]))] : []),
    chunk("IDAT", compressed.subarray(0, middle)), chunk("IDAT", compressed.subarray(middle)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function facts(width: number, height: number) {
  return { mediaType: "image/png", extension: "png", width, height };
}

for (const interlace of [0, 1]) {
  test(`B6-08 bounds inflation before materializing excess scanlines (interlace ${String(interlace)})`, () => {
    // A modest 256 KiB expansion is enough to distinguish bounded zlib refusal
    // from the old post-allocation length check. Never allocate a multi-GiB bomb.
    const bytes = png(1, 1, Buffer.alloc(256 * 1024), 8, 0, interlace);
    assert.ok(bytes.length < 1024);
    assert.ok(bytes.length < VISUAL_REFERENCE_LIMITS.maxImageBytes);
    assert.throws(() => inspectImage(bytes), (error: unknown) => {
      assert.ok(error instanceof ImageDecodeFailure);
      assert.match(error.message, /does not inflate:.*larger than 2 bytes/, "zlib must stop at the declared two-byte output, not check length after inflating it all");
      return true;
    });
  });
}

for (const [label, width, height, message] of [
  ["zero width", 0, 1, /no image data/],
  ["zero height", 1, 0, /no image data/],
  ["unsigned width beyond PNG range", 0xffffffff, 1, /dimensions/],
  ["unsigned height beyond PNG range", 1, 0xffffffff, /dimensions/],
  ["unsafe decoded-size multiplication", 0x7fffffff, 0x7fffffff, /decoded size/],
  ["decoded size beyond reference ceiling", VISUAL_REFERENCE_LIMITS.maxImageEdge + 1, VISUAL_REFERENCE_LIMITS.maxImageEdge + 1, /decoded size/],
] as const) {
  test(`B6-08 rejects ${label} before inflation`, () => {
    // Deliberately tiny data: rejection must be header preflight, not the
    // post-inflate short-data check or a native allocation/range exception.
    assert.throws(() => inspectImage(png(width, height, Buffer.alloc(2), 16, 6)), (error: unknown) => {
      assert.ok(error instanceof ImageDecodeFailure);
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /does not inflate|image data holds/);
      return true;
    });
  });
}

for (const [color, channels, depths] of [
  [0, 1, [1, 2, 4, 8, 16]], [2, 3, [8, 16]], [3, 1, [1, 2, 4, 8]], [4, 2, [8, 16]], [6, 4, [8, 16]],
] as const) {
  test(`B6-08 preserves valid PNG color type ${String(color)} at every legal depth`, () => {
    for (const depth of depths) {
      const raw = Buffer.alloc(3 * (1 + Math.ceil(9 * channels * depth / 8)));
      assert.deepEqual(inspectImage(png(9, 3, raw, depth, color)), facts(9, 3));
    }
  });
}

for (const [width, height, depth, color, length] of [
  [1, 1, 8, 0, 2], // Only the first pass is populated.
  [8, 8, 8, 0, 79], // 64 grayscale bytes plus 15 filter bytes across seven passes.
  [1, 8, 1, 0, 16], // Empty horizontal passes; packed rows each need a filter byte.
  [8, 1, 1, 0, 8], // Empty vertical passes; four packed rows.
  [9, 9, 16, 6, 667], // 81 RGBA16 pixels plus 19 filter bytes, with odd edges.
] as const) {
  test(`B6-08 preserves Adam7 ${String(width)}x${String(height)} at depth ${String(depth)}`, () => {
    assert.deepEqual(inspectImage(png(width, height, Buffer.alloc(length), depth, color, 1)), facts(width, height));
    assert.throws(() => inspectImage(png(width, height, Buffer.alloc(length - 1), depth, color, 1)), /image data holds.*header needs/);
    assert.throws(() => inspectImage(png(width, height, Buffer.alloc(length + 1), depth, color, 1)), /does not inflate:.*larger than/);
  });
}

test("B6-08 keeps edge-policy classification in the caller while bounding decoded bytes", () => {
  const edge = VISUAL_REFERENCE_LIMITS.maxImageEdge;
  assert.deepEqual(inspectImage(png(edge, 1, Buffer.alloc(1 + edge * 8), 16, 6)), facts(edge, 1));
  assert.deepEqual(inspectImage(png(edge + 1, 1, Buffer.alloc(1 + (edge + 1) * 8), 16, 6)), facts(edge + 1, 1));
});

test("B6-08 refuses invalid depths and interlace methods rather than deriving an invalid bound", () => {
  for (const [depth, color, interlace] of [[0, 0, 0], [255, 6, 0], [16, 3, 0], [1, 2, 0], [8, 0, 2]]) {
    assert.throws(() => inspectImage(png(1, 1, Buffer.alloc(2), depth, color, interlace)), /header is malformed/);
  }
});

test("B6-08 still refuses short scanlines, corrupt CRCs and truncated containers", () => {
  assert.throws(() => inspectImage(png(1, 1, Buffer.alloc(1))), /image data holds 1 bytes; its header needs 2/);
  const corrupt = png(1, 1, Buffer.alloc(2));
  corrupt[29] = corrupt[29]! ^ 1;
  assert.throws(() => inspectImage(corrupt), /fails its CRC/);
  assert.throws(() => inspectImage(png(1, 1, Buffer.alloc(2)).subarray(0, -1)), /truncated/);
});

test("B6-08 leaves JPEG inspection unchanged", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 7, 0, 5, 1, 1, 0x11, 0, 0xff, 0xd9]);
  assert.deepEqual(inspectImage(jpeg), { mediaType: "image/jpeg", extension: "jpg", width: 5, height: 7 });
});
