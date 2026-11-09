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
import { summarize } from "./snippet.ts";

export interface ToolResultImage {
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ImageBlock {
  readonly mediaType: string;
  readonly data: string;
  readonly decodedBytes: number;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The payload of an image block, wherever the shape keeps it.
 *
 * One provider nests it under `source`, the other keeps it at the top level. The shape decides
 * only where the payload is read from. It never decides whether the payload is
 * hidden: a block that is an image and carries a payload is always an image to
 * redact, even when its source names no media type (B11-25). A block with no
 * payload at all has nothing to redact and is not an image here.
 */
function imageBlock(block: unknown): ImageBlock | null {
  if (block === null || typeof block !== "object") return null;
  const candidate = block as { type?: unknown; source?: unknown; mimeType?: unknown; data?: unknown };
  if (candidate.type !== "image") return null;
  const source =
    candidate.source !== null && typeof candidate.source === "object"
      ? (candidate.source as { media_type?: unknown; data?: unknown })
      : undefined;
  const sourceData = source?.data;
  const data =
    typeof sourceData === "string" ? sourceData : typeof candidate.data === "string" ? candidate.data : null;
  if (data === null) return null;
  const sourceMediaType = source?.media_type;
  const declared =
    typeof sourceMediaType === "string"
      ? sourceMediaType
      : typeof candidate.mimeType === "string"
        ? candidate.mimeType
        : null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return {
    mediaType: declared ?? "unknown",
    data,
    decodedBytes: Math.max(0, Math.floor((data.length * 3) / 4) - padding),
  };
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
      bytes: image.decodedBytes,
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
    return { type: "image", mediaType: image.mediaType, bytes: image.decodedBytes };
  };
  if (Array.isArray(content)) return content.map(redact);
  if (content !== null && typeof content === "object" && Array.isArray((content as { content?: unknown }).content)) {
    return { ...(content as Record<string, unknown>), content: ((content as { content: unknown[] }).content).map(redact) };
  }
  return redact(content);
}

/**
 * Summarize text blocks without spending the snippet on their content envelope.
 * Image-only and unstructured results keep the redacted JSON fallback.
 */
export function summarizeToolResult(result: unknown): string {
  const blocks = blocksOf(result);
  const texts = blocks
    .filter((block): block is { text: string } => {
      return block !== null && typeof block === "object" && typeof (block as { text?: unknown }).text === "string";
    })
    .map((block) => block.text);
  return texts.length === 0
    ? summarize(redactToolImages(result))
    : summarize(texts.join("\n"));
}
