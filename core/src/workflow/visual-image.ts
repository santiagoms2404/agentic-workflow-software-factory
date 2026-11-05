// What an image file IS, decided from its bytes rather than its name.
//
// A reference that does not decode is not a reference, and neither CLI tells
// the host when it could not show the model an image — it simply returns
// whatever it managed to read. So the host decodes the structure itself before
// delivery: PNG chunk CRCs and the inflated scanline length, JPEG markers from
// SOI through a frame header to EOI. This is a structural check, not a render.

import { crc32, inflateSync } from "node:zlib";
import { VISUAL_REFERENCE_LIMITS } from "../contracts/visual-references.ts";

export interface ImageFacts {
  readonly mediaType: "image/png" | "image/jpeg";
  readonly extension: "png" | "jpg";
  readonly width: number;
  readonly height: number;
}

export class ImageDecodeFailure extends Error {
  readonly unsupported: boolean;
  constructor(detail: string, unsupported = false) {
    super(detail);
    this.name = "ImageDecodeFailure";
    this.unsupported = unsupported;
  }
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7's x/y origins and strides. Empty passes have neither pixels nor filter bytes.
const PNG_PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

function pngDecodedSize(width: number, height: number, bits: number, interlaced: boolean): number {
  if (!interlaced) return height * (1 + Math.ceil(width * bits / 8));
  let size = 0;
  for (const [x, y, dx, dy] of PNG_PASSES) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns > 0 && rows > 0) size += rows * (1 + Math.ceil(columns * bits / 8));
  }
  return size;
}

// Largest permitted reference at PNG's maximum 16-bit RGBA depth, including
// Adam7 row overhead. A forged IHDR must not turn the per-image bound into GiB.
const MAX_PNG_DECODED_BYTES = pngDecodedSize(VISUAL_REFERENCE_LIMITS.maxImageEdge,
  VISUAL_REFERENCE_LIMITS.maxImageEdge, 64, true);

function pngFacts(bytes: Buffer): ImageFacts {
  let offset = PNG_SIGNATURE.length;
  let header: { width: number; height: number; bits: number; interlaced: boolean } | null = null;
  const data: Buffer[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new ImageDecodeFailure(`PNG chunk ${type} runs past the end of the file`);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) {
      throw new ImageDecodeFailure(`PNG chunk ${type} fails its CRC`);
    }
    if (header === null && type !== "IHDR") throw new ImageDecodeFailure("PNG does not begin with IHDR");
    if (type === "IHDR") {
      const channels = PNG_CHANNELS[body[9]!];
      if (length !== 13 || channels === undefined || !PNG_DEPTHS[body[9]!]!.includes(body[8]!) ||
        body[10] !== 0 || body[11] !== 0 || (body[12] !== 0 && body[12] !== 1)) {
        throw new ImageDecodeFailure("PNG header is malformed");
      }
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), bits: channels * body[8]!, interlaced: body[12] === 1 };
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (header === null || !ended || offset !== bytes.length) throw new ImageDecodeFailure("PNG is truncated or carries bytes after IEND");
  if (header.width === 0 || header.height === 0 || data.length === 0) throw new ImageDecodeFailure("PNG has no image data");
  if (header.width > 0x7fffffff || header.height > 0x7fffffff) throw new ImageDecodeFailure("PNG dimensions exceed the format limit");
  const expected = pngDecodedSize(header.width, header.height, header.bits, header.interlaced);
  // Keep edge-policy refusal in the caller (including its image-too-large code),
  // but bound allocation here before zlib sees even a small compressed stream.
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > MAX_PNG_DECODED_BYTES) {
    throw new ImageDecodeFailure("PNG decoded size exceeds the visual reference limit");
  }
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch (error) {
    throw new ImageDecodeFailure(`PNG image data does not inflate: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pixels.length !== expected) throw new ImageDecodeFailure(`PNG image data holds ${String(pixels.length)} bytes; its header needs ${String(expected)}`);
  return { mediaType: "image/png", extension: "png", width: header.width, height: header.height };
}

const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegFacts(bytes: Buffer): ImageFacts {
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new ImageDecodeFailure("JPEG does not end with EOI");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new ImageDecodeFailure("JPEG marker stream is malformed");
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) { offset += 1; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw new ImageDecodeFailure("JPEG segment runs past the end of the file");
    if (JPEG_FRAMES.has(marker)) {
      // Precision, height, width and a component count: a shorter segment would read
      // its dimensions from outside itself, or past the end of the file (B6-32, B6-33).
      if (length < 8) throw new ImageDecodeFailure("JPEG frame header is shorter than its dimensions");
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (width === 0 || height === 0) throw new ImageDecodeFailure("JPEG frame header has no dimensions");
      return { mediaType: "image/jpeg", extension: "jpg", width, height };
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  throw new ImageDecodeFailure("JPEG has no frame header before its scan");
}

/** Decides type from magic bytes; anything but PNG or JPEG is unsupported, never guessed. */
export function inspectImage(bytes: Buffer): ImageFacts {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return pngFacts(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegFacts(bytes);
  throw new ImageDecodeFailure("only PNG and JPEG references are supported", true);
}
