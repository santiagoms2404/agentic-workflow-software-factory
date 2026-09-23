#!/usr/bin/env node
// Zero-quota process for the visual-reference journey. It plays pi's `read`
// tool honestly: it opens each delivered file the host named in its prompt,
// from disk, and returns those bytes in the `tool_execution_end` shape captured
// in derived-image-read-tool.jsonl. Everything else speaks only line shapes
// already captured in probe-readonly-tool.jsonl.
//
// `--awsf-fixture-open <n>` limits how many delivered frames it opens.

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index < 0 ? null : argv[index + 1] ?? null;
};
const limit = Number(valueAfter("--awsf-fixture-open") ?? Number.POSITIVE_INFINITY);

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const frames = [...prompt.matchAll(/^- ([A-Za-z0-9._-]+): (.+) \(sha256 [a-f0-9]{64}\)$/gmu)].map((match) => match[2]);

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
emit({ type: "session", version: 3, id: "visual-reference-fixture-session", timestamp: "2026-09-23T00:00:00.000Z", cwd: process.cwd() });
emit({ type: "agent_start" });
for (const [index, file] of frames.slice(0, limit).entries()) {
  const toolCallId = `call_fixture_${String(index + 1)}`;
  emit({ type: "tool_execution_start", toolCallId, toolName: "read", args: { path: file, offset: null, limit: null } });
  const data = fs.readFileSync(file).toString("base64");
  emit({ type: "tool_execution_end", toolCallId, toolName: "read",
    result: { content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data, mimeType: "image/png" }] }, isError: false });
}

fs.mkdirSync(path.join(process.cwd(), "core", "src"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "core", "src", "generated.ts"), "export const generated = true;\n");
const envelope = {
  schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote one source after reading the delivered references",
  artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "bounded source" }], notesForNextPhase: "run exact host gates",
  changedFiles: ["core/src/generated.ts"], implementationNotes: ["process-backed visual fixture"], commandsRun: [],
  proposedCommitMessage: "feat: add generated source",
};
const message = {
  role: "assistant", content: [{ type: "text", text: JSON.stringify(envelope) }], provider: "openai-codex", model: valueAfter("--model") ?? "gpt-6-sol",
  usage: { input: 7, output: 11, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 18, cost: { total: 0.0001 } },
  stopReason: "stop", timestamp: 1786218992997,
};
emit({ type: "message_start", message: { ...message, content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } } } });
emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: JSON.stringify(envelope) }, message });
emit({ type: "turn_end", message, toolResults: [] });
emit({ type: "agent_end", messages: [message], willRetry: false });
emit({ type: "agent_settled" });
