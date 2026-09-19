import type { PhaseSummary, SessionCard } from "../shared/types.ts";

/**
 * Why runs stop.
 *
 * Every phase record already carries `error.code` and `error.message`, and
 * until now nothing rendered either of them: the only `.error` in the whole
 * dashboard was a CSS class on an event tick. So a reader could see that
 * twenty-two runs were BLOCKED and had no way at all to see why, or to tell
 * the factory correctly refusing bad work from the factory falling over.
 *
 * The code is an `Error` subclass NAME, thrown from `production-run.ts` and
 * caught wherever it landed. It is not a designed vocabulary — core has one of
 * those, the L5 blocker codes, but it lives on a CLI report and never reaches
 * the projection. So the classification is made here, from the string, and it
 * has to survive meeting a name it has never seen: a new subclass falls into
 * `unclassified` and is shown as such rather than guessed at or hidden.
 */

export const FAILURE_CLASSES = ["refusal", "review", "quota", "harness", "unclassified"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const FAILURE_CLASS_LABEL: Readonly<Record<FailureClass, string>> = {
  refusal: "refused the work",
  review: "review contract",
  quota: "provider quota",
  harness: "harness defect",
  unclassified: "unclassified",
};

/**
 * What each class means for the reader, because the difference is the whole
 * point: one of these is the factory working.
 */
export const FAILURE_CLASS_NOTE: Readonly<Record<FailureClass, string>> = {
  refusal: "a gate, a test or an envelope caught something — the factory doing its job",
  review: "the review or rework evidence could not be trusted",
  quota: "a provider refused to serve; nothing was wrong with the work",
  harness: "the machinery around the work broke",
  unclassified: "a failure this dashboard has not been taught to read yet",
};

/**
 * Codes seen on the owner's own projection, plus the siblings core names
 * beside them in `productionReviewBlocker`/`closestBlocker`. Anything absent
 * is `unclassified` on purpose — see the note above.
 */
const CLASSIFIED: Readonly<Record<string, FailureClass>> = {
  PhaseGateFailure: "refusal",
  CommandPhaseFailure: "refusal",
  EnvelopeValidationFailure: "refusal",
  ReplacementReviewInconsistent: "review",
  ReplacementReviewMalformed: "review",
  OwnerReworkCredentialRejected: "review",
  ReviewEvidenceUnfit: "review",
  MandatoryReviewUnavailable: "review",
  InvalidReviewInversion: "review",
  ExecutableNotFound: "harness",
  PermissionBreach: "harness",
  // Checked AFTER the quota token below, which claims the adapter errors that
  // are a provider saying "not now" rather than the machinery breaking.
  AdapterError: "harness",
};

/**
 * A provider saying "not now" is not a defect and must not be counted as one.
 *
 * Both `AdapterError`s on the owner's projection are this: "You have hit your
 * ChatGPT usage limit (plus plan). Try again in ~155 min. (E_QUOTA_EXHAUSTED)".
 * The adapter reports it through the same class it uses for real transport
 * faults, so the class alone cannot tell them apart and the message has to.
 * Core draws the same line in `closestBlocker`, on the same token.
 */
const QUOTA_TOKEN = /E_QUOTA_EXHAUSTED|usage limit (?:has been )?reached|hit your .* usage limit/iu;

export function classifyFailure(code: string | null, message: string | null = null): FailureClass {
  if (code !== null && QUOTA_TOKEN.test(`${code} ${message ?? ""}`)) return "quota";
  if (code === null) return "unclassified";
  return CLASSIFIED[code] ?? "unclassified";
}

export interface RunFailure {
  readonly sessionId: string;
  readonly taskId: string;
  readonly workflowId: string;
  /** The state the RUN ended in. A failed phase does not always block a run. */
  readonly runState: SessionCard["state"];
  readonly phaseKey: string;
  readonly phaseName: string;
  readonly ordinal: number;
  readonly code: string | null;
  readonly message: string | null;
  readonly at: string | null;
  readonly failure: FailureClass;
  /**
   * Whether the work behind this failure can still be carried forward.
   *
   * Task 8's recovery diagnostics answer this and are on `main`, unmerged. The
   * field exists and is null so the surface says "not known yet" rather than
   * implying nothing is recoverable — and so wiring it after the merge is one
   * line here instead of a redesign.
   */
  readonly recoverable: boolean | null;
}

/** The last path segment: phase ids are `<sessionId>:<key>`. */
function phaseKeyOf(phase: PhaseSummary): string {
  return phase.key || phase.phaseId.slice(phase.phaseId.lastIndexOf(":") + 1);
}

/**
 * Every failed phase on the board, newest first.
 *
 * Every failed phase, not every blocked run: a run that failed once, corrected
 * and carried on is the factory working, and it is invisible today. On the
 * owner's projection one of the twenty-two sits in a run still REVIEWING,
 * which no count of blocked runs would ever show.
 */
export function runFailures(sessions: readonly SessionCard[]): readonly RunFailure[] {
  const failures: RunFailure[] = [];
  for (const session of sessions) {
    for (const phase of session.phases ?? []) {
      if (phase.status !== "FAILED") continue;
      const code = phase.error?.code ?? null;
      const message = phase.error?.message ?? null;
      failures.push({
        sessionId: session.sessionId,
        taskId: session.taskId,
        workflowId: session.workflowId,
        runState: session.state,
        phaseKey: phaseKeyOf(phase),
        phaseName: phase.name,
        ordinal: phase.ordinal,
        code,
        message,
        at: phase.endedAt ?? phase.startedAt ?? null,
        failure: classifyFailure(code, message),
        recoverable: null,
      });
    }
  }
  // Newest first, and stable for two failures recorded in the same millisecond
  // so the list does not reshuffle under a poll.
  return failures.sort((left, right) =>
    (right.at ?? "").localeCompare(left.at ?? "")
    || left.sessionId.localeCompare(right.sessionId)
    || left.ordinal - right.ordinal);
}

export function failureCounts(failures: readonly RunFailure[]): Readonly<Record<FailureClass, number>> {
  const counts: Record<FailureClass, number> = { refusal: 0, review: 0, quota: 0, harness: 0, unclassified: 0 };
  for (const failure of failures) counts[failure.failure] += 1;
  return counts;
}

/** Distinct codes inside one class, commonest first — what to go and fix. */
export function failureCodes(
  failures: readonly RunFailure[],
  failure: FailureClass,
): readonly { readonly code: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const held of failures) {
    if (held.failure !== failure) continue;
    const code = held.code ?? "(no code recorded)";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}
