import type { CanvasSession } from "../../../dashboard/src/canvas-graph.ts";

/** Synthetic canvas projection. Names deliberately say nothing about the pair. */
export function canvasReplays(project = "canvas-fixture", items = 2, repetitions = 2, arms = 4): CanvasSession[] {
  const sessions: CanvasSession[] = [];
  for (let item = 1; item <= items; item += 1) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (let arm = 1; arm <= arms; arm += 1) {
        const serial = sessions.length + 1;
        sessions.push({
          sessionId: `${project}-s${serial}`, project, taskId: `unrelated-${serial}`, attempt: 1,
          continuesTask: null, groupId: null, planRef: null, state: "AWAITING_OWNER",
          startedAt: "2026-01-01T00:00:00.000Z",
          replay: { itemId: `sample-${item}`, repetition, arm: `fixture/provider/model-${arm}@high`, order: arms - arm + 1 },
        });
      }
    }
  }
  return sessions;
}
