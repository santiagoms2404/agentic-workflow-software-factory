// Images inside a provider's tool result, reduced to what the host may keep.
//
// Both first-class CLIs return an image-reading tool's output as an image
// content block in the stream: Claude Code as `{ type: "image", source:
// { type: "base64", media_type, data } }` inside a `tool_result`, pi as
// `{ type: "image", mimeType, data }` inside `tool_execution_end.result`
// (captured against Claude Code 2.1.280 and pi 0.87.1). That block is the
// only host-visible fact that pixels reached the model's context rather than
// a filename or a description of one, so it is measured here — and it is
// never kept. A digest and a byte count leave; the payload does not reach an
// event, a snippet, the journal or a projection.

import { createHash } from "node:crypto";

export interface ToolResultImage {
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ImageBlock {
  readonly mediaType: string;
  readonly data: string;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function imageBlock(block: unknown): ImageBlock | null {
  if (block === null || typeof block !== "object") return null;
  const candidate = block as { type?: unknown; source?: unknown; mimeType?: unknown; data?: unknown };
  if (candidate.type !== "image") return null;
  if (candidate.source !== null && typeof candidate.source === "object") {
    const source = candidate.source as { type?: unknown; media_type?: unknown; data?: unknown };
    if (source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string") {
      return { mediaType: source.media_type, data: source.data };
    }
    return null;
  }
  if (typeof candidate.mimeType === "string" && typeof candidate.data === "string") {
    return { mediaType: candidate.mimeType, data: candidate.data };
  }
  return null;
}

function blocksOf(content: unknown): readonly unknown[] {
  if (Array.isArray(content)) return content;
  if (content !== null && typeof content === "object") {
    const nested = (content as { content?: unknown }).content;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/**
 * Every well-formed base64 image block in a tool result, as digests. A block
 * whose payload is not strict base64 is not counted: a lenient decode would
 * hash bytes the provider never held.
 */
export function toolResultImages(content: unknown): readonly ToolResultImage[] {
  const images: ToolResultImage[] = [];
  for (const block of blocksOf(content)) {
    const image = imageBlock(block);
    if (image === null || image.data.length === 0 || image.data.length % 4 !== 0 || !BASE64.test(image.data)) continue;
    const bytes = Buffer.from(image.data, "base64");
    images.push(Object.freeze({
      mediaType: image.mediaType,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }));
  }
  return Object.freeze(images);
}

/** The same value with each image payload replaced by its type and decoded size. */
export function redactToolImages(content: unknown): unknown {
  const redact = (block: unknown): unknown => {
    const image = imageBlock(block);
    if (image === null) return block;
    return { type: "image", mediaType: image.mediaType, bytes: Math.floor((image.data.length * 3) / 4) };
  };
  if (Array.isArray(content)) return content.map(redact);
  if (content !== null && typeof content === "object" && Array.isArray((content as { content?: unknown }).content)) {
    return { ...(content as Record<string, unknown>), content: ((content as { content: unknown[] }).content).map(redact) };
  }
  return redact(content);
}
