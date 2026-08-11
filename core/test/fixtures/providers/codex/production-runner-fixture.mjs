#!/usr/bin/env node
// Zero-quota captured-stream process for the production-runner journey.
// It speaks only line shapes already captured in probe-readonly-tool.jsonl.

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index < 0 ? null : argv[index + 1] ?? null;
};
const systemPromptPath = valueAfter("--append-system-prompt");
const mode = valueAfter("--awsf-fixture-mode") ?? "success";
const liveMs = Math.max(0, Math.min(10_000, Number(valueAfter("--awsf-fixture-live-ms") ?? 0) || 0));
const eventGapMs = Math.max(0, Math.min(2_000, Number(valueAfter("--awsf-fixture-event-gap-ms") ?? 0) || 0));

if (systemPromptPath === null || !path.isAbsolute(systemPromptPath)) {
  process.stderr.write("production-runner-fixture: missing absolute system prompt path\n");
  process.exit(64);
}

const systemPrompt = fs.readFileSync(systemPromptPath, "utf8");
const attemptDir = path.dirname(path.dirname(path.dirname(systemPromptPath)));
const journalPath = path.join(attemptDir, "journal.jsonl");
const journalAtProviderStart = fs.readFileSync(journalPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const processStatuses = journalAtProviderStart
  .map((record) => record.event?.evidence)
  .filter((evidence) => evidence?.type === "process")
  .map((evidence) => evidence.status);

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;

const probe = {
  argv,
  mode,
  promptLength: prompt.length,
  promptContentInArgv: argv.some((value) => value.includes(prompt)),
  systemPromptContentInArgv: argv.some((value) => value.includes(systemPrompt)),
  registeredBeforeProviderStart: processStatuses.includes("REGISTERED"),
  spentBeforeProviderStart: processStatuses.includes("RUNNING"),
  journalSourceSeqsAtProviderStart: journalAtProviderStart.map((record) => record.source_seq),
};
fs.writeFileSync(path.join(path.dirname(systemPromptPath), "provider-probe.json"), JSON.stringify(probe), { mode: 0o600 });

if (liveMs > 0) await new Promise((resolve) => setTimeout(resolve, liveMs));

if (mode === "parser-failure") {
  process.stdout.write("not-json-from-captured-stream-fixture\n");
  process.exit(0);
}

const ownerRework = prompt.includes("Owner-authorized fresh rework call (L19)");
fs.mkdirSync(path.join(process.cwd(), "core", "src"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "core", "src", "generated.ts"),
  ownerRework ? "export const generated = true;\n" : "export  const generated = true;\n",
);

const envelope = {
  schema: "awsf.build-output/v1",
  producerStatus: "success",
  summary: ownerRework ? "repaired the owner-named whitespace defect" : "wrote one source through the process-backed fixture",
  artifacts: [{ path: "core/src/generated.ts", kind: "source", description: "bounded source" }],
  notesForNextPhase: "run exact host gates",
  changedFiles: ["core/src/generated.ts"],
  implementationNotes: [ownerRework ? "removed the named duplicate whitespace" : "captured-stream process fixture"],
  commandsRun: [],
  proposedCommitMessage: "feat: add generated source",
};
const message = {
  role: "assistant",
  content: [{ type: "text", text: JSON.stringify(envelope) }],
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  usage: {
    input: 7,
    output: 11,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 18,
    cost: { total: 0.0001 },
  },
  stopReason: "stop",
  timestamp: 1786218992997,
};
const emit = async (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  if (eventGapMs > 0) await new Promise((resolve) => setTimeout(resolve, eventGapMs));
};
await emit({ type: "session", version: 3, id: "production-runner-fixture-session", timestamp: "2026-08-11T00:00:00.000Z", cwd: process.cwd() });
await emit({ type: "agent_start" });
await emit({ type: "message_start", message: { ...message, content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } } } });
await emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: JSON.stringify(envelope) }, message });
await emit({ type: "turn_end", message, toolResults: [] });
await emit({ type: "agent_end", messages: [message], willRetry: false });
await emit({ type: "agent_settled" });
