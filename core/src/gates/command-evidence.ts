// What a failed configured command is allowed to say, in a bounded number of
// characters.
//
// This file exists because of one measured defect. Pilot 2's builder claimed
// 240/240 green; the host ran the exact configured argv against the exact
// candidate and measured 240 total, 239 pass, 1 fail, exit 1. The evidence the
// host retained was `output.slice(-4000)` — the final bounded segment — which
// truthfully carried the 239/240 totals and began in the middle of test 223.
// The one thing needed to correct the defect, the failing test's identity, had
// scrolled off the front.
//
// A trailing window is the wrong shape for test output specifically, and the
// reason generalizes: runners print the failure where it happens and the
// summary at the end, so a single window can hold the count or the cause but
// not both. Three windows hold both:
//
//   head    — what ran, and how it was invoked.
//   failure — the first failure and its surroundings. THE reason this exists.
//   tail    — the summary, the totals, the exit line.
//
// Everything here is pure and deterministic: same bytes in, same evidence out,
// so a replayed journal and a re-rendered correction prompt agree. The full,
// unwindowed output is retained separately and privately; this is only what may
// be shown to a model and written into an envelope.

import { scrubCredentialString } from "../policy/redaction.ts";

/** The default budget, matching `TEST_OUTPUT_TAIL_MAX_CHARS` so the envelope field still fits. */
export const DEFAULT_EVIDENCE_BUDGET = 4_000;

/** Lines of context kept on each side of the first failure marker. */
export const FAILURE_CONTEXT_LINES = 12;

/**
 * What a failure looks like across the runners this harness actually gates on,
 * ordered from most specific to least.
 *
 * TAP first (`not ok 224 - …`), because `node --test` is what every configured
 * gate in this repository and in the pilot target uses, and its failure line
 * carries the test's identity — which is the exact thing the pilot lost.
 *
 * Deliberately a list of shapes rather than a parser. The plan's own reasoning
 * for keeping `outputTail` verbatim applies here unchanged: every runner formats
 * failures differently, so a generic parser would be confidently wrong. Finding
 * WHERE to cut is a much weaker claim than understanding what was cut, and it is
 * the only claim this file makes.
 */
export const FAILURE_MARKERS: readonly RegExp[] = Object.freeze([
  /^\s*not ok\s+\d+/,
  /^\s*#\s*(?:fail|failed)\b/i,
  /^\s*(?:✗|✘|×|✖)\s/u,
  /^\s*(?:FAIL|FAILED|FAILURES?)\b/,
  /\b(?:AssertionError|assert\.[A-Za-z]+)\b/,
  /^\s*Error:\s/,
  /^\s*\d+\)\s/,
]);

export interface BoundedCommandEvidence {
  /** The opening of the output, or `""` when it was small enough to keep whole. */
  readonly head: string;
  /** The window around the first failure marker, or `""` when none was found. */
  readonly failure: string;
  /** The closing of the output. Where a runner's totals live. */
  readonly tail: string;
  /** One-based line number of the failure marker, or `null`. */
  readonly failureLine: number | null;
  readonly totalChars: number;
  readonly omittedChars: number;
  /** True when nothing was dropped and the three windows are the whole output. */
  readonly complete: boolean;
}

export interface CommandEvidenceOptions {
  /** Total characters across all three windows. Defaults to `DEFAULT_EVIDENCE_BUDGET`. */
  readonly budget?: number;
  readonly contextLines?: number;
}

function firstFailureLine(lines: readonly string[]): number | null {
  for (const [index, line] of lines.entries()) {
    if (FAILURE_MARKERS.some((marker) => marker.test(line))) return index;
  }
  return null;
}

function clip(value: string, maximum: number, from: "start" | "end"): string {
  if (value.length <= maximum) return value;
  return from === "start" ? value.slice(0, maximum) : value.slice(value.length - maximum);
}

/**
 * The failure window, grown OUTWARD from the marker line rather than clipped
 * from the start of a fixed slice.
 *
 * The difference matters at a tight budget and only there, which is exactly
 * where it is least forgivable: a slice that begins twelve lines above the
 * marker and is then trimmed to fit loses the marker itself and keeps twelve
 * lines of passing context — a window centred on nothing, describing nothing.
 *
 * The marker line goes in first and is never dropped. Then the lines AFTER it,
 * because every runner in `FAILURE_MARKERS` prints its diagnostic below the
 * failure. Then the lines before, for whatever budget is left.
 */
function failureWindow(
  lines: readonly string[],
  markerIndex: number,
  contextLines: number,
  budget: number,
): string {
  const marker = clip(lines[markerIndex] ?? "", budget, "start");
  let used = marker.length;
  const after: string[] = [];
  for (let index = markerIndex + 1; index <= markerIndex + contextLines && index < lines.length; index += 1) {
    const line = lines[index]!;
    if (used + line.length + 1 > budget) break;
    after.push(line);
    used += line.length + 1;
  }
  const before: string[] = [];
  for (let index = markerIndex - 1; index >= Math.max(0, markerIndex - contextLines); index -= 1) {
    const line = lines[index]!;
    if (used + line.length + 1 > budget) break;
    before.unshift(line);
    used += line.length + 1;
  }
  return [...before, marker, ...after].join("\n");
}

/**
 * Splits a command's output into the three windows.
 *
 * The budget is divided so the failure window is never the one that gets
 * squeezed out. A failure found near the beginning followed by a long green tail
 * — the pilot's exact shape — keeps its identity, its diagnostic, and the
 * summary that proves how much else passed.
 *
 * Credential scrubbing runs on each window rather than on the whole output,
 * which is deliberate: the windows are what leaves the host, and scrubbing what
 * leaves is cheaper and harder to get wrong than scrubbing what is stored.
 */
export function boundCommandOutput(
  output: string,
  options: CommandEvidenceOptions = {},
): BoundedCommandEvidence {
  const budget = options.budget ?? DEFAULT_EVIDENCE_BUDGET;
  const contextLines = options.contextLines ?? FAILURE_CONTEXT_LINES;
  const totalChars = output.length;
  if (totalChars <= budget) {
    return Object.freeze({
      head: scrubCredentialString(output),
      failure: "",
      tail: "",
      failureLine: firstFailureLine(output.split("\n")) === null ? null : firstFailureLine(output.split("\n"))! + 1,
      totalChars,
      omittedChars: 0,
      complete: true,
    });
  }

  const lines = output.split("\n");
  const markerIndex = firstFailureLine(lines);

  // No failure shape anywhere: there is nothing to centre on, so the budget is
  // split between the two ends. A command that failed without printing anything
  // a marker recognizes still shows how it started and how it stopped.
  if (markerIndex === null) {
    const half = Math.floor(budget / 2);
    const head = clip(output, half, "start");
    const tail = clip(output, budget - half, "end");
    const kept = head.length + tail.length;
    return Object.freeze({
      head: scrubCredentialString(head),
      failure: "",
      tail: scrubCredentialString(tail),
      failureLine: null,
      totalChars,
      omittedChars: Math.max(0, totalChars - kept),
      complete: false,
    });
  }

  // Half the budget belongs to the failure window, and it is taken first. The
  // remaining half is split between head and tail. A window that comes in under
  // its share leaves the surplus to the other two rather than wasting it.
  const failure = failureWindow(lines, markerIndex, contextLines, Math.floor(budget / 2));
  const remaining = budget - failure.length;
  const headShare = Math.floor(remaining / 2);
  const head = clip(output, headShare, "start");
  const tail = clip(output, remaining - head.length, "end");
  const kept = head.length + failure.length + tail.length;
  return Object.freeze({
    head: scrubCredentialString(head),
    failure: scrubCredentialString(failure),
    tail: scrubCredentialString(tail),
    failureLine: markerIndex + 1,
    totalChars,
    omittedChars: Math.max(0, totalChars - kept),
    complete: false,
  });
}

/**
 * The single bounded string that goes into `TestOutput.outputTail` and into a
 * correction prompt.
 *
 * Labelled, because an unlabelled concatenation of three windows reads as one
 * continuous log and a model would reason about a gap that is not there. The
 * elision markers name how much is missing, so "the failure is at line 224 of
 * 5,900" is something the reader can act on rather than infer.
 *
 * The name `outputTail` is kept on the envelope field for schema compatibility
 * even though the content is no longer only a tail; renaming a persisted field
 * to describe the fix would break every stored envelope that predates it.
 */
export function renderCommandEvidence(evidence: BoundedCommandEvidence): string {
  if (evidence.complete) return evidence.head;
  const parts: string[] = [];
  if (evidence.head.length > 0) parts.push(`--- output head ---\n${evidence.head}`);
  if (evidence.failure.length > 0) {
    parts.push(`--- first failure (line ${String(evidence.failureLine)}) ---\n${evidence.failure}`);
  }
  if (evidence.tail.length > 0) parts.push(`--- output tail ---\n${evidence.tail}`);
  parts.push(
    `--- ${String(evidence.omittedChars)} of ${String(evidence.totalChars)} characters omitted; ` +
      `the complete output is retained host-private ---`,
  );
  return parts.join("\n");
}

/**
 * Renders within a hard ceiling, so a caller with a schema bound gets a string
 * that fits it rather than one that nearly does.
 *
 * The labels and the elision line cost characters the windows did not budget
 * for, so a render can exceed the window budget by a small constant. Re-bounding
 * the rendered text is a second, cheaper pass rather than an attempt to predict
 * the label cost up front.
 */
export function renderBoundedEvidence(output: string, ceiling = DEFAULT_EVIDENCE_BUDGET): string {
  const rendered = renderCommandEvidence(boundCommandOutput(output, { budget: ceiling }));
  if (rendered.length <= ceiling) return rendered;
  return renderCommandEvidence(
    boundCommandOutput(output, { budget: Math.max(0, ceiling - (rendered.length - ceiling) - 128) }),
  ).slice(0, ceiling);
}
