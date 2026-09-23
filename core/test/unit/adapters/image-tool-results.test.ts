// Image tool results, decoded from bytes captured off the real CLIs
// (`derived-image-read-tool.jsonl`, see each PROVENANCE.md). The payload is
// measured into a digest and never survives into an event.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClaudeStreamDecoder } from "../../../src/adapters/claude-code-stream.ts";
import { PiStreamDecoder } from "../../../src/adapters/pi-codex-stream.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { EventSequencer } from "../../../src/adapters/stream/event-sequencer.ts";
import { OutputBudget } from "../../../src/adapters/stream/output-budget.ts";
import { redactToolImages, toolResultImages } from "../../../src/adapters/stream/tool-images.ts";
import type { ObservedToolImage } from "../../../src/adapters/interface.ts";

const CAPTURED_SHA256 = "44ed3e13bd8a2be50f95fd9ea30d71363b085d5a562f6dd9edd179ac7d04f44d";
const AT = "2026-09-23T00:00:00.000Z";

function lines(path: string): string[] {
  return readFileSync(resolve(path), "utf8").split("\n").filter(Boolean);
}

function sequencer(): EventSequencer {
  return new EventSequencer({ runId: "run-1", now: () => AT, budget: new OutputBudget({}) });
}

test("Claude Code: a captured Read of a PNG yields one digest equal to the file's, and no base64 in any event", () => {
  const images: ObservedToolImage[] = [];
  const decoder = new ClaudeStreamDecoder({ adapter: "claude-code", provider: "anthropic", requestedModel: "haiku", images });
  const seq = sequencer();
  const events = lines("core/test/fixtures/providers/claude/derived-image-read-tool.jsonl").flatMap((line) => decoder.decode(line, seq));
  const completed = events.find((event) => event.kind === "tool.completed");
  assert.equal(completed?.kind, "tool.completed");
  assert.deepEqual(images, [{ toolCallId: completed.toolCallId, toolName: "Read", outcome: "ok", mediaType: "image/png", bytes: 744, sha256: CAPTURED_SHA256 }]);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /iVBORw0KGgo/, "the PNG's base64 never reaches an event");
  assert.match(completed.resultSnippet, /"type":"image","mediaType":"image\/png","bytes":744/);
});

test("pi: a captured read of a PNG yields one digest equal to the file's, and no base64 in any event", () => {
  const images: ObservedToolImage[] = [];
  const decoder = new PiStreamDecoder({ adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-5.6-luna", images, now: () => AT });
  const seq = sequencer();
  const events = lines("core/test/fixtures/providers/codex/derived-image-read-tool.jsonl").flatMap((line) => decoder.decode(line, seq));
  const completed = events.find((event) => event.kind === "tool.completed");
  assert.equal(completed?.kind, "tool.completed");
  assert.deepEqual(images, [{ toolCallId: completed.toolCallId, toolName: "read", outcome: "ok", mediaType: "image/png", bytes: 744, sha256: CAPTURED_SHA256 }]);
  assert.doesNotMatch(JSON.stringify(events), /iVBORw0KGgo/);
});

test("without a sink nothing is measured, and a text-only result is never mistaken for an image", () => {
  const decoder = new PiStreamDecoder({ adapter: "pi-codex", provider: "openai-codex", requestedModel: "gpt-5.6-luna", now: () => AT });
  const seq = sequencer();
  const events = lines("core/test/fixtures/providers/codex/derived-image-read-tool.jsonl").flatMap((line) => decoder.decode(line, seq));
  assert.doesNotMatch(JSON.stringify(events), /iVBORw0KGgo/, "redaction does not depend on anyone asking for digests");
  assert.deepEqual(toolResultImages([{ type: "text", text: "Read image file [image/png]" }]), []);
  assert.deepEqual(toolResultImages({ content: [{ type: "text", text: "iVBORw0KGgo=" }] }), [], "base64 described in prose is not an image");
  assert.deepEqual(toolResultImages([{ type: "image", mimeType: "image/png", data: "not base64!" }]), []);
  assert.deepEqual(redactToolImages([{ type: "image", mimeType: "image/png", data: "AAAA" }]), [{ type: "image", mediaType: "image/png", bytes: 3 }]);
});

test("model capability is honest: pi's text-only model reports no image input, Claude's routes do", async () => {
  const pi = new PiCodexAdapter();
  assert.equal((await pi.getModelInfo("codex:gpt-5.3-codex-spark")).supportsImages, false);
  assert.equal((await pi.getModelInfo("codex:gpt-5.6-sol")).supportsImages, true);
  assert.equal((await new ClaudeCodeAdapter().getModelInfo("claude:opus")).supportsImages, true);
});
