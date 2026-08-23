import type { EventItem, ModelProvenance } from "../shared/types.ts";
import { formatUsageBreakdown, modelProvenanceLabel } from "./display.ts";

type Payload = Record<string, unknown>;
type UsageBreakdown = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
};

function payloadOf(item: EventItem): Payload {
  return item.payload !== null && typeof item.payload === "object" ? item.payload as Payload : {};
}

function stringValue(payload: Payload, key: string): string | null {
  return typeof payload[key] === "string" ? payload[key] : null;
}

function numberValue(payload: Payload, key: string): number | null {
  return typeof payload[key] === "number" ? payload[key] : null;
}

function join(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ") || "—";
}

export function summarizeToolCall(item: EventItem): string {
  const payload = payloadOf(item);
  if (stringValue(payload, "resultSnippet") === null) return join([item.name || null, "running"]);
  const duration = numberValue(payload, "durationMs");
  const outcome = stringValue(payload, "outcome");
  return join([
    item.name || null,
    stringValue(payload, "resultSnippet"),
    outcome === null ? null : `${outcome}${duration === null ? "" : ` ${duration}ms`}`,
  ]);
}

export function summarizeUsage(item: EventItem): string {
  const usage = payloadOf(item).usage;
  if (usage === null || typeof usage !== "object") return "—";
  const value = usage as Payload;
  return formatUsageBreakdown({
    inputTokens: numberValue(value, "inputTokens"),
    outputTokens: numberValue(value, "outputTokens"),
    cacheReadTokens: numberValue(value, "cacheReadTokens"),
    cacheWriteTokens: numberValue(value, "cacheWriteTokens"),
    reasoningTokens: numberValue(value, "reasoningTokens"),
  } satisfies UsageBreakdown);
}

export function summarizeQuota(item: EventItem): string {
  return stringValue(payloadOf(item), "message") ?? "—";
}

export function summarizeNotice(item: EventItem): string {
  const payload = payloadOf(item);
  return join([stringValue(payload, "code"), stringValue(payload, "message")]).replace(" · ", ": ");
}

export function summarizeRunStarted(item: EventItem): string {
  const payload = payloadOf(item);
  const adapter = stringValue(payload, "adapter");
  const model = stringValue(payload, "requestedModel");
  return adapter !== null && model !== null ? `${adapter} → ${model}` : "—";
}

export function summarizeModelResolved(item: EventItem): string {
  const payload = payloadOf(item);
  const model = stringValue(payload, "resolvedModel");
  if (model === null) return "—";
  const provenance = stringValue(payload, "provenance") as ModelProvenance;
  return `${model} (${modelProvenanceLabel(provenance)})`;
}

export function summarizeRunCompleted(item: EventItem): string {
  const exitCode = numberValue(payloadOf(item), "exitCode");
  return exitCode === null ? "—" : `exit ${exitCode}`;
}

export function summarizeRunFailed(item: EventItem): string {
  const payload = payloadOf(item);
  const code = stringValue(payload, "errorCode");
  const message = stringValue(payload, "message");
  return code !== null && message !== null ? `${code}: ${message}` : "—";
}

export function summarizeRunCancelled(item: EventItem): string {
  return stringValue(payloadOf(item), "reason") ?? "—";
}

export function summarizeCompiledPrompt(item: EventItem): string {
  const payload = payloadOf(item);
  const name = stringValue(payload, "name") ?? item.name;
  const lines = numberValue(payload, "lineCount");
  return name && lines !== null ? `${name} · ${lines} lines` : "—";
}

export function summarizeCeilingGrant(item: EventItem): string {
  const payload = payloadOf(item);
  const from = numberValue(payload, "from");
  const to = numberValue(payload, "to");
  const reason = stringValue(payload, "reason");
  return from !== null && to !== null && reason !== null ? `${from} → ${to} calls · ${reason}` : "—";
}

export function summarizeTextDelta(item: EventItem): string {
  const text = stringValue(payloadOf(item), "text") ?? "—";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function summarizeEvent(item: EventItem): string {
  switch (item.type) {
    case "tool_call": return summarizeToolCall(item);
    case "usage": return summarizeUsage(item);
    case "quota": return summarizeQuota(item);
    case "notice": return summarizeNotice(item);
    case "run.started": return summarizeRunStarted(item);
    case "model.resolved": return summarizeModelResolved(item);
    case "run.completed": return summarizeRunCompleted(item);
    case "run.failed": return summarizeRunFailed(item);
    case "run.cancelled": return summarizeRunCancelled(item);
    case "compiled_prompt": return summarizeCompiledPrompt(item);
    case "ceiling_grant": return summarizeCeilingGrant(item);
    case "text.delta": return summarizeTextDelta(item);
    default: return "—";
  }
}
