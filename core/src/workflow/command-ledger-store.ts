import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertCommandDispatchIntent, assertCommandDispatchResult,
  assertCommandOccurrenceClosed, assertCommandOccurrenceOpened, type CommandDispatchIntent,
  type CommandDispatchResult, type CommandOccurrenceClosed,
  type CommandOccurrenceOpened } from "../contracts/command-ledger.ts";
import type { AttemptEvent } from "../cli/commands/attempt.ts";
import { deriveAttemptStatus } from "../cli/commands/attempt.ts";
import { scanJournalText } from "../persistence/replay.ts";
import { journalFilePath } from "../persistence/platform-paths.ts";
import { recoveryDigest } from "../contracts/phase-recovery.ts";
import { readAttempt } from "../cli/commands/attempt.ts";
import type { CommandDispatchPoint, CommandLedgerSnapshot, RetainedOutputObservation } from "./command-ledger.ts";

/**
 * Where a `candidate_hygiene` gate record's occurrence key comes from.
 *
 * The three dispatchers spell the gate evidence `id` differently, but the
 * `phaseId` FIELD on the same record is uniform — `${sessionId}:${localPhaseId}`
 * at all three — and `round` and `candidateSha` sit beside it. Deriving from
 * those fields rather than from the composite `id` keeps this independent of an
 * id format that has already drifted once.
 */
export function dispatchPointFor(
  sessionId: string, phaseId: string, round: number, candidateSha: string,
): CommandDispatchPoint | null {
  const prefix = `${sessionId}:`;
  if (!phaseId.startsWith(prefix)) return null;
  const local = phaseId.slice(prefix.length);
  if (local === "adoption-tests") {
    return { dispatcherId: "adopt/adoption-tests", occurrenceKey: `${phaseId}:${candidateSha}` };
  }
  if (local.startsWith("owner-rework-")) {
    return { dispatcherId: "rework/owner-gates", occurrenceKey: `${local}:${candidateSha}` };
  }
  return { dispatcherId: "production-run/measure-candidate", occurrenceKey: `${local}:${candidateSha}:${String(round)}` };
}

export const occurrenceKeyForMeasurement = (phaseId: string, candidateSha: string, round: number): string =>
  `${phaseId}:${candidateSha}:${String(round)}`;
export const occurrenceKeyForRework = (phaseKey: string, candidateSha: string): string => `${phaseKey}:${candidateSha}`;
export const occurrenceKeyForAdoption = (phaseId: string, candidateSha: string): string => `${phaseId}:${candidateSha}`;

/**
 * The one reader every ledger decision goes through, recovery or not.
 *
 * The ordinary dispatch path used to have no validated journal behind it — only
 * the recovery entry points scanned. A ledger consulted from an unvalidated
 * journal can be missing records it would have refused on, so both paths share
 * this: torn tail refuses, and derived status must agree with what is on disk.
 */
export async function readCommandLedger(attemptDir: string): Promise<CommandLedgerSnapshot> {
  const path = journalFilePath(attemptDir);
  const scan = scanJournalText<AttemptEvent>(await readFile(path, "utf8"), path);
  if (!scan.ok || scan.tornTail !== null) {
    throw new Error("command ledger refused: corrupt or torn journal; retain it for diagnosis");
  }
  const status = deriveAttemptStatus(scan.records);
  if (status === null) throw new Error("command ledger refused: empty journal");
  const disk = await readAttempt(attemptDir);
  const historical = deriveAttemptStatus(scan.records.slice(0, disk.revision));
  if (historical === null || recoveryDigest(historical) !== recoveryDigest(disk)) {
    throw new Error("command ledger refused: status disagrees with journal");
  }

  const intents: CommandDispatchIntent[] = [];
  const results: CommandDispatchResult[] = [];
  const openings: CommandOccurrenceOpened[] = [];
  const closures: CommandOccurrenceClosed[] = [];
  const dispatchPoints: CommandDispatchPoint[] = [];

  for (const record of scan.records) {
    const evidence = record.event.evidence;
    if (evidence === undefined) continue;
    if (evidence.type === "command-dispatch-intent") {
      assertCommandDispatchIntent(evidence.intent);
      intents.push(evidence.intent);
    } else if (evidence.type === "command-dispatch-result") {
      assertCommandDispatchResult(evidence.result);
      results.push(evidence.result);
    } else if (evidence.type === "command-occurrence-opened") {
      assertCommandOccurrenceOpened(evidence.opening);
      openings.push(evidence.opening);
    } else if (evidence.type === "command-occurrence-closed") {
      assertCommandOccurrenceClosed(evidence.closure);
      closures.push(evidence.closure);
    } else if (evidence.type === "gate" && evidence.gateId === "candidate_hygiene" && evidence.passed &&
        evidence.candidateSha !== null) {
      // Only a PASSING hygiene record is a dispatch point. A failing one returns
      // before any command runs, so an occurrence with no ledger evidence under
      // it is correct rather than suspicious.
      const point = dispatchPointFor(status.sessionId, evidence.phaseId, evidence.round, evidence.candidateSha);
      if (point !== null && !dispatchPoints.some(seen =>
          seen.dispatcherId === point.dispatcherId && seen.occurrenceKey === point.occurrenceKey)) {
        dispatchPoints.push(point);
      }
    }
  }

  const retained: RetainedOutputObservation[] = [];
  for (const result of results) {
    if (result.outputRef === null) {
      retained.push({ intentId: result.intentId, bytes: null, digest: null });
      continue;
    }
    retained.push(await observeRetained(attemptDir, result.intentId, result.outputRef));
  }

  return Object.freeze({
    intents: Object.freeze(intents),
    results: Object.freeze(results),
    openings: Object.freeze(openings),
    closures: Object.freeze(closures),
    dispatchPoints: Object.freeze(dispatchPoints),
    retained: Object.freeze(retained),
  });
}

async function observeRetained(attemptDir: string, intentId: string, outputRef: string): Promise<RetainedOutputObservation> {
  const absolute = join(attemptDir, outputRef);
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return { intentId, bytes: null, digest: null };
    const bytes = await readFile(absolute);
    return { intentId, bytes: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    // Missing or unreadable retained output is torn evidence, never a restore.
    return { intentId, bytes: null, digest: null };
  }
}

export const retainedOutputDigest = (text: string): string => createHash("sha256").update(text).digest("hex");
