import type { EventItem } from "../shared/types.ts";
import { scrubCredentialString } from "../shared/credential-patterns.ts";

export interface FoldedTextDeltaRow {
  id: string;
  runId: string | null;
  phaseId: string | null;
  startedAt: string;
  endedAt: string | null;
  type: "text.delta.fold";
  chunkCount: number;
  reassembledText: string;
  chunkPayloads: EventItem["payload"][];
}

export type DisplayRow = EventItem | FoldedTextDeltaRow;

function isTextDelta(item: EventItem): boolean {
  return item.type === "text.delta";
}

function textFrom(item: EventItem): string {
  const payload = item.payload;
  if (payload === null || typeof payload !== "object") return "";
  const text = (payload as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

function foldRun(run: EventItem[]): FoldedTextDeltaRow {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  return {
    id: `text.delta.fold:${first.id}:${last.id}`,
    runId: first.runId,
    phaseId: first.phaseId,
    startedAt: first.startedAt,
    endedAt: last.endedAt,
    type: "text.delta.fold",
    chunkCount: run.length,
    reassembledText: scrubCredentialString(run.map(textFrom).join("")),
    chunkPayloads: run.map((item) => item.payload),
  };
}

export function foldTextDeltaRuns(events: EventItem[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let run: EventItem[] = [];

  for (const event of events) {
    const previous = run[run.length - 1];
    if (
      isTextDelta(event)
      && (previous === undefined || (
        event.runId === previous.runId
        && event.firstSourceSeq === previous.lastSourceSeq + 1
      ))
    ) {
      run.push(event);
      continue;
    }

    if (run.length > 0) rows.push(foldRun(run));
    run = isTextDelta(event) ? [event] : [];
    if (!isTextDelta(event)) rows.push(event);
  }

  if (run.length > 0) rows.push(foldRun(run));
  return rows;
}
